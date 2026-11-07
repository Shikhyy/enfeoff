# NOTES: assumptions and decisions

- Spec/prompt docs were found in `docs/`, not repo root; copied to root (originals kept in docs/).
- Anchor 0.32.1 / Solana CLI 3.1.13 / Rust 1.93 (installed versions; not pinned by us). rust-toolchain.toml from `anchor init` pins 1.89.0 for the program build.
- Solana CLI global config points at mainnet; we never change it. Every devnet command passes `--url devnet` / `--provider.cluster devnet` explicitly.
- `create_vault` takes the mint as an account and also creates the vault's associated token account (authority = vault PDA).
- `delegate`/`create_root` take a separate `payer` signer so an agent key with no SOL can still delegate.
- A non-allow_any mandate must list at least one recipient (otherwise it could never pay anyone); violation -> ScopeNotSubset.
- Extra errors beyond SPEC: TooManyRecipients, ZeroAmount.
- Check order in `spend`: chain verification -> liveness (revoked/expired, leaf + ancestors) -> recipient scope -> budgets. Recipient is checked before budget so the injection demo yields RecipientNotAllowed, not BudgetExceeded.
- Replay protection (stretch) will be a separate `spend_once(amount, action_id)` instruction sharing the same core logic.

## Decisions made while building (read these before trusting a number)
- **Phases 5 and 6 were reordered.** The program is 384 KB (~1.95 SOL rent). One deploy leaves ~0.9 SOL, and a later upgrade would need a temporary ~1.95 SOL buffer, which the devnet wallet could not cover without a faucet. So stretch features (receipts, veto) were built and tested first and the program was deployed once. Nothing from the cut order was cut.
- **Phase 6.3** is minimal: "pool", "game" and "data API" are plain mock wallets in the demo, labelled mock everywhere. No dedicated mock accounts or programs.
- **Receipts** are a separate `spend_once(amount, action_id)` instruction (spend has no optional account). `ReceiptExists` is not a program error code: a repeat fails at account creation ("already in use"). The SDK maps it to `ReceiptExists` only when the failing instruction is `SpendOnce`.
- **Veto window (I6)** design: owner sets `instant_limit` and `release_delay` on any mandate; the limit binds that mandate and all descendants because `spend` evaluates the whole ancestor chain. Spends above a limit fail with `RequiresQueue` and must use `queue_spend`. `execute_pending` re-runs every check (revoked, expired, scope, budgets) at release time. Only the vault owner can veto.
- **Demo step 7**: with caps 20 and 15 under 50, the two children alone can never exhaust Captain's budget, so the demo has Captain (the root authority) also pay 25 directly first. That is stated in the step labels.
- **Expired-ancestor test**: a child can never outlive its parent (I1), so the "expired ancestor" test also has an expired leaf; both report `Expired`.
- **Devnet reliability**: public devnet returned HTTP 429s and sometimes transactions without logs. Four earlier devnet runs failed for those reasons (not program errors); those logs are not kept in the repo. Fixes: throttled fetch with backoff, polling instead of websockets for confirmation, and re-fetching a failed transaction until its logs appear.
- **Live LLM agent not run**: no `ANTHROPIC_API_KEY`. The fixture's `_note` field is stripped before the model would see it so the test is not tipped off.
- **Fresh-clone note**: `anchor test` needs `anchor keys sync` first (the program keypair is gitignored). The demo does not: it uses the committed IDL.
