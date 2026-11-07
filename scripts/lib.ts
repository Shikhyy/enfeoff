import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Enfeoff, errorName, explainError, retry, sendPolled } from "../sdk";

export const U = 1_000_000; // 1 tUSDC (6 decimals)
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

export function loadPayer(): Keypair {
  const p = process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

// Public RPCs rate-limit hard. Space requests out and back off on any HTTP 429, whatever the caller.
let lastReq = 0;
const throttledFetch = (async (input: any, init?: any) => {
  for (let i = 0; i < 12; i++) {
    const wait = Math.max(0, lastReq + 120 - Date.now());
    lastReq = Date.now() + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(input, init);
    if (res.status !== 429) return res;
    await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * 2 ** Math.min(i, 4))));
  }
  return fetch(input, init);
}) as typeof fetch;

export function makeClient() {
  const conn = new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: throttledFetch });
  const payer = loadPayer();
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed" });
  const e = new Enfeoff(provider);
  return { conn, payer, provider, e };
}

export function explorer(kind: "tx" | "address", id: string) {
  const cluster = RPC_URL.includes("devnet")
    ? "?cluster=devnet"
    : `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}

export async function sendSol(provider: AnchorProvider, to: PublicKey, lamports: number) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: provider.wallet.publicKey, toPubkey: to, lamports })
  );
  await sendPolled(provider, tx, []);
}

export interface Row {
  step: string;
  action: string;
  expected: string;
  result: string;
  ok: boolean;
  sig?: string;
}
export class Report {
  rows: Row[] = [];
  add(r: Row) {
    this.rows.push(r);
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`[${mark}] ${r.step.padEnd(4)} ${r.action}\n       expected: ${r.expected} | got: ${r.result}` +
      (r.sig ? `\n       ${explorer("tx", r.sig)}` : ""));
  }
  get failed() {
    return this.rows.filter((r) => !r.ok);
  }
  table() {
    const w = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
    console.log("\n" + w("STEP", 5) + w("ACTION", 58) + w("EXPECTED", 20) + w("RESULT", 22) + "LINK");
    for (const r of this.rows)
      console.log(w(r.step, 5) + w(r.action, 58) + w(r.expected, 20) + w(r.result, 22) + (r.sig ? explorer("tx", r.sig) : "-"));
  }
}

/** Run an action expecting success. */
export async function expectOk(rep: Report, step: string, action: string, fn: () => Promise<string>) {
  try {
    const sig = await fn();
    rep.add({ step, action, expected: "ok", result: "ok", ok: true, sig });
    return sig;
  } catch (err: any) {
    rep.add({ step, action, expected: "ok", result: errorName(err) ?? explainError(err), ok: false, sig: err?.signature });
    return undefined;
  }
}

/** Run an action expecting a specific program error. */
export async function expectFail(rep: Report, step: string, action: string, code: string, fn: () => Promise<string>) {
  try {
    const sig = await fn();
    rep.add({ step, action, expected: code, result: "SUCCEEDED (bad!)", ok: false, sig });
  } catch (err: any) {
    const name = errorName(err);
    rep.add({ step, action, expected: code, result: name ?? explainError(err), ok: name === code, sig: err?.signature });
  }
}

export interface Scenario {
  owner: Keypair;
  mint: PublicKey;
  vault: PublicKey;
  keys: { captain: Keypair; trader: Keypair; merchant: Keypair; scout: Keypair };
  addr: { pool: PublicKey; game: PublicKey; api: PublicKey; attacker: PublicKey };
  m: { captain: PublicKey; trader: PublicKey; merchant: PublicKey; scout: PublicKey };
  labels: Record<string, string>;
}

/** DEMO steps 1-2: fund the vault with 50 tUSDC, Captain 50 -> Trader 20 / Merchant 15 -> Scout 2. */
export async function buildScenario(
  ctx: ReturnType<typeof makeClient>,
  rep: Report
): Promise<Scenario | undefined> {
  const { conn, payer, provider, e } = ctx;
  const owner = Keypair.generate();
  await sendSol(provider, owner.publicKey, 0.05 * 1e9);
  // test mint "tUSDC": 6 decimals, mint authority = the demo payer. Not real money.
  const mint = await retry(() => createMint(conn, payer, payer.publicKey, null, 6));
  console.log(`tUSDC test mint: ${mint.toBase58()}  (${explorer("address", mint.toBase58())})`);
  const ownerAta = await retry(() => getOrCreateAssociatedTokenAccount(conn, payer, mint, owner.publicKey));
  await retry(() => mintTo(conn, payer, mint, ownerAta.address, payer, 50 * U));

  const keys = {
    captain: Keypair.generate(),
    trader: Keypair.generate(),
    merchant: Keypair.generate(),
    scout: Keypair.generate(),
  };
  const addr = {
    pool: Keypair.generate().publicKey, // MOCK pool recipient (plain wallet)
    game: Keypair.generate().publicKey, // MOCK game recipient
    api: Keypair.generate().publicKey, // MOCK data API recipient
    attacker: Keypair.generate().publicKey,
  };

  let vault!: PublicKey;
  const created = await expectOk(rep, "1", "Owner creates vault", async () => {
    const r = await e.createVault(owner, mint);
    vault = r.vault;
    return r.signature;
  });
  if (!created) return undefined;
  const funded = await expectOk(rep, "1", "Owner funds vault with 50 tUSDC", () => e.fund(vault, owner, 50 * U));
  if (!funded) return undefined;

  const m: any = {};
  const ok = [
    await expectOk(rep, "1", "Root mandate Captain, cap 50", async () => {
      const r = await e.createRoot(vault, owner, { cap: 50 * U, recipients: [addr.pool, addr.game, addr.api], authority: keys.captain.publicKey });
      m.captain = r.mandate;
      return r.signature;
    }),
    await expectOk(rep, "2", "Captain delegates Trader cap 20 (pool only)", async () => {
      const r = await e.delegate(m.captain, keys.captain, { cap: 20 * U, recipients: [addr.pool], authority: keys.trader.publicKey });
      m.trader = r.mandate;
      return r.signature;
    }),
    await expectOk(rep, "2", "Captain delegates Merchant cap 15 (game, api)", async () => {
      const r = await e.delegate(m.captain, keys.captain, { cap: 15 * U, recipients: [addr.game, addr.api], authority: keys.merchant.publicKey });
      m.merchant = r.mandate;
      return r.signature;
    }),
    await expectOk(rep, "2", "Merchant delegates Scout cap 2 (api only)", async () => {
      const r = await e.delegate(m.merchant, keys.merchant, { cap: 2 * U, recipients: [addr.api], authority: keys.scout.publicKey });
      m.scout = r.mandate;
      return r.signature;
    }),
  ];
  if (ok.some((x) => !x)) return undefined;
  const labels: Record<string, string> = {
    [m.captain.toBase58()]: "Captain",
    [m.trader.toBase58()]: "Trader",
    [m.merchant.toBase58()]: "Merchant",
    [m.scout.toBase58()]: "Scout",
  };
  return { owner, mint, vault, keys, addr, m, labels };
}
