import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Enfeoff } from "../target/types/enfeoff";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

anchor.setProvider(anchor.AnchorProvider.env());
const provider = anchor.getProvider() as anchor.AnchorProvider;
const program = anchor.workspace.enfeoff as Program<Enfeoff>;
const conn = provider.connection;
const payer = (provider.wallet as anchor.Wallet).payer;
const U = 1_000_000; // 1 tUSDC (6 decimals)

// ---------------------------------------------------------------- helpers
async function chainTime(): Promise<number> {
  const a = await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  return Number(a!.data.readBigInt64LE(32)); // Clock.unix_timestamp
}
async function waitChainPast(ts: number) {
  while ((await chainTime()) <= ts) await new Promise((r) => setTimeout(r, 1000));
}
const pda = (seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const vaultPda = (owner: PublicKey) => pda([Buffer.from("vault"), owner.toBuffer()]);
const mandatePda = (vault: PublicKey, id: number) =>
  pda([Buffer.from("mandate"), vault.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)]);

async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const named = e?.error?.errorCode?.code;
    if (named !== undefined) {
      if (named === code) return;
      throw new Error(`expected ${code}, got ${named}: ${e.message}`);
    }
    const text = String(e?.message) + (e?.logs ?? []).join("\n");
    if (text.includes(code)) return;
    throw new Error(`expected ${code}, got: ${text}`);
  }
  throw new Error(`expected ${code} but the transaction succeeded`);
}

let mint: PublicKey;
interface World {
  owner: Keypair;
  vault: PublicKey;
  vaultToken: PublicKey;
}

