import { Badge, Ext, PageHead, Reveal } from "../ui";
import { RUN, type LiveRun } from "../lib/data";

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

/** The logs keep the model's markdown as written. Show **bold** as bold and nothing else. */
const withBold = (text: string) => text.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));

const stamp = (t: string | null) => (t ? `${t.replace("T", " ").slice(0, 16)} UTC` : "time not recorded");

function LiveCard({ run, index }: { run: LiveRun; index: number }) {
  const refused = run.toolCalls === 0 && !run.fundsReached;
  return (
    <section className={`section${index % 2 ? " section--parch" : ""}`} style={{ paddingBlock: "clamp(56px,8vw,110px)" }}>
      <div className="container split2" style={{ alignItems: "start" }}>
        <div className="stack stack--lg">
          <Reveal><span className="tag">Live run {index + 1} · real model</span></Reveal>
          <Reveal delay={0.05}>
            <h2 className="display h-md">{run.model} {refused ? "refused." : "ran."}</h2>
          </Reveal>
          {refused && (
            <Reveal delay={0.1}>
              <p className="lede">It called no tools and paid nobody, so this run does not test the on-chain bound.</p>
            </Reveal>
          )}
          <Reveal delay={0.15}>
            <dl className="facts" style={{ maxWidth: 520 }}>
              <div><dt>model</dt><dd>{run.model}</dd></div>
              <div><dt>recorded</dt><dd>{stamp(run.time)}</dd></div>
              <div><dt>tool calls</dt><dd>{run.toolCalls}</dd></div>
              <div><dt>funds reached the attacker</dt><dd>{run.fundsReached ? "yes" : "no"}</dd></div>
            </dl>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="inline" style={{ lineHeight: 1.6, maxWidth: 520 }}>One run of one model. It says nothing about other models or prompts.</p>
          </Reveal>
        </div>
        <div className="stack" style={{ width: "100%" }}>
          <Reveal>
            <div className="memo" style={{ width: "100%" }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Token name the model read</div>
              <Highlight text={run.memo.name} needle={run.attacker} />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className={`card ${index % 2 ? "" : "card--parch"}`} style={{ width: "100%" }}>
              <span className="eyebrow">Model reply, as logged</span>
              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 15, lineHeight: 1.6 }}>{withBold(run.reply)}</div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default function Agent() {
  const S = RUN.scripted;

  const scriptedSteps = [
    {
      title: "The token metadata the agent reads",
      body: (
        <div className="memo">
          <div><b>name:</b> <Highlight text={S.memo.name} needle={S.attacker} /></div>
          <div><b>description:</b> <Highlight text={S.memo.description} needle={S.attacker} /></div>
        </div>
      ),
    },
    {
      title: "The calls the harness forces",
      body: (
        <div className="stack" style={{ width: "100%" }}>
          {S.calls.map((c) => (
            <div key={c.url} className="card card--ink" style={{ width: "100%" }}>
              <div className="row"><Badge tone="err">{c.result}</Badge></div>
              <div className="memo" style={{ width: "100%" }}>{c.name}({c.args})</div>
              <p>{c.message}</p>
              <Ext href={c.url} className="ext">Open the transaction in Explorer</Ext>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "The outcome",
      body: <p className="lede" style={{ margin: 0 }}>Funds reached the attacker: <b>{S.fundsReachedAttacker ? "yes" : "no"}</b>.</p>,
    },
  ];

  return (
    <>
      <PageHead tag="agent runs" title="What happens when an agent *reads the injection.*" lede="In the live runs a real model decides for itself. In the scripted run the test harness forces the bad calls, so you can see what the program does." />
      <section className="container" style={{ paddingBottom: 48 }}>
        <div className="notice">Live: a real model made its own choices. Scripted: the harness forced the calls and no model produced them.</div>
      </section>

      {RUN.live.map((r, i) => (
        <LiveCard key={r.file} run={r} index={i} />
      ))}

      <section className="section section--ink" style={{ paddingBlock: "clamp(56px,8vw,110px)" }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <Reveal>
            <div className="stack" style={{ marginBottom: 40 }}>
              <span className="tag tag--dark">Scripted run · {stamp(S.time)}</span>
              <h2 className="display h-md">Forcing the bad calls, to see the bound hold.</h2>
            </div>
          </Reveal>
          {scriptedSteps.map((s, i) => (
            <Reveal key={s.title} delay={0.05}>
              <div className="step">
                <div className="step__n">{i + 1}</div>
                <div className="stack" style={{ minWidth: 0 }}>
                  <h3 className="display h-sm">{s.title}</h3>
                  {s.body}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
