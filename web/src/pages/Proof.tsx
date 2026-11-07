import { useState } from "react";
import { Badge, Bar, CodeBlock, CopyButton, Counter, Ext, PageHead, Reveal } from "../ui";
import { ALLOWED, MINT_URL, PROGRAM_URL, REJECTED, ROOT_CAP, RUN, SCENES, TREE, short } from "../lib/data";

type Filter = "all" | "ok" | "rejected";
const sigOf = (url: string) => url.split("/tx/")[1]?.split("?")[0] ?? url;

export default function Proof() {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = RUN.steps.filter((s) => (filter === "all" ? true : filter === "ok" ? s.expected === "ok" : s.expected !== "ok"));
  const scenes = Array.from(new Set(shown.map((s) => s.scene)));
  const filters: [Filter, string][] = [
    ["all", `All ${RUN.steps.length}`],
    ["ok", `Allowed ${ALLOWED.length}`],
    ["rejected", `Refused ${REJECTED.length}`],
  ];

  return (
    <>
      <PageHead tag="recorded devnet run" title="Every refusal has a *receipt.*" lede="The output of npm run demo on Solana devnet. Each row links to its transaction in Explorer. A refused transaction shows as failed there: the program saying no." />

      <section className="container" style={{ paddingBottom: 48 }}>
        <div className="grid grid--3">
          <Reveal>
            <div className="card card--parch">
              <span className="eyebrow">Program</span>
              <span className="mono" style={{ overflowWrap: "anywhere", fontSize: 14 }}>{RUN.programId}</span>
              <div className="row"><CopyButton text={RUN.programId} /><Ext href={PROGRAM_URL}>Explorer</Ext></div>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="card card--parch">
              <span className="eyebrow">tUSDC test mint</span>
              <span className="mono" style={{ overflowWrap: "anywhere", fontSize: 14 }}>{RUN.mint}</span>
              <div className="row"><CopyButton text={RUN.mint} /><Ext href={MINT_URL}>Explorer</Ext></div>
            </div>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="card card--ink">
              <span className="eyebrow" style={{ color: "var(--stone)" }}>Result</span>
              <span className="display h-md"><Counter to={RUN.matched} suffix={` / ${RUN.total}`} /></span>
              <p>steps matched the outcome the script expected, including {REJECTED.length} refusals.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 72 }}>
        <div className="chips" role="group" aria-label="Filter steps">
          {filters.map(([k, t]) => (
            <button key={k} type="button" className="fchip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t}</button>
          ))}
        </div>
        <div style={{ marginTop: 28 }}>
          {scenes.map((sc) => (
            <div key={sc} className="tl__scene">
              <Reveal><h3>{SCENES[sc] ?? `Scene ${sc}`}</h3></Reveal>
              <div className="tl__rows">
                {shown.filter((s) => s.scene === sc).map((s, i) => {
                  const rejected = s.expected !== "ok";
                  return (
                    <Reveal key={s.url} delay={i * 0.04} y={14}>
                      <div className="tl__row">
                        <span><Badge tone={rejected ? "err" : "ok"}>{rejected ? s.got : "allowed"}</Badge></span>
                        <p>
                          {s.label}
                          <small>expected {s.expected} · got {s.got}</small>
                        </p>
                        <Ext href={s.url} className="sig">{short(sigOf(s.url), 6)}</Ext>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section section--ink">
        <div className="container split2" style={{ alignItems: "start" }}>
          <div className="stack stack--lg">
            <Reveal><span className="eyebrow">Final state</span></Reveal>
            <Reveal delay={0.05}><h2 className="display h-md">After the kill switch</h2></Reveal>
            <Reveal delay={0.1}>
              <p className="lede">The last step revokes Captain. Trader, Merchant and Scout then fail with Revoked too, though only Captain was revoked.</p>
            </Reveal>
          </div>
          <Reveal>
            <div className="panel on-dark stack" style={{ width: "100%", background: "var(--ink-2)" }}>
              {TREE.map((t) => (
                <Bar key={t.label} label={t.label} meta={`${t.spent} / ${t.cap}${t.revoked ? " · revoked" : t.dead ? " · blocked" : ""}`} capPct={(t.cap / ROOT_CAP) * 100} fillPct={t.cap ? (t.spent / t.cap) * 100 : 0} tone={t.dead ? "dead" : "ok"} indent={t.depth * 22} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container stack stack--lg">
          <Reveal><h2 className="display h-md">Run it yourself</h2></Reveal>
          <Reveal delay={0.05}>
            <p className="lede">The demo exits with an error if any step does not match what it expected.</p>
          </Reveal>
          <Reveal delay={0.1}><CodeBlock lang="sh" title="Terminal" code={`# from the repo root\nRPC_URL=https://api.devnet.solana.com npm run demo`} /></Reveal>
        </div>
      </section>
    </>
  );
}
