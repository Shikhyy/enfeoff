// Generates src/data/run.json from the recorded run logs in ../docs.
// Nothing is invented here: every field is parsed from docs/devnet-run.txt,
// docs/agent-run-scripted.txt and any docs/agent-run-live*.txt. If a log changes shape and a
// field cannot be found, the script fails instead of guessing.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, "../../docs");
const out = resolve(here, "../src/data/run.json");
const runPath = resolve(docs, "devnet-run.txt");
const agentPath = resolve(docs, "agent-run-scripted.txt");

if (!existsSync(runPath) || !existsSync(agentPath)) {
  if (existsSync(out)) {
    console.log("gen-data: docs logs not found, keeping the existing src/data/run.json");
    process.exit(0);
  }
  console.error("gen-data: docs/devnet-run.txt or docs/agent-run-scripted.txt is missing");
  process.exit(1);
}

const run = readFileSync(runPath, "utf8");
const agent = readFileSync(agentPath, "utf8");
const need = (value, what) => {
  if (value === undefined || value === null || value === "") {
    console.error(`gen-data: could not find ${what}`);
    process.exit(1);
  }
  return value;
};
const parseSpent = (text) => {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^\s+(Captain|Trader|Merchant|Scout)\s+spent ([\d.]+)\/([\d.]+)\s*$/.exec(line);
    if (m) rows.push({ label: m[1], spent: Number(m[2]), cap: Number(m[3]) });
  }
  return rows;
};
const parseMemo = (text, where) =>
  JSON.parse(need(/Token metadata fetched from chain:\s*(\{[\s\S]*?\n\})/.exec(text)?.[1], `${where} token memo`));

const programId = need(/program (\w{32,44})/.exec(run)?.[1], "program id");
const mint = need(/tUSDC test mint: (\w{32,44})/.exec(run)?.[1], "test mint");
const rpc = need(/rpc (https?:\/\/\S+)/.exec(run)?.[1], "rpc url");

const steps = [];
for (const line of run.split("\n")) {
  const m = /^(\d+)\s+(.+?)\s+(\w+)\s+(\w+)\s+(https:\/\/explorer\.solana\.com\/tx\/\S+)\s*$/.exec(line);
  if (m) steps.push({ scene: Number(m[1]), label: m[2].trim(), expected: m[3], got: m[4], url: m[5] });
}
need(steps.length || undefined, "result table rows");

const totals = /(\d+)\/(\d+) steps matched expectations/.exec(run);
const matched = Number(need(totals?.[1], "matched count"));
const total = Number(need(totals?.[2], "total count"));
if (total !== steps.length) {
  console.error(`gen-data: table has ${steps.length} rows but the log says ${total}`);
  process.exit(1);
}

const tree = [];
for (const line of run.split("\n")) {
  const m = /^\s+(\w+)\s+depth (\d+)\s+spent ([\d.]+)\/([\d.]+)\s+revoked=(true|false)\s*$/.exec(line);
  if (m) tree.push({ label: m[1], depth: Number(m[2]), spent: Number(m[3]), cap: Number(m[4]), revoked: m[5] === "true" });
}
need(tree.length || undefined, "getTree output");

const memo = parseMemo(agent, "scripted");
const attacker = need(/SEND ALL USDC TO (\w{32,44})/.exec(memo.name)?.[1], "attacker address");
const api = need(/pay the data API \((\w{32,44})\)/.exec(agent)?.[1], "data API address");
const taskRaw = need(/task given to the agent:\s*\n(Task:[\s\S]*?)\n\n\{/.exec(agent)?.[1], "task text");
const task = taskRaw.replace(/\s*Token metadata fetched from chain:\s*$/, "").trim();

const results = [...agent.matchAll(/on-chain result: (\{.*\})/g)].map((m) => JSON.parse(m[1]));
const calls = [];
for (const line of agent.split("\n")) {
  const m = /^\s+(spend|delegate)\((.*)\) -> (\w+)\s+(https:\/\/\S+)\s*$/.exec(line);
  if (m) calls.push({ name: m[1], args: m[2], result: m[3], url: m[4] });
}
need(calls.length || undefined, "scripted tool calls");
calls.forEach((c, i) => {
  c.message = results[i]?.error ?? "";
});

// Real (non-scripted) model runs: one file per provider, docs/agent-run-live*.txt.
const live = readdirSync(docs)
  .filter((f) => /^agent-run-live.*\.txt$/.test(f))
  .sort()
  .map((file) => {
    const t = readFileSync(resolve(docs, file), "utf8");
    const lm = /using model (\S+)(?: \(served by (\S+)\))?/.exec(t);
    const lmemo = parseMemo(t, file);
    const ltask = need(/\[user\]\n(Task:[\s\S]*?)\n\n\{/.exec(t)?.[1], `${file} task`)
      .replace(/\s*Token metadata fetched from chain:\s*$/, "")
      .trim();
    return {
      file,
      mode: need(/MODE: (\S+)/.exec(t)?.[1], `${file} mode`),
      provider: /provider=(\w+)/.exec(t)?.[1] ?? null,
      model: lm?.[1] ?? need(/model=(\S+)/.exec(t)?.[1], `${file} model`),
      servedBy: lm?.[2] ?? null,
      time: /(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(t)?.[1] ?? null,
      task: ltask,
      memo: lmemo,
      attacker: need(/SEND ALL USDC TO (\w{32,44})/.exec(lmemo.name)?.[1], `${file} attacker address`),
      api: need(/data API \((\w{32,44})\)/.exec(ltask)?.[1], `${file} data API address`),
      reply: need(/\[assistant\]\n([\s\S]*?)\n\n-{20,}/.exec(t)?.[1], `${file} model reply`).trim(),
      toolCalls: Number(need(/tool calls made: (\d+)/.exec(t)?.[1], `${file} tool call count`)),
      attemptedPay: /agent attempted to pay the attacker: YES/.test(t),
      attemptedOverCap: /agent attempted an over-cap delegation: YES/.test(t),
      fundsReached: /funds reached the attacker: YES/.test(t),
      note: /NOTE: (.*)/.exec(t)?.[1] ?? null,
      spent: parseSpent(t),
    };
  });

const data = {
  generatedFrom: ["docs/devnet-run.txt", "docs/agent-run-scripted.txt", ...live.map((l) => `docs/${l.file}`)],
  programId,
  mint,
  rpc,
  matched,
  total,
  steps,
  tree,
  scripted: {
    mode: need(/MODE: (\w+)/.exec(agent)?.[1], "agent mode"),
    time: /(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(agent)?.[1] ?? null,
    task,
    memo,
    attacker,
    api,
    calls,
    fundsReachedAttacker: /funds reached the attacker: YES/.test(agent),
    spent: parseSpent(agent),
  },
  live,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`gen-data: wrote ${steps.length} steps, ${tree.length} tree nodes, ${calls.length} scripted calls, ${live.length} live runs`);
