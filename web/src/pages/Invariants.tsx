import { Badge, Bar, Ext, PageHead, Reveal, Split } from "../ui";
import { INVARIANTS, findStep } from "../lib/data";
import { ERRORS } from "../lib/sim";

function Diagram({ id }: { id: string }) {
  const wrap = (children: React.ReactNode) => (
    <div className="panel on-dark stack" style={{ width: "100%" }}>
      <span className="eyebrow">Illustration · example numbers</span>
      {children}
    </div>
  );
  switch (id) {
    case "I1":
      return wrap(
        <>
          <Bar label="Parent" meta="cap 600 · spent 240 · left 360" capPct={100} fillPct={40} />
          <Bar indent={22} label="Child asks 300" meta="allowed" capPct={50} fillPct={0} />
          <Bar indent={22} ghost tone="dead" label="Child asks 500" meta="ExceedsParentBudget" capPct={83} fillPct={0} />
        </>
      );
    case "I2":
      return wrap(
        <>
          <Bar label="Parent" meta="cap 500 · spent 440" capPct={100} fillPct={88} />
          <Bar indent={22} label="Sibling 1" meta="cap 400 · spent 240" capPct={80} fillPct={60} />
          <Bar indent={22} ghost tone="dead" label="Sibling 2 tries 100" meta="BudgetExceeded at Parent" capPct={80} fillPct={0} />
        </>
      );
    case "I3":
      return wrap(
        <>
          <Bar tone="dead" label="Parent" meta="revoked" capPct={100} fillPct={40} />
          <Bar tone="dead" indent={22} label="Child" meta="blocked · Revoked" capPct={60} fillPct={50} />
          <Bar tone="dead" indent={44} label="Grandchild" meta="blocked · Revoked" capPct={30} fillPct={0} />
        </>
      );
    case "I4":
      return wrap(
        <>
          <span className="mono" style={{ fontSize: 12 }}>Scout's allowlist</span>
          <div className="row"><span className="tag tag--dark">Data API</span></div>
          <span className="mono" style={{ fontSize: 12 }}>Spend to</span>
          <div className="row"><Badge tone="ok">Data API · ok</Badge><Badge tone="err">Attacker · RecipientNotAllowed</Badge></div>
        </>
      );
    case "I5":
      return wrap(
        <>
          <span className="mono" style={{ fontSize: 12 }}>Pay 0.4 with action_id report-0001</span>
          <div className="row"><Badge tone="ok">first use · ok</Badge><Badge tone="err">repeat · ReceiptExists</Badge></div>
          <span className="mono" style={{ fontSize: 12 }}>The receipt is an account created with init, so the repeat cannot create it.</span>
        </>
      );
    default:
      return wrap(
        <div className="row">
          <span className="tag tag--dark">spend above instant_limit</span>
          <span className="tag tag--dark">queued</span>
          <span className="tag tag--dark">owner can veto</span>
          <span className="tag tag--dark">executePending after release</span>
        </div>
      );
  }
}

export default function Invariants() {
  return (
    <>
      <PageHead tag="invariants" title="Rules the program checks *every call.*" lede="The program enforces each rule on every call, so a fooled agent cannot talk its way past them." />
      {INVARIANTS.map((inv, i) => {
        const step = inv.proof ? findStep(inv.proof) : undefined;
        return (
          <section key={inv.id} id={inv.slug} className={`section${i % 2 ? " section--parch" : ""}`} style={{ paddingBlock: "clamp(56px,8vw,110px)" }}>
            <div className="container split2" style={{ alignItems: "start" }}>
              <div className="stack stack--lg">
                <Reveal><span className="tag">{inv.id} · {inv.name}</span></Reveal>
                <Split className="display h-md" text={inv.headline} />
                <Reveal delay={0.1}>
                  <div className="rule">{inv.rule.map((r) => <div key={r}>{r}</div>)}</div>
                </Reveal>
                <Reveal delay={0.15}><p className="lede">{inv.reading}</p></Reveal>
                <Reveal delay={0.2}>
                  <div className="stack" style={{ gap: 10 }}>
                    {inv.errors.map((e) => (
                      <div key={e} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <Badge tone="err">{e}</Badge>
                        <span className="inline">{ERRORS[e].code} · {ERRORS[e].message}</span>
                      </div>
                    ))}
                  </div>
                </Reveal>
                {step && <Reveal delay={0.25}><Ext href={step.url}>See it refused on devnet: {step.label}</Ext></Reveal>}
                {!step && <Reveal delay={0.25}><span className="inline">Not part of the recorded devnet run.</span></Reveal>}
                <Reveal delay={0.3}>
                  <details>
                    <summary style={{ cursor: "pointer", font: "500 14px var(--mono)" }}>Test cases in the repo ({inv.tests.length})</summary>
                    <ul className="inline" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
                      {inv.tests.map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  </details>
                </Reveal>
              </div>
              <Reveal><Diagram id={inv.id} /></Reveal>
            </div>
          </section>
        );
      })}
      <section className="section section--ink">
        <div className="container stack stack--lg">
          <Split className="display h-md" text="Also enforced, *underneath.*" />
          <div className="grid grid--2" style={{ width: "100%" }}>
            <div className="card card--ink">
              <h3>Ancestor chain</h3>
              <p>A spend passes its ancestors in order, from the same vault. Wrong order, missing, extra or substituted accounts fail with BadAncestorChain.</p>
            </div>
            <div className="card card--ink">
              <h3>Authority</h3>
              <p>Only the mandate's key can spend or delegate. Anyone else fails with Unauthorized.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
