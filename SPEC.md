# Enfeoff program spec

## Accounts
**Vault** PDA ["vault", owner]: owner: Pubkey, mint: Pubkey, next_id: u64, bump. Holds tokens in its associated token account (authority = vault PDA).

**Mandate** PDA ["mandate", vault, id_le_bytes(u64)]:
vault, id, parent: Pubkey (Pubkey::default() for root), depth: u8, authority: Pubkey (the spending key), cap: u64, spent: u64, expiry: i64, allow_any: bool, recipients: [Pubkey; 4], recipients_len: u8, revoked: bool, instant_limit: u64 (stretch), bump.

**Receipt** (stretch) PDA ["receipt", vault, action_id [u8;32]]: empty marker; created with `init` inside spend so a repeat fails.

**Pending** (stretch) PDA ["pending", mandate, nonce_le_bytes(u64)]: amount, recipient, release_at, status.

## Instructions
1. `create_vault(mint)`: owner signs. Client then funds the vault token account with a normal SPL transfer.
2. `create_root(cap, expiry, allow_any, recipients, authority)`: owner signs. parent = default, depth 0.
3. `delegate(cap, expiry, recipients, authority)`: parent.authority signs. Checks I1; parent not revoked/expired; recipients non-empty unless parent allows; child.allow_any = false unless parent.allow_any and caller passes true (keep false by default).
4. `spend(amount, action_id?)`: mandate.authority signs. remaining_accounts = ancestors ordered parent -> root. Verify chain links (each account's key == previous.parent, all same vault, program-owned, deserializes as Mandate), root reached (parent == default), depth consistent. For leaf and each ancestor: not revoked, now < expiry, spent + amount <= cap. Recipient token account owner must be in leaf allowlist (or allow_any). Increment spent on all. CPI token transfer from vault ATA signed by vault PDA seeds.
5. `revoke()`: signer is vault.owner OR the parent mandate's authority (pass parent as an account). Sets revoked = true. Subtree dies through I3.
6. (stretch) `queue_spend`, `veto`, `execute_pending`.

## Errors (stable codes help the demo)
ExceedsParentBudget, ExceedsParentExpiry, ScopeNotSubset, DepthExceeded, Revoked, Expired, BudgetExceeded, RecipientNotAllowed, BadAncestorChain, Unauthorized, ReceiptExists (comes from account-init failure; map in SDK), MathOverflow.

## Notes and limits
- Caps are ceilings, not reservations: siblings' caps may sum above the parent's, but the shared `spent` counter bounds the real total (I2).
- Use checked math everywhere. Never trust account order without verifying links.
- Max ancestors 4, so remaining_accounts <= 4; fits one transaction.

## Test matrix (each must pass)
- delegate within bounds succeeds; each I1 violation fails with its error.
- spend within cap succeeds and increments leaf and every ancestor.
- sum of sibling spends cannot exceed the parent's cap.
- spend to non-allowlisted recipient fails.
- revoke parent blocks child spend; revoke root blocks the whole tree.
- expired ancestor blocks child spend.
- wrong ancestor order or foreign-vault mandate fails with BadAncestorChain.
- non-authority signer cannot spend, delegate or revoke.
- (stretch) duplicate action_id fails; queued spend can be vetoed and cannot be executed early.
