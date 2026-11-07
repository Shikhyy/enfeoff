// Browser-side model of the Enfeoff program rules, used by the Playground.
// It mirrors programs/enfeoff/src/lib.rs and SPEC.md for the cases it covers. It is a
// simulation: it never reads from or writes to the chain.

export const U = 1_000_000; // 1 tUSDC, 6 decimals
export const MAX_DEPTH = 4;

export type Recipient = "pool" | "game" | "api" | "attacker";

export const RECIPIENTS: Record<Recipient, { label: string; note: string }> = {
  pool: { label: "Pool", note: "mock pool wallet" },
  game: { label: "Game", note: "mock game wallet" },
  api: { label: "Data API", note: "mock data API wallet" },
  attacker: { label: "Attacker", note: "wallet named in the injected memo" },
};

// Names, order and messages are copied from `EnfeoffError` in the program. Anchor numbers
// custom errors from 6000 in declaration order.
const ERROR_LIST: [string, string][] = [
  ["ExceedsParentBudget", "Child cap exceeds the parent's remaining budget"],
  ["ExceedsParentExpiry", "Child expiry is later than the parent's expiry"],
  ["ScopeNotSubset", "Child recipient scope is not a subset of the parent's"],
  ["DepthExceeded", "Maximum delegation depth exceeded"],
  ["Revoked", "Mandate or an ancestor has been revoked"],
  ["Expired", "Mandate or an ancestor has expired"],
  ["BudgetExceeded", "Spend exceeds the cap of this mandate or an ancestor"],
  ["RecipientNotAllowed", "Recipient is not in this mandate's allowlist"],
  ["BadAncestorChain", "Ancestor accounts are missing, out of order, or from another vault"],
  ["Unauthorized", "Signer is not authorised for this action"],
  ["ReceiptExists", "This action_id has already been used"],
  ["MathOverflow", "Arithmetic overflow"],
  ["TooManyRecipients", "Too many recipients (max 4)"],
  ["ZeroAmount", "Amount must be greater than zero"],
  ["RequiresQueue", "Spend exceeds an instant limit: queue it and wait for the release time"],
  ["NotReleased", "Queued spend is not yet releasable"],
  ["NotPending", "Queued spend was already executed or vetoed"],
];

export type ErrorName =
  | "ExceedsParentBudget"
  | "ExceedsParentExpiry"
  | "ScopeNotSubset"
  | "DepthExceeded"
  | "Revoked"
  | "Expired"
  | "BudgetExceeded"
  | "RecipientNotAllowed"
  | "BadAncestorChain"
  | "Unauthorized"
  | "ReceiptExists"
  | "MathOverflow"
  | "TooManyRecipients"
  | "ZeroAmount"
  | "RequiresQueue"
  | "NotReleased"
  | "NotPending";

export const ERRORS = Object.fromEntries(
  ERROR_LIST.map(([name, message], i) => [name, { code: 6000 + i, message }])
) as Record<ErrorName, { code: number; message: string }>;

export interface Mandate {
  id: string;
  label: string;
  parent: string | null;
  depth: number;
  cap: number;
  spent: number;
  revoked: boolean;
  expired: boolean;
  recipients: Recipient[];
  allowAny: boolean;
}

export interface SimState {
  mandates: Mandate[];
  receipts: string[];
  nextId: number;
}

export type Result =
  | { ok: true; state: SimState; summary: string; touched: string[] }
  | { ok: false; error: ErrorName; detail: string };