async function newWorld(fund = 100 * U): Promise<World> {
  const owner = Keypair.generate();
  const sig = await conn.requestAirdrop(owner.publicKey, 5 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  const vault = vaultPda(owner.publicKey);
  const vaultToken = getAssociatedTokenAddressSync(mint, vault, true);
  await program.methods
    .createVault()
    .accountsPartial({
      vault,
      mint,
      vaultToken,
      owner: owner.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner])
    .rpc();
  await mintTo(conn, payer, mint, vaultToken, payer, fund);
  return { owner, vault, vaultToken };
}

async function nextId(w: World) {
  return (await program.account.vault.fetch(w.vault)).nextId.toNumber();
}

async function root(
  w: World,
  o: { cap: number; expiry?: number; allowAny?: boolean; recipients?: PublicKey[]; authority: Keypair }
) {
  const m = mandatePda(w.vault, await nextId(w));
  await program.methods
    .createRoot(
      new BN(o.cap),
      new BN(o.expiry ?? (await chainTime()) + 86400),
      !!o.allowAny,
      o.recipients ?? [],
      o.authority.publicKey
    )
    .accountsPartial({
      vault: w.vault,
      mandate: m,
      owner: w.owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([w.owner])
    .rpc();
  return m;
}

async function delegate(
  w: World,
  parent: PublicKey,
  signer: Keypair,
  o: { cap: number; expiry?: number; allowAny?: boolean; recipients?: PublicKey[]; authority: Keypair }
) {
  const m = mandatePda(w.vault, await nextId(w));
  const expiry = o.expiry ?? (await program.account.mandate.fetch(parent)).expiry.toNumber();
  await program.methods
    .delegate(new BN(o.cap), new BN(expiry), !!o.allowAny, o.recipients ?? [], o.authority.publicKey)
    .accountsPartial({
      vault: w.vault,
      parent,
      mandate: m,
      authority: signer.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([signer])
    .rpc();
  return m;
}

async function ancestorsOf(m: PublicKey): Promise<PublicKey[]> {
  const out: PublicKey[] = [];
  let cur = await program.account.mandate.fetch(m);
  while (!cur.parent.equals(PublicKey.default)) {
    out.push(cur.parent);
    cur = await program.account.mandate.fetch(cur.parent);
  }
  return out;
}

async function spend(
  w: World,
  m: PublicKey,
  signer: Keypair,
  recipientOwner: PublicKey,
  amount: number,
  anc?: PublicKey[],
  writable = true
) {
  const recipientToken = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, recipientOwner)).address;
  const a = anc ?? (await ancestorsOf(m));
  return program.methods
    .spend(new BN(amount))
    .accountsPartial({
      vault: w.vault,
      mandate: m,
      authority: signer.publicKey,
      vaultToken: w.vaultToken,
      recipientToken,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(a.map((pubkey) => ({ pubkey, isWritable: writable, isSigner: false })))
    .signers([signer])
    .rpc();
}

async function revoke(w: World, m: PublicKey, signer: Keypair, parent?: PublicKey) {
  return program.methods
    .revoke()
    .accountsPartial({
      vault: w.vault,
      mandate: m,
      signer: signer.publicKey,
      parent: parent ?? null,
    })
    .signers([signer])
    .rpc();
}

const mand = (m: PublicKey) => program.account.mandate.fetch(m);
async function bal(owner: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  try {
    return Number((await getAccount(conn, ata)).amount);
  } catch {
    return 0;
  }
}

/** The demo scenario tree: Captain 50 -> Trader 20 / Merchant 15 -> Scout 2 (under Merchant). */
async function demoTree() {
  const w = await newWorld(100 * U);
  const k = {
    captain: Keypair.generate(),
    trader: Keypair.generate(),
    merchant: Keypair.generate(),
    scout: Keypair.generate(),
    stranger: Keypair.generate(),
  };
  const pool = Keypair.generate().publicKey;
  const game = Keypair.generate().publicKey;
  const api = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const captain = await root(w, { cap: 50 * U, recipients: [pool, game, api], authority: k.captain });
  const trader = await delegate(w, captain, k.captain, { cap: 20 * U, recipients: [pool], authority: k.trader });
  const merchant = await delegate(w, captain, k.captain, { cap: 15 * U, recipients: [game, api], authority: k.merchant });
  const scout = await delegate(w, merchant, k.merchant, { cap: 2 * U, recipients: [api], authority: k.scout });
  return { w, k, pool, game, api, attacker, captain, trader, merchant, scout };
}

// ------------------------------------------------------------------ tests
describe("enfeoff", () => {
  before(async () => {
    mint = await createMint(conn, payer, payer.publicKey, null, 6);
  });

  describe("I1 attenuation", () => {
    it("delegate within bounds succeeds and records lineage", async () => {
      const t = await demoTree();
      const tr = await mand(t.trader);
      expect(tr.parent.toBase58()).to.eq(t.captain.toBase58());
      expect(tr.depth).to.eq(1);
      expect(tr.cap.toNumber()).to.eq(20 * U);
      expect(tr.spent.toNumber()).to.eq(0);
      const sc = await mand(t.scout);
      expect(sc.parent.toBase58()).to.eq(t.merchant.toBase58());
      expect(sc.depth).to.eq(2);
    });

    it("cap above parent's budget fails: ExceedsParentBudget", async () => {
      const t = await demoTree();
      await expectErr(
        delegate(t.w, t.captain, t.k.captain, { cap: 50 * U + 1, recipients: [t.pool], authority: t.k.stranger }),
        "ExceedsParentBudget"
      );
      // Scout escalation attempt from DEMO step 5
      await expectErr(
        delegate(t.w, t.scout, t.k.scout, { cap: 100 * U, recipients: [t.api], authority: t.k.stranger }),
        "ExceedsParentBudget"
      );
    });

    it("child cap is bounded by parent.cap - parent.spent", async () => {
      const t = await demoTree();
      await spend(t.w, t.trader, t.k.trader, t.pool, 8 * U);
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: 13 * U, recipients: [t.pool], authority: t.k.stranger }),
        "ExceedsParentBudget"
      );
      await delegate(t.w, t.trader, t.k.trader, { cap: 12 * U, recipients: [t.pool], authority: t.k.stranger });
    });

    it("expiry later than parent fails: ExceedsParentExpiry", async () => {
      const t = await demoTree();
      const pe = (await mand(t.trader)).expiry.toNumber();
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: U, expiry: pe + 1, recipients: [t.pool], authority: t.k.stranger }),
        "ExceedsParentExpiry"
      );
      await delegate(t.w, t.trader, t.k.trader, { cap: U, expiry: pe - 10, recipients: [t.pool], authority: t.k.stranger });
    });

    it("recipients not a subset fail: ScopeNotSubset", async () => {
      const t = await demoTree();
      // trader only has [pool]; game belongs to captain but not to trader
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: U, recipients: [t.game], authority: t.k.stranger }),
        "ScopeNotSubset"
      );
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: U, recipients: [t.pool, t.attacker], authority: t.k.stranger }),
        "ScopeNotSubset"
      );
      // wildcard cannot be minted from a restricted parent
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: U, allowAny: true, authority: t.k.stranger }),
        "ScopeNotSubset"
      );
      // empty scope
      await expectErr(
        delegate(t.w, t.trader, t.k.trader, { cap: U, recipients: [], authority: t.k.stranger }),
        "ScopeNotSubset"
      );
    });

    it("more than 4 recipients fails: TooManyRecipients", async () => {
      const w = await newWorld();
      const five = [1, 2, 3, 4, 5].map(() => Keypair.generate().publicKey);
      await expectErr(root(w, { cap: U, recipients: five, authority: Keypair.generate() }), "TooManyRecipients");
    });

    it("depth is capped at 4: DepthExceeded", async () => {
      const w = await newWorld();
      const api = Keypair.generate().publicKey;
      const keys = [0, 1, 2, 3, 4, 5].map(() => Keypair.generate());
      let m = await root(w, { cap: 10 * U, recipients: [api], authority: keys[0] });
      for (let d = 1; d <= 4; d++) {
        m = await delegate(w, m, keys[d - 1], { cap: (10 - d) * U, recipients: [api], authority: keys[d] });
        expect((await mand(m)).depth).to.eq(d);
      }
      await expectErr(
        delegate(w, m, keys[4], { cap: U, recipients: [api], authority: keys[5] }),
        "DepthExceeded"
      );
      // depth-4 leaf (4 ancestors) can still spend within one transaction
      await spend(w, m, keys[4], api, U);
      expect((await mand(m)).spent.toNumber()).to.eq(U);
    });

    it("an expired or revoked parent cannot delegate", async () => {
      const w = await newWorld();
      const api = Keypair.generate().publicKey;
      const ka = Keypair.generate();
      const t0 = await chainTime();
      const r = await root(w, { cap: 5 * U, expiry: t0 + 6, recipients: [api], authority: ka });
      const r2 = await root(w, { cap: 5 * U, recipients: [api], authority: ka });
      await revoke(w, r2, w.owner);
      await expectErr(delegate(w, r2, ka, { cap: U, recipients: [api], authority: Keypair.generate() }), "Revoked");
      await waitChainPast(t0 + 6);
      await expectErr(
        delegate(w, r, ka, { cap: U, expiry: t0 + 5, recipients: [api], authority: Keypair.generate() }),
        "Expired"
      );
    });
  });

  describe("I2 shared budget", () => {
    it("spend increments the leaf and every ancestor", async () => {
      const t = await demoTree();
      await spend(t.w, t.scout, t.k.scout, t.api, 0.4 * U);
      expect((await mand(t.scout)).spent.toNumber()).to.eq(0.4 * U);
      expect((await mand(t.merchant)).spent.toNumber()).to.eq(0.4 * U);
      expect((await mand(t.captain)).spent.toNumber()).to.eq(0.4 * U);
      expect((await mand(t.trader)).spent.toNumber()).to.eq(0); // sibling branch untouched
      expect(await bal(t.api)).to.eq(0.4 * U);
    });

    it("a leaf cannot exceed its own cap: BudgetExceeded", async () => {
      const t = await demoTree();
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 2 * U + 1), "BudgetExceeded");
      await spend(t.w, t.scout, t.k.scout, t.api, 2 * U); // exactly the cap is fine
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 1), "BudgetExceeded");
    });

    it("sibling caps may sum above the parent but total spend cannot", async () => {
      const w = await newWorld();
      const pool = Keypair.generate().publicKey;
      const [kr, ka, kb] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const r = await root(w, { cap: 10 * U, recipients: [pool], authority: kr });
      const a = await delegate(w, r, kr, { cap: 8 * U, recipients: [pool], authority: ka });
      const b = await delegate(w, r, kr, { cap: 8 * U, recipients: [pool], authority: kb }); // 16 > 10: allowed
      await spend(w, a, ka, pool, 8 * U);
      await expectErr(spend(w, b, kb, pool, 3 * U), "BudgetExceeded"); // root would hit 11
      expect((await mand(b)).spent.toNumber()).to.eq(0); // atomic: nothing was charged
      expect((await mand(r)).spent.toNumber()).to.eq(8 * U);
      await spend(w, b, kb, pool, 2 * U);
      expect((await mand(r)).spent.toNumber()).to.eq(10 * U);
      await expectErr(spend(w, b, kb, pool, 1), "BudgetExceeded");
      expect(await bal(pool)).to.eq(10 * U);
    });

    it("zero amount fails: ZeroAmount; overspending the vault balance fails", async () => {
      const w = await newWorld(1 * U);
      const pool = Keypair.generate().publicKey;
      const kr = Keypair.generate();
      const r = await root(w, { cap: 50 * U, recipients: [pool], authority: kr });
      await expectErr(spend(w, r, kr, pool, 0), "ZeroAmount");
      let failed = false;
      try {
        await spend(w, r, kr, pool, 2 * U); // within cap, above the vault's funds
      } catch {
        failed = true;
      }
      expect(failed).to.eq(true);
      expect((await mand(r)).spent.toNumber()).to.eq(0);
    });
  });

  describe("I3 cascading revoke and expiry", () => {
    it("revoking a parent blocks its child, not its sibling", async () => {
      const t = await demoTree();
      await revoke(t.w, t.merchant, t.w.owner);
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U), "Revoked");
      await expectErr(spend(t.w, t.merchant, t.k.merchant, t.game, 0.1 * U), "Revoked");
      await spend(t.w, t.trader, t.k.trader, t.pool, 0.1 * U); // untouched branch still works
    });

    it("revoking the root blocks the whole tree", async () => {
      const t = await demoTree();
      await revoke(t.w, t.captain, t.w.owner);
      await expectErr(spend(t.w, t.captain, t.k.captain, t.pool, U), "Revoked");
      await expectErr(spend(t.w, t.trader, t.k.trader, t.pool, U), "Revoked");
      await expectErr(spend(t.w, t.merchant, t.k.merchant, t.game, U), "Revoked");
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U), "Revoked");
      await expectErr(
        delegate(t.w, t.captain, t.k.captain, { cap: U, recipients: [t.pool], authority: t.k.stranger }),
        "Revoked"
      );
    });

    it("a parent's authority can revoke its child", async () => {
      const t = await demoTree();
      await revoke(t.w, t.trader, t.k.captain, t.captain);
      expect((await mand(t.trader)).revoked).to.eq(true);
      await expectErr(spend(t.w, t.trader, t.k.trader, t.pool, U), "Revoked");
    });

    it("only the owner or the parent's authority can revoke: Unauthorized", async () => {
      const t = await demoTree();
      await expectErr(revoke(t.w, t.trader, t.k.stranger), "Unauthorized"); // stranger, no parent
      await expectErr(revoke(t.w, t.trader, t.k.stranger, t.captain), "Unauthorized"); // stranger, right parent
      await expectErr(revoke(t.w, t.trader, t.k.merchant, t.captain), "Unauthorized"); // sibling
      await expectErr(revoke(t.w, t.captain, t.k.trader, t.trader), "Unauthorized"); // child vs parent, wrong parent
      await expectErr(revoke(t.w, t.trader, t.k.trader), "Unauthorized"); // self
      await expectErr(revoke(t.w, t.captain, t.k.captain), "Unauthorized"); // root authority is not the owner
    });

    it("an expired ancestor blocks child spend: Expired", async () => {
      const w = await newWorld();
      const api = Keypair.generate().publicKey;
      const [kr, kc] = [Keypair.generate(), Keypair.generate()];
      const t0 = await chainTime();
      const r = await root(w, { cap: 10 * U, expiry: t0 + 8, recipients: [api], authority: kr });
      const c = await delegate(w, r, kr, { cap: 5 * U, recipients: [api], authority: kc });
      await spend(w, c, kc, api, U); // fine while alive
      await waitChainPast(t0 + 8);
      await expectErr(spend(w, c, kc, api, U), "Expired");
      await expectErr(spend(w, r, kr, api, U), "Expired");
    });
  });

  describe("I4 scoped recipients", () => {
    it("injection: spend to a non-allowlisted recipient fails with RecipientNotAllowed", async () => {
      const t = await demoTree();
      // DEMO step 4: the poisoned agent tries to send 50 to the attacker
      await expectErr(spend(t.w, t.scout, t.k.scout, t.attacker, 50 * U), "RecipientNotAllowed");
      await expectErr(spend(t.w, t.scout, t.k.scout, t.attacker, 0.1 * U), "RecipientNotAllowed");
      // in the parent's list but not in the child's own list
      await expectErr(spend(t.w, t.trader, t.k.trader, t.game, U), "RecipientNotAllowed");
      expect(await bal(t.attacker)).to.eq(0);
    });

    it("an allow_any root may pay anyone; allow_any can be passed only from an allow_any parent", async () => {
      const w = await newWorld();
      const anyone = Keypair.generate().publicKey;
      const [kr, kc, kd] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const r = await root(w, { cap: 10 * U, allowAny: true, authority: kr });
      await spend(w, r, kr, anyone, U);
      const wild = await delegate(w, r, kr, { cap: 5 * U, allowAny: true, authority: kc });
      await spend(w, wild, kc, anyone, U);
      // default (allowAny false) narrows to the listed recipients
      const narrow = await delegate(w, r, kr, { cap: 5 * U, recipients: [anyone], authority: kd });
      const other = Keypair.generate().publicKey;
      await expectErr(spend(w, narrow, kd, other, U), "RecipientNotAllowed");
      await spend(w, narrow, kd, anyone, U);
    });
  });

  describe("ancestor chain verification", () => {
    it("wrong order, missing, extra or substituted ancestors fail: BadAncestorChain", async () => {
      const t = await demoTree();
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.captain, t.merchant]), "BadAncestorChain");
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, []), "BadAncestorChain");
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.merchant]), "BadAncestorChain");
      await expectErr(
        spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.merchant, t.captain, t.captain]),
        "BadAncestorChain"
      );
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.trader, t.captain]), "BadAncestorChain");
      await expectErr(spend(t.w, t.trader, t.k.trader, t.pool, U, [t.merchant]), "BadAncestorChain");
      await expectErr(spend(t.w, t.trader, t.k.trader, t.pool, U, [t.scout]), "BadAncestorChain");
      // a root with a stray ancestor
      await expectErr(spend(t.w, t.captain, t.k.captain, t.pool, U, [t.captain]), "BadAncestorChain");
      // correct chain still works afterwards and nothing was charged by the failures
      expect((await mand(t.captain)).spent.toNumber()).to.eq(0);
      await spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.merchant, t.captain]);
    });

    it("ancestors must be writable accounts", async () => {
      const t = await demoTree();
      await expectErr(
        spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.merchant, t.captain], false),
        "BadAncestorChain"
      );
    });

    it("mandates of a foreign vault are rejected: BadAncestorChain", async () => {
      const t = await demoTree();
      const f = await newWorld();
      const kf = Keypair.generate();
      const foreignRoot = await root(f, { cap: 100 * U, allowAny: true, authority: kf });
      // foreign ancestor in place of the real one
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [t.merchant, foreignRoot]), "BadAncestorChain");
      await expectErr(spend(t.w, t.scout, t.k.scout, t.api, 0.1 * U, [foreignRoot, t.captain]), "BadAncestorChain");
      // foreign leaf against our vault accounts
      await expectErr(spend(t.w, foreignRoot, kf, t.api, U, []), "BadAncestorChain");
    });
  });

  describe("authority", () => {
    it("non-authority signers cannot spend, delegate or create roots: Unauthorized", async () => {
      const t = await demoTree();
      await expectErr(spend(t.w, t.trader, t.k.scout, t.pool, U), "Unauthorized"); // another agent's key
      await expectErr(spend(t.w, t.trader, t.k.stranger, t.pool, U), "Unauthorized");
      await expectErr(spend(t.w, t.trader, t.k.captain, t.pool, U), "Unauthorized"); // even the parent's key
      await expectErr(
        delegate(t.w, t.trader, t.k.stranger, { cap: U, recipients: [t.pool], authority: t.k.stranger }),
        "Unauthorized"
      );
      await expectErr(
        delegate(t.w, t.trader, t.k.captain, { cap: U, recipients: [t.pool], authority: t.k.stranger }),
        "Unauthorized"
      );
      // only the vault owner can create roots (a different signer derives a different vault PDA)
      const m = mandatePda(t.w.vault, await nextId(t.w));
      // fund the stranger so account creation itself is affordable: the owner check must be what stops it
      await conn.confirmTransaction(await conn.requestAirdrop(t.k.stranger.publicKey, LAMPORTS_PER_SOL), "confirmed");
      await expectErr(
        program.methods
          .createRoot(new BN(U), new BN((await chainTime()) + 100), true, [], t.k.stranger.publicKey)
          .accountsPartial({
            vault: t.w.vault,
            mandate: m,
            owner: t.k.stranger.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([t.k.stranger])
          .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  describe("I5 receipts (replay protection)", () => {
    const aid = (n: number) => Array.from(Buffer.alloc(32, n));
    const spendOnce = async (t: Awaited<ReturnType<typeof demoTree>>, m: PublicKey, k: Keypair, to: PublicKey, amt: number, id: number[]) => {
      const recipientToken = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, to)).address;
      const receipt = pda([Buffer.from("receipt"), t.w.vault.toBuffer(), Buffer.from(id)]);
      return program.methods
        .spendOnce(new BN(amt), id)
        .accountsPartial({
          vault: t.w.vault, mandate: m, authority: k.publicKey, vaultToken: t.w.vaultToken, recipientToken,
          receipt, payer: payer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        })
        .remainingAccounts((await ancestorsOf(m)).map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
        .signers([k])
        .rpc();
    };

    it("first use of an action_id pays; the repeat fails and charges nothing", async () => {
      const t = await demoTree();
      await spendOnce(t, t.scout, t.k.scout, t.api, 0.4 * U, aid(1));
      expect((await mand(t.scout)).spent.toNumber()).to.eq(0.4 * U);
      await expectErr(spendOnce(t, t.scout, t.k.scout, t.api, 0.4 * U, aid(1)), "already in use");
      expect((await mand(t.scout)).spent.toNumber()).to.eq(0.4 * U);
      expect((await mand(t.captain)).spent.toNumber()).to.eq(0.4 * U);
      expect(await bal(t.api)).to.eq(0.4 * U);
      await spendOnce(t, t.scout, t.k.scout, t.api, 0.4 * U, aid(2)); // a new id is fine
    });

    it("the same action_id cannot be replayed through a different mandate", async () => {
      const t = await demoTree();
      await spendOnce(t, t.merchant, t.k.merchant, t.game, U, aid(7));
      await expectErr(spendOnce(t, t.scout, t.k.scout, t.api, 0.1 * U, aid(7)), "already in use");
    });

    it("spend_once still enforces I1-I4 (recipient, budget, revoke)", async () => {
      const t = await demoTree();
      await expectErr(spendOnce(t, t.scout, t.k.scout, t.attacker, 50 * U, aid(9)), "RecipientNotAllowed");
      await expectErr(spendOnce(t, t.scout, t.k.scout, t.api, 3 * U, aid(10)), "BudgetExceeded");
      await revoke(t.w, t.captain, t.w.owner);
      await expectErr(spendOnce(t, t.scout, t.k.scout, t.api, 0.1 * U, aid(11)), "Revoked");
      // failed attempts must not have burned their action ids
      const r = await conn.getAccountInfo(pda([Buffer.from("receipt"), t.w.vault.toBuffer(), Buffer.from(aid(9))]));
      expect(r).to.eq(null);
    });
  });
});
