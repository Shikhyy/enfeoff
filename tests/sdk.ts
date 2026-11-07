import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { Enfeoff, errorName, explainError } from "../sdk";

describe("sdk", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const U = 1_000_000;

  it("tree, spend, revoke and error explanations through the SDK", async () => {
    const e = new Enfeoff(provider);
    const owner = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(owner.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
    const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    const { vault } = await e.createVault(owner, mint);
    // fund through the SDK: owner holds tokens, then fund()
    const ownerAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, owner.publicKey);
    await mintTo(provider.connection, payer, mint, ownerAta.address, payer, 50 * U);
    await e.fund(vault, owner, 50 * U);

    const [kc, km, ks] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const api = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const { mandate: captain } = await e.createRoot(vault, owner, { cap: 50 * U, recipients: [api], authority: kc.publicKey });
    const { mandate: merchant } = await e.delegate(captain, kc, { cap: 15 * U, recipients: [api], authority: km.publicKey });
    const { mandate: scout } = await e.delegate(merchant, km, { cap: 2 * U, recipients: [api], authority: ks.publicKey });

    await e.spend(scout, ks, { amount: 0.4 * U, recipient: api });
    const apiAta = getAssociatedTokenAddressSync(mint, api);
    expect(Number((await getAccount(provider.connection, apiAta)).amount)).to.eq(0.4 * U);

    const tree = await e.getTree(vault, { [captain.toBase58()]: "Captain", [scout.toBase58()]: "Scout" });
    expect(tree.nodes).to.have.length(3);
    expect(tree.edges).to.have.length(2);
    const sc = tree.nodes.find((n) => n.label === "Scout")!;
    expect(sc.spent).to.eq(String(0.4 * U));
    expect(sc.depth).to.eq(2);
    expect(tree.edges).to.deep.include({ from: merchant.toBase58(), to: scout.toBase58() });
    JSON.stringify(tree); // must be JSON-safe

    // rejected spend is explained
    try {
      await e.spend(scout, ks, { amount: 50 * U, recipient: attacker });
      throw new Error("should have failed");
    } catch (err) {
      expect(errorName(err)).to.eq("RecipientNotAllowed");
      expect(explainError(err)).to.contain("allowlist");
    }
    // revoke via parent authority (SDK picks the parent account itself)
    await e.revoke(scout, km);
    try {
      await e.spend(scout, ks, { amount: 0.1 * U, recipient: api });
      throw new Error("should have failed");
    } catch (err) {
      expect(errorName(err)).to.eq("Revoked");
    }
    const after = await e.getTree(vault);
    expect(after.nodes.find((n) => n.id === scout.toBase58())!.revoked).to.eq(true);
  });

  describe("I6 veto window", () => {
    async function setup() {
      const e = new Enfeoff(provider);
      const owner = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(owner.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
      const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
      const { vault, vaultToken } = await e.createVault(owner, mint);
      await mintTo(provider.connection, payer, mint, vaultToken, payer, 100 * U);
      const [kc, kt, kx] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const pool = Keypair.generate().publicKey;
      const { mandate: captain } = await e.createRoot(vault, owner, { cap: 50 * U, recipients: [pool], authority: kc.publicKey });
      const { mandate: trader } = await e.delegate(captain, kc, { cap: 20 * U, recipients: [pool], authority: kt.publicKey });
      await e.setVetoPolicy(captain, owner, { instantLimit: 5 * U, releaseDelay: 6 });
      return { e, owner, mint, vault, kc, kt, kx, pool, captain, trader };
    }
    const chainNow = async () => Number((await provider.connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111")))!.data.readBigInt64LE(32));
    const waitPast = async (ts: number) => { while ((await chainNow()) <= ts) await new Promise((r) => setTimeout(r, 1000)); };
    const bal = async (mint: PublicKey, o: PublicKey) => {
      try { return Number((await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, o))).amount); } catch { return 0; }
    };

    it("a limit on an ancestor forces large spends of descendants through the queue", async () => {
      const t = await setup();
      await t.e.spend(t.trader, t.kt, { amount: 5 * U, recipient: t.pool }); // at the limit: instant
      try { await t.e.spend(t.trader, t.kt, { amount: 5 * U + 1, recipient: t.pool }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("RequiresQueue"); }
      try { await t.e.spend(t.captain, t.kc, { amount: 6 * U, recipient: t.pool }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("RequiresQueue"); }
    });

    it("queued spend cannot execute early, executes after the delay, and cannot execute twice", async () => {
      const t = await setup();
      const { pending } = await t.e.queueSpend(t.trader, t.kt, { amount: 8 * U, recipient: t.pool, nonce: 1 });
      try { await t.e.executePending(pending, t.kt); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("NotReleased"); }
      expect(await bal(t.mint, t.pool)).to.eq(0);
      expect((await t.e.getMandate(t.trader)).spent.toNumber()).to.eq(0); // not charged while queued
      await waitPast((await t.e.getPending(pending)).releaseAt.toNumber());
      await t.e.executePending(pending, t.kt);
      expect(await bal(t.mint, t.pool)).to.eq(8 * U);
      expect((await t.e.getMandate(t.trader)).spent.toNumber()).to.eq(8 * U);
      expect((await t.e.getMandate(t.captain)).spent.toNumber()).to.eq(8 * U);
      try { await t.e.executePending(pending, t.kt); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("NotPending"); }
    });

    it("the owner can veto before release; a vetoed spend never executes; others cannot veto", async () => {
      const t = await setup();
      const { pending } = await t.e.queueSpend(t.trader, t.kt, { amount: 8 * U, recipient: t.pool, nonce: 2 });
      try { await t.e.veto(pending, t.kc); throw new Error("should fail"); } // even the parent's authority
      catch (err) { expect(errorName(err)).to.eq("Unauthorized"); }
      await t.e.veto(pending, t.owner);
      await waitPast((await t.e.getPending(pending)).releaseAt.toNumber());
      try { await t.e.executePending(pending, t.kt); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("NotPending"); }
      expect(await bal(t.mint, t.pool)).to.eq(0);
      expect((await t.e.getMandate(t.captain)).spent.toNumber()).to.eq(0);
    });

    it("every invariant is re-checked at release: revoke during the delay blocks execution", async () => {
      const t = await setup();
      const { pending } = await t.e.queueSpend(t.trader, t.kt, { amount: 8 * U, recipient: t.pool, nonce: 3 });
      await t.e.revoke(t.captain, t.owner);
      await waitPast((await t.e.getPending(pending)).releaseAt.toNumber());
      try { await t.e.executePending(pending, t.kt); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("Revoked"); }
      expect(await bal(t.mint, t.pool)).to.eq(0);
    });

    it("queueing still enforces scope and budget; only the owner sets the policy", async () => {
      const t = await setup();
      try { await t.e.queueSpend(t.trader, t.kt, { amount: 8 * U, recipient: Keypair.generate().publicKey, nonce: 4 }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("RecipientNotAllowed"); }
      try { await t.e.queueSpend(t.trader, t.kt, { amount: 21 * U, recipient: t.pool, nonce: 5 }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("BudgetExceeded"); }
      try { await t.e.setVetoPolicy(t.trader, t.kt, { instantLimit: 1, releaseDelay: 0 }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("Unauthorized"); }
      try { await t.e.queueSpend(t.trader, t.kx, { amount: 8 * U, recipient: t.pool, nonce: 6 }); throw new Error("should fail"); }
      catch (err) { expect(errorName(err)).to.eq("Unauthorized"); }
    });
  });
});
