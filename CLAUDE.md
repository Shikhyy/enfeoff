# Enfeoff: project context for Claude Code

Enfeoff is an on-chain, attenuating delegation primitive for AI agents on Solana. An owner funds a vault and gives an agent a mandate. The agent can delegate part of it to sub-agents, but never more than it holds. The chain enforces this, so a fooled or hijacked agent cannot exceed its bounds.

Hackathon: MLH Solana Hackathon. Submissions close Nov 8, 1:00 PM EST. Time is the main constraint: working beats ambitious.

## Invariants (the product; never weaken these)
- I1 Attenuation: child.cap <= parent.cap - parent.spent; child.expiry <= parent.expiry; child recipients subset of parent recipients; child.depth = parent.depth + 1 <= MAX_DEPTH (4).
- I2 Shared budget: a spend increments `spent` on the leaf AND every ancestor; every one must stay <= its cap.
- I3 Cascading revoke: if any ancestor is revoked or expired, spend fails. Revoking a node kills its whole subtree.
- I4 Scoped recipients: funds only move to recipients in the mandate's allowlist (root may be allow_any).
- I5 Receipts (stretch): a repeated action_id fails (receipt PDA `init`).
- I6 Veto window (stretch): spends above instant_limit are queued; owner can veto before release.

## Stack
Anchor program (Rust), TypeScript SDK, anchor tests (mocha), demo + agent scripts (ts-node). Devnet only. Use a self-made test mint, labelled "tUSDC", never real funds.

## Rules
- Tests before features. After every phase run `anchor test` and report results.
- No UI work beyond exposing `sdk.getTree(vault)` returning {nodes, edges} JSON; the UI is designed separately.
- Never commit keypairs or .env. Use `.env.example`.
- Never claim what isn't verified. README must state: unaudited devnet code; bounds damage but does not stop a compromised agent from spending within its cap; swap/pool is a mock if used.
- If the LLM agent does not follow the injection, keep the real attempt in the log and add a clearly labelled `--scripted` mode. Never fake it silently.
- Keep commits small. If a phase takes more than its time box, cut scope using the cut order in PROMPT.md.

## Commands
- `anchor build`, `anchor test`, `anchor deploy --provider.cluster devnet`
- `npm run demo`, `npm run agent`, `npm run agent -- --scripted`

## Definition of done
Program deployed to devnet; all invariant tests pass; `npm run demo` prints the full scenario with Explorer links for each rejection; README, DEMO notes and a 2-minute video script exist.
