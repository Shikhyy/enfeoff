import { describe, expect, it } from "vitest";
import { U, delegate, expire, initialState, revoke, spend, type Result, type SimState } from "./sim";

const u = (x: number) => Math.round(x * U);
const must = (r: Result): SimState => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}: ${r.detail}`);
  return r.state;
};
const errorOf = (r: Result) => (r.ok ? "ok" : r.error);
const spentOf = (s: SimState, id: string) => s.mandates.find((m) => m.id === id)!.spent;

describe("I1 attenuation", () => {
  it("delegating within the parent's remaining budget succeeds", () => {
    const s = must(delegate(initialState(), "merchant", { cap: u(10), recipients: ["api"], label: "Helper" }));
    expect(s.mandates.find((m) => m.label === "Helper")?.depth).toBe(2);
  });
  it("a child cap above the parent's remaining budget fails", () => {
    expect(errorOf(delegate(initialState(), "scout", { cap: u(100), recipients: ["api"] }))).toBe("ExceedsParentBudget");
  });
  it("the bound is parent.cap minus parent.spent, not parent.cap", () => {
    let s = must(spend(initialState(), "scout", u(1), "api"));
    expect(errorOf(delegate(s, "merchant", { cap: u(15), recipients: ["api"] }))).toBe("ExceedsParentBudget");
    s = must(delegate(s, "merchant", { cap: u(14), recipients: ["api"] }));
    expect(s.mandates).toHaveLength(5);
  });
  it("recipients outside the parent's allowlist fail", () => {
    expect(errorOf(delegate(initialState(), "trader", { cap: u(1), recipients: ["game"] }))).toBe("ScopeNotSubset");
    expect(errorOf(delegate(initialState(), "trader", { cap: u(1), recipients: [] }))).toBe("ScopeNotSubset");
  });
  it("depth is capped at 4", () => {
    let s = must(delegate(initialState(), "scout", { cap: u(1), recipients: ["api"], label: "d3" }));
    s = must(delegate(s, "m1", { cap: u(0.5), recipients: ["api"], label: "d4" }));
    expect(errorOf(delegate(s, "m2", { cap: u(0.1), recipients: ["api"] }))).toBe("DepthExceeded");
  });
  it("zero cap fails", () => {
    expect(errorOf(delegate(initialState(), "trader", { cap: 0, recipients: ["pool"] }))).toBe("ZeroAmount");
  });
});

describe("I2 shared budget", () => {
  it("a spend increments the leaf and every ancestor", () => {
    const s = must(spend(initialState(), "scout", u(0.4), "api"));
    expect(spentOf(s, "scout")).toBe(u(0.4));
    expect(spentOf(s, "merchant")).toBe(u(0.4));
    expect(spentOf(s, "captain")).toBe(u(0.4));
    expect(spentOf(s, "trader")).toBe(0);
  });
  it("a leaf cannot exceed its own cap", () => {
    expect(errorOf(spend(initialState(), "scout", u(3), "api"))).toBe("BudgetExceeded");
  });
  it("the DEMO.md sequence: siblings cannot spend more than the root cap", () => {
    let s = initialState();
    s = must(spend(s, "trader", u(8), "pool"));
    s = must(spend(s, "merchant", u(5), "game"));
    s = must(spend(s, "scout", u(0.4), "api"));
    s = must(spend(s, "captain", u(25), "pool"));
    s = must(spend(s, "merchant", u(6), "game"));
    expect(spentOf(s, "captain")).toBe(u(44.4));
    expect(errorOf(spend(s, "trader", u(6), "pool"))).toBe("BudgetExceeded");
    s = must(spend(s, "trader", u(5.6), "pool"));
    expect(spentOf(s, "captain")).toBe(u(50));
    expect(errorOf(spend(s, "merchant", u(0.1), "game"))).toBe("BudgetExceeded");
  });
  it("zero amount fails", () => {
    expect(errorOf(spend(initialState(), "trader", 0, "pool"))).toBe("ZeroAmount");
  });
});

describe("I3 cascading revoke and expiry", () => {
  it("revoking the root blocks every descendant and the root", () => {
    const s = must(revoke(initialState(), "captain"));
    for (const [id, to] of [["trader", "pool"], ["merchant", "game"], ["scout", "api"], ["captain", "pool"]] as const)
      expect(errorOf(spend(s, id, u(0.1), to))).toBe("Revoked");
  });
  it("revoking a parent blocks its child but not its sibling", () => {
    const s = must(revoke(initialState(), "merchant"));
    expect(errorOf(spend(s, "scout", u(0.1), "api"))).toBe("Revoked");
    expect(errorOf(spend(s, "trader", u(0.1), "pool"))).toBe("ok");
  });
  it("an expired ancestor blocks the child", () => {
    const s = must(expire(initialState(), "merchant"));
    expect(errorOf(spend(s, "scout", u(0.1), "api"))).toBe("Expired");
  });
  it("a revoked parent cannot delegate", () => {
    const s = must(revoke(initialState(), "merchant"));
    expect(errorOf(delegate(s, "merchant", { cap: u(1), recipients: ["api"] }))).toBe("Revoked");
  });
});

describe("I4 scoped recipients", () => {
  it("the injection: a spend to a wallet outside the allowlist fails", () => {
    expect(errorOf(spend(initialState(), "scout", u(50), "attacker"))).toBe("RecipientNotAllowed");
  });
  it("recipient is checked before budget", () => {
    // 50 to the attacker would also break the budget; the recipient error wins.
    expect(errorOf(spend(initialState(), "scout", u(50), "attacker"))).not.toBe("BudgetExceeded");
  });
  it("a recipient allowed for the parent but not the child fails", () => {
    expect(errorOf(spend(initialState(), "trader", u(1), "game"))).toBe("RecipientNotAllowed");
  });
});

describe("I5 receipts", () => {
  it("the first use of an action_id pays and the repeat fails without charging", () => {
    const first = must(spend(initialState(), "scout", u(0.4), "api", "report-1"));
    const again = spend(first, "scout", u(0.4), "api", "report-1");
    expect(errorOf(again)).toBe("ReceiptExists");
    expect(spentOf(first, "captain")).toBe(u(0.4));
  });
  it("the same action_id cannot be replayed through a different mandate", () => {
    const first = must(spend(initialState(), "scout", u(0.4), "api", "report-1"));
    expect(errorOf(spend(first, "merchant", u(0.4), "api", "report-1"))).toBe("ReceiptExists");
  });
});

describe("purity", () => {
  it("a failed operation does not change the input state", () => {
    const s = initialState();
    const before = JSON.stringify(s);
    spend(s, "scout", u(50), "attacker");
    delegate(s, "scout", { cap: u(100), recipients: ["api"] });
    expect(JSON.stringify(s)).toBe(before);
  });
});
