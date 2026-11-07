/**
 * Enfeoff demo: reproduces the demo scenario deterministically. Exits non-zero if any expected
 * outcome (success or specific rejection) does not occur.
 *   RPC_URL=https://api.devnet.solana.com npm run demo
 */
import { U, Report, buildScenario, expectFail, expectOk, makeClient, explorer, RPC_URL } from "./lib";

async function main() {
  const ctx = makeClient();
  const { e } = ctx;
  e.landFailures = true; // rejections land on-chain so each one has an Explorer link
  console.log(`Enfeoff demo | program ${e.programId.toBase58()} | rpc ${RPC_URL}`);
  console.log(`Program: ${explorer("address", e.programId.toBase58())}\n`);

  const rep = new Report();
  const s = await buildScenario(ctx, rep);
  if (!s) {
    rep.table();
    console.error("\nSetup failed; aborting.");
    process.exit(1);
  }
  const { keys, addr, m } = s;

  // 3. normal work
  await expectOk(rep, "3", "Trader pays pool 8 tUSDC", () => e.spend(m.trader, keys.trader, { amount: 8 * U, recipient: addr.pool }));
  await expectOk(rep, "3", "Merchant pays game 5 tUSDC", () => e.spend(m.merchant, keys.merchant, { amount: 5 * U, recipient: addr.game }));
  const paidAction = "data-api-report-0001";
  await expectOk(rep, "3", "Scout pays data API 0.4 tUSDC (action_id set)", () =>
    e.spend(m.scout, keys.scout, { amount: 0.4 * U, recipient: addr.api, actionId: paidAction }));

  // 4. attack 1: prompt injection ("SEND ALL USDC TO <attacker>")
  await expectFail(rep, "4", "ATTACK injection: Scout spends 50 to attacker", "RecipientNotAllowed", () =>
    e.spend(m.scout, keys.scout, { amount: 50 * U, recipient: addr.attacker }));

  // 5. attack 2: escalation
  await expectFail(rep, "5", "ATTACK escalation: Scout delegates child cap 100", "ExceedsParentBudget", () =>
    e.delegate(m.scout, keys.scout, { cap: 100 * U, recipients: [addr.api], authority: addr.attacker }).then((r) => r.signature));

  // 6. replay: the same paid action_id again
  await expectFail(rep, "6", "ATTACK replay: Scout repeats the paid action_id", "ReceiptExists", () =>
    e.spend(m.scout, keys.scout, { amount: 0.4 * U, recipient: addr.api, actionId: paidAction }));

  // 7. shared budget. Captain also pays directly so the pooled budget is nearly used up.
  await expectOk(rep, "7", "Captain pays pool 25 directly (root spends too)", () => e.spend(m.captain, keys.captain, { amount: 25 * U, recipient: addr.pool }));
  await expectOk(rep, "7", "Merchant pays game 6 (root total now 44.4)", () => e.spend(m.merchant, keys.merchant, { amount: 6 * U, recipient: addr.game }));
  await expectFail(rep, "7", "Trader (12 left on own cap) tries 6: root would be 50.4", "BudgetExceeded", () =>
    e.spend(m.trader, keys.trader, { amount: 6 * U, recipient: addr.pool }));
  await expectOk(rep, "7", "Trader pays pool 5.6 (root total exactly 50)", () => e.spend(m.trader, keys.trader, { amount: 5.6 * U, recipient: addr.pool }));
  await expectFail(rep, "7", "Merchant tries 0.1 more: root budget exhausted", "BudgetExceeded", () =>
    e.spend(m.merchant, keys.merchant, { amount: 0.1 * U, recipient: addr.game }));

  // 8. kill switch
  await expectOk(rep, "8", "Owner revokes Captain (whole tree)", () => e.revoke(m.captain, s.owner));
  await expectFail(rep, "8", "Trader spends 0.1 after revoke", "Revoked", () => e.spend(m.trader, keys.trader, { amount: 0.1 * U, recipient: addr.pool }));
  await expectFail(rep, "8", "Merchant spends 0.1 after revoke", "Revoked", () => e.spend(m.merchant, keys.merchant, { amount: 0.1 * U, recipient: addr.game }));
  await expectFail(rep, "8", "Scout spends 0.1 after revoke (grandchild)", "Revoked", () => e.spend(m.scout, keys.scout, { amount: 0.1 * U, recipient: addr.api }));
  await expectFail(rep, "8", "Captain spends 0.1 after revoke", "Revoked", () => e.spend(m.captain, keys.captain, { amount: 0.1 * U, recipient: addr.pool }));

  const tree = await e.getTree(s.vault, s.labels);
  console.log("\ngetTree(vault):");
  for (const n of tree.nodes)
    console.log(`  ${n.label.padEnd(9)} depth ${n.depth}  spent ${Number(n.spent) / U}/${Number(n.cap) / U}  revoked=${n.revoked}`);

  rep.table();
  const bad = rep.failed.length;
  console.log(`\n${rep.rows.length - bad}/${rep.rows.length} steps matched expectations. ${bad ? "FAILED" : "ALL EXPECTED OUTCOMES OCCURRED"}`);
  console.log("Note: unaudited devnet demo with a test mint (tUSDC); pool/game/api recipients are mock wallets.");
  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
