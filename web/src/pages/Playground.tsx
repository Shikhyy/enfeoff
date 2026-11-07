import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, PageHead, Reveal } from "../ui";
import { ERRORS, RECIPIENTS, U, blockedBy, delegate, expire, fmt, initialState, remaining, revoke, spend, type ErrorName, type Mandate, type Recipient, type Result, type SimState } from "../lib/sim";

interface Entry {
  id: number;
  ok: boolean;
  title: string;
  text: string;
  code?: ErrorName;
}

const ROOT_CAP = 50 * U;
const RKEYS = Object.keys(RECIPIENTS) as Recipient[];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const parse = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? Math.round(v * U) : NaN;
};

export default function Playground() {
  const [state, setState] = useState<SimState>(initialState);
  const ref = useRef(state);
  const [sel, setSel] = useState("scout");
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("1");
  const [to, setTo] = useState<Recipient>("api");
  const [actionId, setActionId] = useState("");
  const [cap, setCap] = useState("1");
  const [dRec, setDRec] = useState<Recipient[]>(["api"]);
  const [err, setErr] = useState("");
  const counter = useRef(0);

  const push = (e: Omit<Entry, "id">) => setLog((l) => [{ ...e, id: ++counter.current }, ...l].slice(0, 7));
  const apply = (title: string, res: Result) => {
    if (res.ok) {
      ref.current = res.state;
      setState(res.state);
      push({ ok: true, title, text: res.summary });
    } else {
      push({ ok: false, title, text: res.detail, code: res.error });
    }
    return res.ok;
  };

  const m = state.mandates.find((x) => x.id === sel) ?? state.mandates[0];
  const rows: Mandate[] = [];
  const walk = (pid: string | null) =>
    state.mandates.filter((x) => x.parent === pid).forEach((x) => {
      rows.push(x);
      walk(x.id);
    });
  walk(null);
  const block = blockedBy(state, m.id);

  const doSpend = () => {
    const a = parse(amount);
    if (Number.isNaN(a)) return setErr("Enter an amount above zero.");
    setErr("");
    apply(`${m.label} pays ${RECIPIENTS[to].label} ${fmt(a)}`, spend(ref.current, sel, a, to, actionId.trim() || undefined));
  };
  const doDelegate = () => {
    const c = parse(cap);
    if (Number.isNaN(c)) return setErr("Enter a cap above zero.");
    setErr("");
    apply(`${m.label} delegates ${fmt(c)}`, delegate(ref.current, sel, { cap: c, recipients: dRec, label: `Agent ${ref.current.nextId}` }));
  };
  const toggle = (r: Recipient) => setDRec((d) => (d.includes(r) ? d.filter((x) => x !== r) : [...d, r]));
  const reset = () => {
    const s = initialState();
    ref.current = s;
    setState(s);
    setLog([]);
    setSel("captain");
    setErr("");
  };

  const play = async (steps: (() => void)[]) => {
    setBusy(true);
    for (const s of steps) {
      s();
      await sleep(780);
    }
    setBusy(false);
  };
  const pay = (title: string, id: string, amt: number, r: Recipient, action?: string) => () => {
    setSel(id);
    apply(title, spend(ref.current, id, Math.round(amt * U), r, action));
  };

  const scenarios: { name: string; hint: string; run: () => void }[] = [
    { name: "Injection", hint: "Scout is told to pay the attacker 50", run: () => play([pay("Injected memo: Scout pays Attacker 50", "scout", 50, "attacker")]) },
    {
      name: "Escalation",
      hint: "Scout delegates a child with cap 100",
      run: () => play([() => { setSel("scout"); apply("Scout delegates a child with cap 100", delegate(ref.current, "scout", { cap: 100 * U, recipients: ["api"], label: "Child" })); }]),
    },
    {
      name: "Replay",
      hint: "Pay a report, then repeat the same action_id",
      run: () => play([pay("Scout pays Data API 0.4 (report-0001)", "scout", 0.4, "api", "report-0001"), pay("Scout repeats report-0001", "scout", 0.4, "api", "report-0001")]),
    },
    {
      name: "Shared budget",
      hint: "Resets, then follows the DEMO.md sequence",
      run: () =>
        play([
          reset,
          pay("Trader pays Pool 8", "trader", 8, "pool"),
          pay("Merchant pays Game 5", "merchant", 5, "game"),
          pay("Scout pays Data API 0.4", "scout", 0.4, "api"),
          pay("Captain pays Pool 25", "captain", 25, "pool"),
          pay("Merchant pays Game 6", "merchant", 6, "game"),
          pay("Trader tries Pool 6", "trader", 6, "pool"),
          pay("Trader pays Pool 5.6", "trader", 5.6, "pool"),
          pay("Merchant tries Game 0.1", "merchant", 0.1, "game"),
        ]),
    },
    {
      name: "Kill switch",
      hint: "Revoke Captain, then try each mandate",
      run: () =>
        play([
          () => { setSel("captain"); apply("Owner revokes Captain", revoke(ref.current, "captain")); },
          pay("Trader pays Pool 0.1", "trader", 0.1, "pool"),
          pay("Merchant pays Game 0.1", "merchant", 0.1, "game"),
          pay("Scout pays Data API 0.1", "scout", 0.1, "api"),
        ]),
    },
  ];

  return (
    <>
      <PageHead tag="simulation" title="Try to give an agent *more than it holds.*" lede="Pick a mandate, then spend, delegate, revoke or let it expire. Every refusal shows the program's own error." />
      <section className="container" style={{ paddingBottom: "clamp(72px,10vw,140px)" }}>
        <div className="notice" style={{ marginBottom: 24 }}>Simulation: these checks run in your browser, not on the chain.</div>
        <div className="pg">
          <Reveal>
            <div className="panel on-dark stack" style={{ width: "100%" }}>
              <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                <span className="eyebrow">Vault · 50 tUSDC · bar length = cap</span>
              </div>
              <div style={{ width: "100%" }}>
                {rows.map((r) => (
                  <Bar
                    key={r.id}
                    label={r.label}
                    meta={`${fmt(r.spent)} / ${fmt(r.cap)}${r.revoked ? " · revoked" : r.expired ? " · expired" : blockedBy(state, r.id) ? " · blocked" : ""}`}
                    capPct={(r.cap / ROOT_CAP) * 100}
                    fillPct={r.cap ? (r.spent / r.cap) * 100 : 0}
                    tone={blockedBy(state, r.id) ? "dead" : "ok"}
                    indent={r.depth * 22}
                    selected={r.id === sel}
                    onClick={() => setSel(r.id)}
                  />
                ))}
              </div>
              <div className="legend">
                <span style={{ ["--c" as string]: "var(--sage-fill)" }}>spent</span>
                <span style={{ ["--c" as string]: "var(--terra-lite)" }}>revoked, expired or blocked</span>
                <span style={{ ["--c" as string]: "var(--paper)" }}>cap (outline)</span>
              </div>
              <div style={{ width: "100%", borderTop: "1px solid var(--line-inv)", paddingTop: 18 }}>
                <span className="eyebrow">Replay a scenario from the demo</span>
                <div className="row" style={{ marginTop: 12 }}>
                  {scenarios.map((s) => (
                    <button key={s.name} type="button" className="btn btn--inv btn--sm" disabled={busy} title={s.hint} onClick={s.run}>{s.name}</button>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          <div className="pg__side">
            <div className="card card--parch">
              <span className="eyebrow">Selected mandate</span>
              <h3 className="display h-sm">{m.label}</h3>
              <dl className="facts">
                <div><dt>depth</dt><dd>{m.depth} of 4</dd></div>
                <div><dt>cap</dt><dd>{fmt(m.cap)} tUSDC</dd></div>
                <div><dt>spent</dt><dd>{fmt(m.spent)} tUSDC</dd></div>
                <div><dt>left</dt><dd>{fmt(remaining(m))} tUSDC</dd></div>
                <div><dt>recipients</dt><dd>{m.recipients.map((r) => RECIPIENTS[r].label).join(", ")}</dd></div>
                <div><dt>state</dt><dd>{m.revoked ? "revoked" : m.expired ? "expired" : block ? `blocked by ${block.mandate.label}` : "active"}</dd></div>
              </dl>
            </div>

            <div className="card">
              <span className="eyebrow">Spend from {m.label}</span>
              <div className="row" style={{ width: "100%", alignItems: "flex-start" }}>
                <div className="field" style={{ flex: "1 1 120px" }}>
                  <label htmlFor="amt">Amount</label>
                  <input id="amt" type="number" min="0" step="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="field" style={{ flex: "1 1 160px" }}>
                  <label htmlFor="to">Recipient</label>
                  <select id="to" value={to} onChange={(e) => setTo(e.target.value as Recipient)}>
                    {RKEYS.map((r) => (
                      <option key={r} value={r}>{RECIPIENTS[r].label}{r === "attacker" ? " (not on any list)" : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="aid">Action id (optional)</label>
                <input id="aid" type="text" placeholder="report-0001" value={actionId} onChange={(e) => setActionId(e.target.value)} />
              </div>
              <button type="button" className="btn btn--dark" onClick={doSpend} disabled={busy}>Spend</button>
            </div>

            <div className="card">
              <span className="eyebrow">Delegate from {m.label}</span>
              <div className="field">
                <label htmlFor="cap">Child cap</label>
                <input id="cap" type="number" min="0" step="0.1" value={cap} onChange={(e) => setCap(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">Child recipients</span>
                <div className="chips">
                  {RKEYS.map((r) => (
                    <label key={r} className="chk">
                      <input type="checkbox" checked={dRec.includes(r)} onChange={() => toggle(r)} />
                      {RECIPIENTS[r].label}
                    </label>
                  ))}
                </div>
              </div>
              {err && <div className="field__err" role="alert">{err}</div>}
              <button type="button" className="btn btn--slate" onClick={doDelegate} disabled={busy}>Delegate</button>
            </div>

            <div className="row">
              <button type="button" className="btn btn--terra" disabled={busy} onClick={() => apply(`Owner revokes ${m.label}`, revoke(ref.current, sel))}>Revoke subtree</button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => apply(`Time passes: ${m.label} expires`, expire(ref.current, sel))}>Let it expire</button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={reset}>Reset</button>
            </div>

            <div className="card">
              <span className="eyebrow">Program log</span>
              <div className="log" aria-live="polite" style={{ width: "100%" }}>
                {log.length === 0 && <div className="log__empty">Nothing yet. Try the Injection scenario, or spend more than Scout's cap of 2.</div>}
                <AnimatePresence initial={false}>
                  {log.map((e) => (
                    <motion.div key={e.id} layout initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className={`log__item log__item--${e.ok ? "ok" : "err"}`}>
                      <div className="log__head">
                        <span>{e.title}</span>
                        {e.code && <span>{e.code} · {ERRORS[e.code].code}</span>}
                      </div>
                      <div>{e.text}</div>
                      {e.code && <div style={{ opacity: 0.85 }}>program message: “{ERRORS[e.code].message}”</div>}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
