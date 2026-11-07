import { Link } from "react-router-dom";
import TornHero from "../TornHero";
import { Bar, Counter, Ext, Magnetic, Marquee, Reveal, Split, Tilt } from "../ui";
import { ERROR_NAMES, INVARIANTS, REJECTED, ROOT_CAP, RUN, TESTS, TREE } from "../lib/data";

function Highlight({ text, needle }: { text: string; needle: string }) {
  const [a, ...rest] = text.split(needle);
  if (!rest.length) return <>{text}</>;
  return (
    <>
      {a}
      <mark>{needle}</mark>
      {rest.join(needle)}
    </>
  );
}

export default function Home() {
  const S = RUN.scripted;
  const first = S.calls[0];
  return (
    <>
      <TornHero />
      <Marquee items={ERROR_NAMES} hot={["RecipientNotAllowed", "Revoked", "BudgetExceeded", "ExceedsParentBudget"]} />

      <section className="section section--ink">
        <div className="container split2" style={{ alignItems: "start" }}>
          <div className="stack stack--lg">
            <Reveal><span className="eyebrow">The problem</span></Reveal>
            <Split className="display h-lg" text="A fooled agent spends whatever it can *reach.*" />
            <Reveal delay={0.1}>
              <p className="lede">Agents read text from the outside world. One poisoned token name can talk an agent into signing a transfer. If the agent holds the whole budget, it can lose the whole budget. Enfeoff gives each agent only the slice it needs, and the program refuses the rest.</p>
            </Reveal>
          </div>
          <div className="stack">
            <Reveal className="stack" delay={0.05}>
              <div className="memo" style={{ width: "100%" }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Token name the agent reads · test fixture</div>
                <Highlight text={S.memo.name} needle={S.attacker} />
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="memo" style={{ width: "100%" }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>The call a hijacked agent would make</div>
                spend({first.args})
              </div>
            </Reveal>
            <Reveal delay={0.25}>
              <div className="memo" style={{ width: "100%", background: "var(--terra)", borderColor: "transparent", color: "var(--paper)" }}>
                <div className="eyebrow" style={{ marginBottom: 10, color: "var(--paper)" }}>Program response on devnet</div>
                Rejected · {first.result} · {first.message}
                <div style={{ marginTop: 12 }}>
                  <Ext href={first.url} className="ext">Open the transaction</Ext>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.3}>
              <p className="eyebrow" style={{ textTransform: "none", letterSpacing: 0, lineHeight: 1.6 }}>Scripted run: the test harness forced this call. No model produced it.</p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split2">
          <div className="stack stack--lg">
            <Reveal><span className="eyebrow">The delegation tree</span></Reveal>
            <Split className="display h-lg" text="Every delegation is a *smaller bar.*" />
            <Reveal delay={0.1}>
              <p className="lede">The outline is what a mandate may spend. The fill is what it has spent. A spend fills the agent and every parent above it. Revoke a parent and everything below it stops.</p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="row">
                <Magnetic><Link to="/playground" className="btn btn--dark">Try it yourself</Link></Magnetic>
              </div>
            </Reveal>
          </div>
          <Reveal>
            <div className="panel on-dark stack" style={{ width: "100%" }}>
              <span className="eyebrow">State after the recorded devnet run, in tUSDC</span>
              {TREE.map((t) => (
                <Bar key={t.label} label={t.label} meta={`${t.spent} / ${t.cap}${t.revoked ? " · revoked" : t.dead ? " · blocked" : ""}`} capPct={(t.cap / ROOT_CAP) * 100} fillPct={t.cap ? (t.spent / t.cap) * 100 : 0} tone={t.dead ? "dead" : "ok"} indent={t.depth * 22} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section section--parch">
        <div className="container stack stack--lg">
          <Reveal><span className="eyebrow">The rules</span></Reveal>
          <Split className="display h-lg" text="Five rules the program checks *every time.*" />
          <div className="grid grid--5" style={{ width: "100%", marginTop: 12 }}>
            {INVARIANTS.filter((i) => i.id !== "I6").map((inv, k) => (
              <Reveal key={inv.id} delay={k * 0.06}>
                <Tilt>
                  <div className="card">
                    <span className="tag">{inv.id} · {inv.name}</span>
                    <h3>{inv.headline}</h3>
                    <div className="rule">{inv.rule[0]}</div>
                    <Link to={`/invariants#${inv.slug}`} className="ext" style={{ marginTop: "auto" }}>Details and tests →</Link>
                  </div>
                </Tilt>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--ink">
        <div className="container stack stack--lg">
          <Reveal><span className="eyebrow">What the recorded run shows</span></Reveal>
          <Split className="display h-lg" text="Checked on devnet, *step by step.*" />
          <div className="stats" style={{ width: "100%" }}>
            <div className="stat">
              <div className="stat__n"><Counter to={RUN.matched} suffix={`/${RUN.total}`} /></div>
              <p>steps in npm run demo matched the outcome the script expected.</p>
            </div>
            <div className="stat">
              <div className="stat__n"><Counter to={REJECTED.length} /></div>
              <p>refusals landed on devnet. Each has a signature you can open in Explorer.</p>
            </div>
            <div className="stat">
              <div className="stat__n"><Counter to={TESTS.passing} /></div>
              <p>tests passing in the latest anchor test run.</p>
            </div>
          </div>
          <Reveal>
            <div className="row">
              <Magnetic><Link to="/proof" className="btn btn--inv">Open the recorded run</Link></Magnetic>
              <Magnetic><Link to="/agent" className="btn btn--inv">See the scripted agent run</Link></Magnetic>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section section--sage">
        <div className="container stack stack--lg">
          <Split className="display h-lg" text="Hand an agent a budget, *not a wallet.*" />
          <Reveal>
            <div className="row">
              <Magnetic><Link to="/playground" className="btn btn--inv">Open the demo</Link></Magnetic>
              <Magnetic><Link to="/integrate" className="btn btn--inv">Integrate the SDK</Link></Magnetic>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
