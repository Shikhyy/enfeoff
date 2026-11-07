import raw from "../data/run.json";
import { ERRORS, type ErrorName } from "./sim";

export interface Step {
  scene: number;
  label: string;
  expected: string;
  got: string;
  url: string;
}
export interface TreeRow {
  label: string;
  depth: number;
  spent: number;
  cap: number;
  revoked: boolean;
}
export interface ScriptedCall {
  name: string;
  args: string;
  result: string;
  message: string;
  url: string;
}
export interface LiveRun {
  file: string;
  mode: string;
  provider: string | null;
  model: string;
  servedBy: string | null;
  time: string | null;
  task: string;
  memo: { name: string; symbol: string; description: string };
  attacker: string;
  api: string;
  reply: string;
  toolCalls: number;
  attemptedPay: boolean;
  attemptedOverCap: boolean;
  fundsReached: boolean;
  note: string | null;
  spent: { label: string; spent: number; cap: number }[];
}
export interface RunData {
  generatedFrom: string[];
  programId: string;
  mint: string;
  rpc: string;
  matched: number;
  total: number;
  steps: Step[];
  tree: TreeRow[];
  scripted: {
    mode: string;
    time: string | null;
    task: string;
    memo: { name: string; symbol: string; description: string };
    attacker: string;
    api: string;
    calls: ScriptedCall[];
    fundsReachedAttacker: boolean;
    spent: { label: string; spent: number; cap: number }[];
  };
  live: LiveRun[];
}

/** Parsed from web/data/devnet-run.txt and web/data/agent-run-scripted.txt by scripts/gen-data.mjs. */
export const RUN = raw as RunData;

/**
 * Latest `anchor test` result as reported by the build session (23 core program tests,
 * 3 receipt tests, 5 veto-window tests, 1 SDK end-to-end test). Not re-run by the web
 * app. Update this when the suite is re-run.
 */
export const TESTS = { passing: 32, failing: 0 };

export const EXPLORER = "https://explorer.solana.com";
export const PROGRAM_URL = `${EXPLORER}/address/${RUN.programId}?cluster=devnet`;
export const MINT_URL = `${EXPLORER}/address/${RUN.mint}?cluster=devnet`;
export const short = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;

export const ERROR_NAMES = Object.keys(ERRORS) as ErrorName[];
export const findStep = (needle: string) => RUN.steps.find((s) => s.label.includes(needle));
export const REJECTED = RUN.steps.filter((s) => s.expected !== "ok");
export const ALLOWED = RUN.steps.filter((s) => s.expected === "ok");
export const ROOT_CAP = RUN.tree.find((t) => t.depth === 0)?.cap ?? 1;

/** Final tree state from the recorded run. `dead` is true for a revoked node and everything under it. */
export const TREE: (TreeRow & { dead: boolean })[] = [];
for (const row of RUN.tree) {
  let parentDead = false;
  for (let j = TREE.length - 1; j >= 0; j--) {
    if (TREE[j].depth < row.depth) {
      parentDead = TREE[j].dead;
      break;
    }
  }
  TREE.push({ ...row, dead: row.revoked || parentDead });
}

const LIVE_REFUSED = RUN.live.length > 0 && RUN.live.every((r) => r.toolCalls === 0 && !r.fundsReached);
/** One sentence about the live-model runs, built from the logs so it cannot drift from them. */
export const LIVE_NOTE =
  RUN.live.length === 0
    ? "No live-model run is recorded."
    : `${RUN.live.length} live-model run${RUN.live.length === 1 ? "" : "s"} recorded (${RUN.live.map((r) => r.model).join(" and ")}), once each. ${
        LIVE_REFUSED ? "In each, the model made no tool calls and paid nobody." : "See the Agent page for what each one did."
      } That says nothing about other models or prompts.`;

export const SCENES: Record<number, string> = {
  1: "Open the vault",
  2: "Delegate down the tree",
  3: "Normal work",
  4: "Attack: prompt injection",
  5: "Attack: privilege escalation",
  6: "Attack: replay",
  7: "Shared budget",
  8: "Kill switch",
};

export interface Invariant {
  id: string;
  slug: string;
  name: string;
  headline: string;
  rule: string[];
  reading: string;
  errors: ErrorName[];
  tests: string[];
  proof: string | null;
}