export const fmt = (x: number) => {
  const s = (x / U).toFixed(2);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

const fail = (error: ErrorName, detail: string): Result => ({ ok: false, error, detail });
const find = (s: SimState, id: string) => s.mandates.find((m) => m.id === id);

/** The mandate and its ancestors, leaf first. */
export function chainOf(s: SimState, id: string): Mandate[] {
  const out: Mandate[] = [];
  let cur = find(s, id);
  while (cur) {
    out.push(cur);
    cur = cur.parent ? find(s, cur.parent) : undefined;
  }
  return out;
}

export const remaining = (m: Mandate) => m.cap - m.spent;

/** The root-most revoked or expired mandate in the chain, if any (I3). */
export function blockedBy(s: SimState, id: string): { mandate: Mandate; reason: "revoked" | "expired" } | null {
  for (const c of chainOf(s, id).reverse()) {
    if (c.revoked) return { mandate: c, reason: "revoked" };
    if (c.expired) return { mandate: c, reason: "expired" };
  }
  return null;
}

export function descendants(s: SimState, id: string): Mandate[] {
  return s.mandates.filter((m) => m.id !== id && chainOf(s, m.id).some((c) => c.id === id));
}

/** The scenario from DEMO.md: Captain 50, Trader 20, Merchant 15, Scout 2 under Merchant. */
export function initialState(): SimState {
  const m = (id: string, label: string, parent: string | null, depth: number, cap: number, recipients: Recipient[]): Mandate => ({
    id,
    label,
    parent,
    depth,
    cap: cap * U,
    spent: 0,
    revoked: false,
    expired: false,
    recipients,
    allowAny: false,
  });
  return {
    mandates: [
      m("captain", "Captain", null, 0, 50, ["pool", "game", "api"]),
      m("trader", "Trader", "captain", 1, 20, ["pool"]),
      m("merchant", "Merchant", "captain", 1, 15, ["game", "api"]),
      m("scout", "Scout", "merchant", 2, 2, ["api"]),
    ],
    receipts: [],
    nextId: 1,
  };
}

function liveness(s: SimState, id: string, who: string, verb: string): Result | null {
  const dead = blockedBy(s, id);
  if (!dead) return null;
  const direct = dead.mandate.id === id;
  return fail(
    dead.reason === "revoked" ? "Revoked" : "Expired",
    `${dead.mandate.label} is ${dead.reason}${direct ? "." : `, so ${who} cannot ${verb}.`}`
  );
}

/** I1: delegate part of `parentId`'s mandate. Never more than the parent has left. */
export function delegate(s: SimState, parentId: string, o: { cap: number; recipients: Recipient[]; label?: string }): Result {
  const parent = find(s, parentId);
  if (!parent) throw new Error(`unknown mandate ${parentId}`);
  if (o.cap <= 0) return fail("ZeroAmount", "Cap must be above zero.");
  const dead = liveness(s, parentId, parent.label, "delegate");
  if (dead) return dead;
  if (parent.depth + 1 > MAX_DEPTH) return fail("DepthExceeded", `Depth ${parent.depth + 1} is above the limit of ${MAX_DEPTH}.`);
  if (o.cap > remaining(parent))
    return fail("ExceedsParentBudget", `${parent.label} has ${fmt(remaining(parent))} left; the child asks for ${fmt(o.cap)}.`);
  if (!parent.allowAny && (o.recipients.length === 0 || o.recipients.some((r) => !parent.recipients.includes(r))))
    return fail("ScopeNotSubset", `A child needs at least one recipient, all from ${parent.label}'s allowlist.`);
  const id = `m${s.nextId}`;
  const label = o.label ?? `Agent ${s.nextId}`;
  const child: Mandate = {
    id,
    label,
    parent: parentId,
    depth: parent.depth + 1,
    cap: o.cap,
    spent: 0,
    revoked: false,
    expired: false,
    recipients: o.recipients,
    allowAny: false,
  };
  return {
    ok: true,
    state: { ...s, mandates: [...s.mandates, child], nextId: s.nextId + 1 },
    summary: `${parent.label} delegated ${fmt(o.cap)} to ${label} (depth ${child.depth}).`,
    touched: [id],
  };
}

/**
 * I2 to I5: pay `recipient`. Check order follows NOTES.md: receipt, chain liveness,
 * recipient scope, then budgets on the leaf and every ancestor.
 */
export function spend(s: SimState, id: string, amount: number, recipient: Recipient, actionId?: string): Result {
  const chain = chainOf(s, id);
  const leaf = chain[0];
  if (!leaf) throw new Error(`unknown mandate ${id}`);
  if (amount <= 0) return fail("ZeroAmount", "Amount must be above zero.");
  if (actionId && s.receipts.includes(actionId)) return fail("ReceiptExists", `action_id "${actionId}" was already paid.`);
  const dead = liveness(s, id, leaf.label, "spend");
  if (dead) return dead;
  if (!leaf.allowAny && !leaf.recipients.includes(recipient))
    return fail("RecipientNotAllowed", `${RECIPIENTS[recipient].label} is not on ${leaf.label}'s allowlist.`);
  for (const c of chain) {
    if (c.spent + amount > c.cap)
      return fail("BudgetExceeded", `${c.label} has ${fmt(remaining(c))} left; this spend is ${fmt(amount)}.`);
  }
  const ids = new Set(chain.map((c) => c.id));
  return {
    ok: true,
    state: {
      ...s,
      mandates: s.mandates.map((m) => (ids.has(m.id) ? { ...m, spent: m.spent + amount } : m)),
      receipts: actionId ? [...s.receipts, actionId] : s.receipts,
    },
    summary: `${leaf.label} paid ${fmt(amount)} to ${RECIPIENTS[recipient].label}. Spent updated on ${chain.length} mandate${chain.length === 1 ? "" : "s"}.`,
    touched: [...ids],
  };
}

/** I3: revoke a mandate. Everything below it stops through the chain check. */
export function revoke(s: SimState, id: string): Result {
  const m = find(s, id);
  if (!m) throw new Error(`unknown mandate ${id}`);
  const below = descendants(s, id).length;
  return {
    ok: true,
    state: { ...s, mandates: s.mandates.map((x) => (x.id === id ? { ...x, revoked: true } : x)) },
    summary: `${m.label} revoked. ${below} mandate${below === 1 ? "" : "s"} below it can no longer spend.`,
    touched: [id],
  };
}

/** Simulates time passing: the mandate's expiry is now in the past. */
export function expire(s: SimState, id: string): Result {
  const m = find(s, id);
  if (!m) throw new Error(`unknown mandate ${id}`);
  const below = descendants(s, id).length;
  return {
    ok: true,
    state: { ...s, mandates: s.mandates.map((x) => (x.id === id ? { ...x, expired: true } : x)) },
    summary: `${m.label} has expired. ${below} mandate${below === 1 ? "" : "s"} below it are blocked.`,
    touched: [id],
  };
}
