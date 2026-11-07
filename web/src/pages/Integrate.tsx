import { Badge, CodeBlock, CopyButton, Ext, PageHead, Reveal, Split } from "../ui";
import { PROGRAM_URL, RUN } from "../lib/data";
import { ERRORS, type ErrorName } from "../lib/sim";

const RAISED_BY: Record<ErrorName, string> = {
  ExceedsParentBudget: "I1",
  ExceedsParentExpiry: "I1",
  ScopeNotSubset: "I1",
  DepthExceeded: "I1",
  TooManyRecipients: "I1",
  BudgetExceeded: "I2",
  ZeroAmount: "I2",
  Revoked: "I3",
  Expired: "I3",
  RecipientNotAllowed: "I4",
  ReceiptExists: "I5",
  RequiresQueue: "I6",
  NotReleased: "I6",
  NotPending: "I6",
  BadAncestorChain: "chain",
  Unauthorized: "authority",
  MathOverflow: "math",
};

const QUICKSTART = `import { Enfeoff } from "./sdk";

const e = new Enfeoff(provider);                       // AnchorProvider on devnet
const { vault } = await e.createVault(owner, mint);
await e.fund(vault, owner, 50_000_000);                // 50 tUSDC, 6 decimals

const { mandate: root } = await e.createRoot(vault, owner, {
  cap: 50_000_000, recipients: [pool, game, api], authority: captain.publicKey,
});
const { mandate: trader } = await e.delegate(root, captain, {
  cap: 20_000_000, recipients: [pool], authority: traderKey.publicKey,
});

await e.spend(trader, traderKey, { amount: 8_000_000, recipient: pool });
await e.spend(trader, traderKey, { amount: 400_000, recipient: pool, actionId: "report-0001" });

await e.revoke(root, owner);                           // the whole subtree stops
const { nodes, edges } = await e.getTree(vault);       // JSON for a UI`;

const TREE_JSON = `// sdk.getTree(vault, labels) returns this shape. Values here are placeholders.
{
  "nodes": [
    {
      "id": "<mandate address>",
      "label": "Captain",
      "authority": "<authority public key>",
      "cap": "50000000",      // base units, as strings
      "spent": "0",
      "expiry": 1790000000,   // unix seconds
      "revoked": false,
      "depth": 0
    }
  ],
  "edges": [{ "from": "<parent address>", "to": "<child address>" }]
}`;

const RUNIT = `npm install
anchor build
anchor test                                   # local validator
RPC_URL=https://api.devnet.solana.com npm run demo
npm run agent -- --scripted                   # forced calls, labelled scripted
npm run agent -- --mistral                    # live model; or --openrouter, --groq`;

export default function Integrate() {
  return (
    <>
      <PageHead tag="sdk" title="Integrate with the *TypeScript SDK.*" lede="The SDK wraps the program's instructions. You pass the mandate and the signer. It finds and orders the ancestor accounts for you, so a spend is one call." />
      <section className="section section--ink" style={{ paddingBlock: "clamp(56px,8vw,110px)" }}>
        <div className="container stack stack--lg">
          <Reveal><h2 className="display h-md">From vault to spend</h2></Reveal>
          <Reveal delay={0.05}><CodeBlock title="TypeScript" code={QUICKSTART} /></Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container split2" style={{ alignItems: "start" }}>
          <div className="stack stack--lg">
            <Split className="display h-md" text="A tree your UI can *draw.*" />
            <Reveal><p className="lede">getTree returns nodes and edges as plain JSON, with amounts as strings.</p></Reveal>
          </div>
          <Reveal><CodeBlock title="getTree result" code={TREE_JSON} /></Reveal>
        </div>
      </section>

      <section className="section section--parch">
        <div className="container stack stack--lg">
          <Split className="display h-md" text="Errors are *named.*" />
          <Reveal><p className="lede">Every refusal has a stable name and a code from 6000 up.</p></Reveal>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Error</th><th>Code</th><th>Message</th><th>From</th></tr></thead>
              <tbody>
                {(Object.keys(ERRORS) as ErrorName[]).map((n) => (
                  <tr key={n}>
                    <td><Badge tone="err">{n}</Badge></td>
                    <td className="inline">{ERRORS[n].code}</td>
                    <td>{ERRORS[n].message}</td>
                    <td className="inline">{RAISED_BY[n]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split2" style={{ alignItems: "start" }}>
          <div className="stack stack--lg">
            <Split className="display h-md" text="Run it *yourself.*" />
            <Reveal>
              <div className="stack" style={{ gap: 12 }}>
                <span className="eyebrow">Program on devnet</span>
                <span className="mono" style={{ overflowWrap: "anywhere", fontSize: 14 }}>{RUN.programId}</span>
                <div className="row"><CopyButton text={RUN.programId} /><Ext href={PROGRAM_URL}>Explorer</Ext></div>
              </div>
            </Reveal>
          </div>
          <Reveal><CodeBlock lang="sh" title="Terminal" code={RUNIT} /></Reveal>
        </div>
      </section>
    </>
  );
}
