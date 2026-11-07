/**
 * Enfeoff SDK: attenuating delegation for agents on Solana.
 * Thin wrapper over the Anchor program; `spend` finds and orders ancestors itself.
 */
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "crypto";
import idlJson from "./idl/enfeoff.json";
import type { Enfeoff as EnfeoffIdl } from "./idl/enfeoff";

export type Amount = number | bigint | BN;
/** 32-byte action id; strings are sha256-hashed so callers can use any stable action name. */
export type ActionId = string | Uint8Array;
const actionBytes = (a: ActionId): number[] =>
  Array.from(typeof a === "string" ? createHash("sha256").update(a).digest() : a);
const bn = (x: Amount) => (BN.isBN(x) ? (x as BN) : new BN(x.toString()));

export interface MandateOpts {
  cap: Amount;
  /** unix seconds; delegate defaults to the parent's expiry, createRoot defaults to +24h */
  expiry?: number;
  recipients?: PublicKey[];
  /** wildcard scope; only valid on a root, or under a parent that is itself allow_any */
  allowAny?: boolean;
  /** the key that will sign spends / further delegations for this mandate */
  authority: PublicKey;
}

export interface TreeNode {
  id: string; // mandate address
  label: string;
  authority: string;
  cap: string; // base units, as strings to stay JSON-safe
  spent: string;
  expiry: number;
  revoked: boolean;
  depth: number;
}
export interface TreeEdge {
  from: string;
  to: string;
}

// ---- transient RPC errors (public devnet rate-limits with 429) ------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function describeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
/** Retries an idempotent RPC call on rate limits / network blips. Program errors are not retried. */
export async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!/429|too many requests|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket|502|503|504/i.test(describeErr(e))) throw e;
      await sleep(Math.min(8000, 700 * 2 ** i));
    }
  }
  throw last;
}

/**
 * Send a transaction and confirm by polling signature status (no websocket), so a websocket
 * failure can never cause a duplicate send. Throws if the transaction fails.
 */
