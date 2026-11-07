import { Reveal, PageHead } from "../ui";
import { LIVE_NOTE, RUN, TESTS } from "../lib/data";

export default function Limits() {
  const cols: { title: string; tone: string; items: string[] }[] = [
    {
      title: "What is real",
      tone: "card--parch",
      items: [
        `The program is deployed on Solana devnet at ${RUN.programId}.`,
        `The recorded demo ran ${RUN.total} steps on devnet and ${RUN.matched} matched what the script expected. Each has a transaction signature.`,
        `The latest anchor test run: ${TESTS.passing} passing, ${TESTS.failing} failing.`,
      ],
    },
    {
      title: "What is simulated, scripted or mock",
      tone: "",
      items: [
        "The delegation tree page is a simulation in your browser. It never touches the chain.",
        "The agent demonstration is scripted. The test harness forced the bad calls.",
        "tUSDC is a self-made test mint with no value.",
        "The pool, game and data API recipients are mock wallets.",
        "The veto window is in the program and SDK but not in the recorded devnet run.",
      ],
    },
    {
      title: "What is not built or not claimed",
      tone: "card--ink",
      items: [
        "The code is unaudited. Do not use it with real funds.",
        "There is no mainnet deployment.",
        LIVE_NOTE,
        "This site does not read the chain live and has no wallet connection.",
        "No comparison with other delegation approaches is made, and no claim of novelty.",
      ],
    },
  ];
  return (
    <>
      <PageHead tag="limits" title="What Enfeoff *does not do.*" lede="Enfeoff bounds the damage a compromised agent can do. It does not stop that agent from spending within its own cap." />
      <section className="container" style={{ paddingBottom: "clamp(72px,10vw,140px)" }}>
        <div className="grid grid--3">
          {cols.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <div className={`card ${c.tone}`} style={{ gap: 18 }}>
                <h3>{c.title}</h3>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 12, fontSize: 15, lineHeight: 1.55 }}>
                  {c.items.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