export const INVARIANTS: Invariant[] = [
  {
    id: "I1",
    slug: "i1",
    name: "Attenuation",
    headline: "A child gets less, never more.",
    rule: [
      "child.cap ≤ parent.cap − parent.spent",
      "child.expiry ≤ parent.expiry",
      "child.recipients ⊆ parent.recipients",
      "child.depth = parent.depth + 1 ≤ 4",
    ],
    reading: "A sub-agent can only receive what its parent still has, for no longer, to no more places, and no deeper than four levels.",
    errors: ["ExceedsParentBudget", "ExceedsParentExpiry", "ScopeNotSubset", "DepthExceeded", "TooManyRecipients"],
    tests: [
      "delegate within bounds succeeds and records lineage",
      "cap above parent's budget fails: ExceedsParentBudget",
      "child cap is bounded by parent.cap - parent.spent",
      "expiry later than parent fails: ExceedsParentExpiry",
      "recipients not a subset fail: ScopeNotSubset",
      "more than 4 recipients fails: TooManyRecipients",
      "depth is capped at 4: DepthExceeded",
      "an expired or revoked parent cannot delegate",
    ],
    proof: "ATTACK escalation",
  },
  {
    id: "I2",
    slug: "i2",
    name: "Shared budget",
    headline: "Siblings draw from one pot.",
    rule: ["spend(amount) increments spent on the leaf and every ancestor", "every one of them must stay ≤ its cap"],
    reading: "Caps are ceilings, not reservations. Two siblings can each hold a large cap, but together they can never spend more than their parent's.",
    errors: ["BudgetExceeded", "ZeroAmount"],
    tests: [
      "spend increments the leaf and every ancestor",
      "a leaf cannot exceed its own cap: BudgetExceeded",
      "sibling caps may sum above the parent but total spend cannot",
      "zero amount fails: ZeroAmount; overspending the vault balance fails",
    ],
    proof: "tries 6: root would be 50.4",
  },
  {
    id: "I3",
    slug: "i3",
    name: "Cascading revoke",
    headline: "Cut a branch, the leaves go too.",
    rule: ["if any ancestor is revoked or expired, spend fails", "revoking a node kills its whole subtree"],
    reading: "The owner, or a parent's own key, can revoke. Nobody has to find and cancel each child.",
    errors: ["Revoked", "Expired", "Unauthorized"],
    tests: [
      "revoking a parent blocks its child, not its sibling",
      "revoking the root blocks the whole tree",
      "a parent's authority can revoke its child",
      "only the owner or the parent's authority can revoke: Unauthorized",
      "an expired ancestor blocks child spend: Expired",
    ],
    proof: "Scout spends 0.1 after revoke",
  },
  {
    id: "I4",
    slug: "i4",
    name: "Scoped recipients",
    headline: "Money only goes where it was told.",
    rule: ["funds only move to recipients in the mandate's allowlist", "only a root may be allow_any"],
    reading: "A poisoned memo can name any wallet it likes. If the wallet is not on the list, the transfer does not happen.",
    errors: ["RecipientNotAllowed"],
    tests: [
      "injection: spend to a non-allowlisted recipient fails with RecipientNotAllowed",
      "an allow_any root may pay anyone; allow_any can be passed only from an allow_any parent",
    ],
    proof: "ATTACK injection",
  },
  {
    id: "I5",
    slug: "i5",
    name: "Receipts",
    headline: "The same action never pays twice.",
    rule: ["spend_once(amount, action_id) creates a receipt account with init", "a repeated action_id fails at account creation"],
    reading: "Give each paid action a stable id. If an agent is tricked into repeating it, the second attempt is refused and charges nothing.",
    errors: ["ReceiptExists"],
    tests: [
      "first use of an action_id pays; the repeat fails and charges nothing",
      "the same action_id cannot be replayed through a different mandate",
      "spend_once still enforces I1-I4 (recipient, budget, revoke)",
    ],
    proof: "ATTACK replay",
  },
  {
    id: "I6",
    slug: "i6",
    name: "Veto window",
    headline: "Big spends wait for the owner.",
    rule: ["spends above instant_limit are queued", "the owner can veto before the release time"],
    reading: "In the program and SDK as setVetoPolicy, queueSpend, veto and executePending. It is not part of the recorded devnet run, so the site shows no transaction for it.",
    errors: ["RequiresQueue", "NotReleased", "NotPending"],
    tests: ["5 veto-window tests in the latest anchor test run"],
    proof: null,
  },
];