export async function sendPolled(provider: AnchorProvider, tx: Transaction, signers: Keypair[]): Promise<string> {
  const conn = provider.connection;
  tx.feePayer = provider.wallet.publicKey;
  const { blockhash, lastValidBlockHeight } = await retry(() => conn.getLatestBlockhash());
  tx.recentBlockhash = blockhash;
  if (signers.length) tx.partialSign(...signers);
  const signed = await provider.wallet.signTransaction(tx);
  const raw = signed.serialize();
  const signature = await retry(() => conn.sendRawTransaction(raw));
  for (let i = 0; i < 90; i++) {
    const st = (await retry(() => conn.getSignatureStatuses([signature]))).value[0];
    if (st?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return signature;
    if ((await retry(() => conn.getBlockHeight())) > lastValidBlockHeight) break;
    await sleep(1000);
  }
  throw new Error(`transaction ${signature} was not confirmed before its blockhash expired`);
}

// ---- errors ---------------------------------------------------------------
const IDL_ERRORS = (idlJson as any).errors as { code: number; name: string; msg: string }[];
const BY_NAME = new Map(IDL_ERRORS.map((e) => [e.name, e]));
const BY_CODE = new Map(IDL_ERRORS.map((e) => [e.code, e]));

/** Stable program error name (e.g. "RecipientNotAllowed"), or undefined if not an Enfeoff error. */
export function errorName(err: unknown): string | undefined {
  const e: any = err;
  const named = e?.error?.errorCode?.code;
  if (typeof named === "string") return named;
  const text = `${e?.message ?? ""}\n${(e?.logs ?? []).join("\n")}\n${String(err)}\n${err instanceof Error ? "" : describeErr(err)}`;
  const m = /Error Code: (\w+)/.exec(text);
  if (m) return m[1];
  const h = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  if (h) {
    const hit = BY_CODE.get(parseInt(h[1], 16));
    if (hit) return hit.name;
  }
  const c = /"Custom":\s*(\d+)/.exec(text);
  if (c && Number(c[1]) >= 6000) {
    const hit = BY_CODE.get(Number(c[1]));
    if (hit) return hit.name;
  }
  // a repeated receipt PDA fails account creation ("already in use")
  if (/already in use/i.test(text) && /Instruction: SpendOnce/.test(text)) return "ReceiptExists";
  return undefined;
}

/** Human-readable explanation of a failed Enfeoff transaction. */
export function explainError(err: unknown): string {
  const name = errorName(err);
  if (name) {
    const info = BY_NAME.get(name);
    if (info) return `${info.name} (${info.code}): ${info.msg}`;
    return name;
  }
  const e: any = err;
  return describeErr(e?.message ?? err).split("\n")[0];
}

/** Thrown when a transaction that landed on-chain failed; carries the signature for Explorer links. */
export class TxFailed extends Error {
  constructor(readonly signature: string, readonly logs: string[], readonly rawErr: unknown) {
    super(`Transaction ${signature} failed: ${JSON.stringify(rawErr)}\n${logs.join("\n")}`);
  }
}

// ---- client ---------------------------------------------------------------
export class Enfeoff {
  readonly program: Program<EnfeoffIdl>;
  /**
   * When true, transactions skip preflight so that rejections land on-chain as failed
   * transactions (with a signature and Explorer link). Failures then throw TxFailed.
   * Default false: failures are caught in preflight and cost nothing.
   */
  landFailures = false;
  constructor(readonly provider: AnchorProvider) {
    this.program = new Program<EnfeoffIdl>(idlJson as EnfeoffIdl, provider);
  }
  get programId() {
    return this.program.programId;
  }

  private async send(builder: any, signers: Keypair[]): Promise<string> {
    if (!this.landFailures) return builder.signers(signers).rpc();
    const conn = this.provider.connection;
    const tx: Transaction = await builder.transaction();
    tx.feePayer = this.provider.wallet.publicKey;
    const { blockhash, lastValidBlockHeight } = await retry(() => conn.getLatestBlockhash());
    tx.recentBlockhash = blockhash;
    if (signers.length) tx.partialSign(...signers);
    const signed = await this.provider.wallet.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await retry(() => conn.sendRawTransaction(raw, { skipPreflight: true }));
    try {
      await retry(() => conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed"));
    } catch {
      // websocket confirmation can fail or reject with the raw instruction error (e.g. on 429);
      // the transaction is polled below, which is the source of truth.
    }
    // Some RPC nodes return the transaction before its logs are available; wait for them
    // when it failed, so the program error can be named.
    let info = null;
    for (let i = 0; i < 20; i++) {
      info = await retry(() => conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
      if (info && (!info.meta?.err || info.meta?.logMessages?.length)) break;
      await sleep(600);
    }
    if (!info) throw new Error(`transaction ${signature} was sent but could not be fetched; check it on Explorer`);
    if (info.meta?.err) throw new TxFailed(signature, info.meta.logMessages ?? [], info.meta.err);
    return signature;
  }

  vaultAddress(owner: PublicKey) {
    return PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer()], this.programId)[0];
  }
  mandateAddress(vault: PublicKey, id: number | bigint) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("mandate"), vault.toBuffer(), new BN(id.toString()).toArrayLike(Buffer, "le", 8)],
      this.programId
    )[0];
  }

  getVault(vault: PublicKey) {
    return retry(() => this.program.account.vault.fetch(vault));
  }
  getMandate(mandate: PublicKey) {
    return retry(() => this.program.account.mandate.fetch(mandate));
  }

  /** Owner creates a vault (and its token account) for `mint`. */
  async createVault(owner: Keypair, mint: PublicKey) {
    const vault = this.vaultAddress(owner.publicKey);
    const vaultToken = getAssociatedTokenAddressSync(mint, vault, true);
    const signature = await this.send(
      this.program.methods
      .createVault()
      .accountsPartial({
        vault,
        mint,
        vaultToken,
        owner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }),
      [owner]
    );
    return { vault, vaultToken, signature };
  }

  /** Plain SPL transfer from `funder`'s token account into the vault's token account. */
  async fund(vault: PublicKey, funder: Keypair, amount: Amount) {
    const v = await this.getVault(vault);
    const src = getAssociatedTokenAddressSync(v.mint, funder.publicKey);
    const dst = getAssociatedTokenAddressSync(v.mint, vault, true);
    const tx = new Transaction().add(
      createTransferInstruction(src, dst, funder.publicKey, BigInt(bn(amount).toString()))
    );
    return sendPolled(this.provider, tx, [funder]);
  }

  /** Owner creates a root mandate. Returns its address. */
  async createRoot(vault: PublicKey, owner: Keypair, o: MandateOpts) {
    const v = await this.getVault(vault);
    const mandate = this.mandateAddress(vault, v.nextId.toString() as any);
    const expiry = o.expiry ?? Math.floor(Date.now() / 1000) + 86400;
    const signature = await this.send(
      this.program.methods
      .createRoot(bn(o.cap), new BN(expiry), !!o.allowAny, o.recipients ?? [], o.authority)
      .accountsPartial({ vault, mandate, owner: owner.publicKey, systemProgram: SystemProgram.programId }),
      [owner]
    );
    return { mandate, signature };
  }

  /** `signer` is the parent mandate's authority. The provider wallet pays rent. */
  async delegate(parent: PublicKey, signer: Keypair, o: MandateOpts) {
    const p = await this.getMandate(parent);
    const vault = p.vault;
    const v = await this.getVault(vault);
    const mandate = this.mandateAddress(vault, v.nextId.toString() as any);
    const expiry = o.expiry ?? p.expiry.toNumber();
    const signature = await this.send(
      this.program.methods
      .delegate(bn(o.cap), new BN(expiry), !!o.allowAny, o.recipients ?? [], o.authority)
      .accountsPartial({
        vault,
        parent,
        mandate,
        authority: signer.publicKey,
        payer: this.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }),
      [signer]
    );
    return { mandate, signature };
  }

  /** Ancestors of a mandate ordered parent -> root. */
  async ancestors(mandate: PublicKey): Promise<PublicKey[]> {
    const out: PublicKey[] = [];
    let cur = await this.getMandate(mandate);
    while (!cur.parent.equals(PublicKey.default)) {
      out.push(cur.parent);
      cur = await this.getMandate(cur.parent);
    }
    return out;
  }

  /**
   * Pay `recipient` (a wallet; its token account is created if missing) from the vault.
   * Callers pass only the mandate; ancestors are fetched and ordered here.
   */
  async spend(
    mandate: PublicKey,
    signer: Keypair,
    o: { amount: Amount; recipient: PublicKey; actionId?: ActionId }
  ) {
    const m = await this.getMandate(mandate);
    const v = await this.getVault(m.vault);
    const vaultToken = getAssociatedTokenAddressSync(v.mint, m.vault, true);
    const recipientToken = getAssociatedTokenAddressSync(v.mint, o.recipient, true);
    const anc = await this.ancestors(mandate);
    const accounts = {
      vault: m.vault,
      mandate,
      authority: signer.publicKey,
      vaultToken,
      recipientToken,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const base = o.actionId
      ? (() => {
          const id = actionBytes(o.actionId!);
          const receipt = PublicKey.findProgramAddressSync(
            [Buffer.from("receipt"), m.vault.toBuffer(), Buffer.from(id)],
            this.programId
          )[0];
          return this.program.methods
            .spendOnce(bn(o.amount), id)
            .accountsPartial({ ...accounts, receipt, payer: this.provider.wallet.publicKey, systemProgram: SystemProgram.programId });
        })()
      : this.program.methods.spend(bn(o.amount)).accountsPartial(accounts);
    return this.send(
      base
      .remainingAccounts(anc.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          this.provider.wallet.publicKey,
          recipientToken,
          o.recipient,
          v.mint
        ),
      ]),
      [signer]
    );
  }

  // ---- veto window (I6) -----------------------------------------------------
  pendingAddress(mandate: PublicKey, nonce: number | bigint) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), mandate.toBuffer(), new BN(nonce.toString()).toArrayLike(Buffer, "le", 8)],
      this.programId
    )[0];
  }

  /** Owner: spends above `instantLimit` (on this mandate or any descendant) must be queued. */
  async setVetoPolicy(mandate: PublicKey, owner: Keypair, o: { instantLimit: Amount; releaseDelay: number }) {
    const m = await this.getMandate(mandate);
    return this.send(
      this.program.methods
        .setVetoPolicy(bn(o.instantLimit), new BN(o.releaseDelay))
        .accountsPartial({ vault: m.vault, mandate, owner: owner.publicKey }),
      [owner]
    );
  }

  /** Queue a spend above an instant limit; it is validated now and charged when executed. */
  async queueSpend(mandate: PublicKey, signer: Keypair, o: { amount: Amount; recipient: PublicKey; nonce: number | bigint }) {
    const m = await this.getMandate(mandate);
    const v = await this.getVault(m.vault);
    const recipientToken = getAssociatedTokenAddressSync(v.mint, o.recipient, true);
    const pending = this.pendingAddress(mandate, o.nonce);
    const anc = await this.ancestors(mandate);
    const signature = await this.send(
      this.program.methods
        .queueSpend(bn(o.amount), new BN(o.nonce.toString()))
        .accountsPartial({
          vault: m.vault,
          mandate,
          authority: signer.publicKey,
          recipientToken,
          pending,
          payer: this.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(anc.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(this.provider.wallet.publicKey, recipientToken, o.recipient, v.mint),
        ]),
      [signer]
    );
    return { pending, signature };
  }

  getPending(pending: PublicKey) {
    return retry(() => this.program.account.pending.fetch(pending));
  }

  /** Owner cancels a queued spend. */
  async veto(pending: PublicKey, owner: Keypair) {
    const p = await this.getPending(pending);
    const m = await this.getMandate(p.mandate);
    return this.send(
      this.program.methods.veto().accountsPartial({ vault: m.vault, mandate: p.mandate, pending, owner: owner.publicKey }),
      [owner]
    );
  }

  /** Release a queued spend once its delay has passed (mandate authority signs). */
  async executePending(pending: PublicKey, signer: Keypair) {
    const p = await this.getPending(pending);
    const m = await this.getMandate(p.mandate);
    const v = await this.getVault(m.vault);
    const anc = await this.ancestors(p.mandate);
    return this.send(
      this.program.methods
        .executePending()
        .accountsPartial({
          vault: m.vault,
          mandate: p.mandate,
          authority: signer.publicKey,
          pending,
          vaultToken: getAssociatedTokenAddressSync(v.mint, m.vault, true),
          recipientToken: getAssociatedTokenAddressSync(v.mint, p.recipient, true),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(anc.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }))),
      [signer]
    );
  }

  /** Owner (any mandate) or the parent's authority (its children) may revoke. Kills the subtree. */
  async revoke(mandate: PublicKey, signer: Keypair) {
    const m = await this.getMandate(mandate);
    const v = await this.getVault(m.vault);
    const isOwner = v.owner.equals(signer.publicKey);
    const parent = !isOwner && !m.parent.equals(PublicKey.default) ? m.parent : null;
    return this.send(
      this.program.methods
        .revoke()
        .accountsPartial({ vault: m.vault, mandate, signer: signer.publicKey, parent }),
      [signer]
    );
  }

  /** UI-ready view of a vault's delegation tree. */
  async getTree(vault: PublicKey, labels: Record<string, string> = {}) {
    const all = await this.program.account.mandate.all([
      { memcmp: { offset: 8, bytes: vault.toBase58() } }, // Mandate.vault
    ]);
    all.sort((a, b) => a.account.id.cmp(b.account.id));
    const nodes: TreeNode[] = all.map(({ publicKey, account: a }) => ({
      id: publicKey.toBase58(),
      label: labels[publicKey.toBase58()] ?? `mandate-${a.id.toString()}`,
      authority: a.authority.toBase58(),
      cap: a.cap.toString(),
      spent: a.spent.toString(),
      expiry: a.expiry.toNumber(),
      revoked: a.revoked,
      depth: a.depth,
    }));
    const edges: TreeEdge[] = all
      .filter(({ account: a }) => !a.parent.equals(PublicKey.default))
      .map(({ publicKey, account: a }) => ({ from: a.parent.toBase58(), to: publicKey.toBase58() }));
    return { nodes, edges };
  }

  explainError = explainError;
}

export default Enfeoff;
