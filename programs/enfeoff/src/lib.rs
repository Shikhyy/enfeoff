use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("HyeQCJQC7WqmpZkZq4ufAgunFZVLqjMV6dumoVHp7qoT");

pub const MAX_DEPTH: u8 = 4;
pub const MAX_RECIPIENTS: usize = 4;

#[program]
pub mod enfeoff {
    use super::*;

    /// Owner creates a vault for `mint`; the vault's ATA is created too.
    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        v.owner = ctx.accounts.owner.key();
        v.mint = ctx.accounts.mint.key();
        v.next_id = 0;
        v.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Owner creates a root mandate (depth 0).
    pub fn create_root(
        ctx: Context<CreateRoot>,
        cap: u64,
        expiry: i64,
        allow_any: bool,
        recipients: Vec<Pubkey>,
        authority: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expiry > now, EnfeoffError::Expired);
        require!(
            allow_any || !recipients.is_empty(),
            EnfeoffError::ScopeNotSubset
        );
        let (list, len) = pack_recipients(&recipients)?;

        let vault = &mut ctx.accounts.vault;
        let m = &mut ctx.accounts.mandate;
        m.vault = vault.key();
        m.id = vault.next_id;
        m.parent = Pubkey::default();
        m.depth = 0;
        m.authority = authority;
        m.cap = cap;
        m.spent = 0;
        m.expiry = expiry;
        m.allow_any = allow_any;
        m.recipients = list;
        m.recipients_len = len;
        m.revoked = false;
        m.instant_limit = 0;
        m.release_delay = 0;
        m.bump = ctx.bumps.mandate;
        vault.next_id = vault
            .next_id
            .checked_add(1)
            .ok_or(EnfeoffError::MathOverflow)?;
        Ok(())
    }

    /// Parent authority delegates a strictly attenuated child mandate (I1).
    pub fn delegate(
        ctx: Context<Delegate>,
        cap: u64,
        expiry: i64,
        allow_any: bool,
        recipients: Vec<Pubkey>,
        authority: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        let parent = &ctx.accounts.parent;

        require!(!parent.revoked, EnfeoffError::Revoked);
        require!(now < parent.expiry, EnfeoffError::Expired);

        let depth = parent
            .depth
            .checked_add(1)
            .ok_or(EnfeoffError::MathOverflow)?;
        require!(depth <= MAX_DEPTH, EnfeoffError::DepthExceeded);

        let available = parent
            .cap
            .checked_sub(parent.spent)
            .ok_or(EnfeoffError::MathOverflow)?;
        require!(cap <= available, EnfeoffError::ExceedsParentBudget);
        require!(expiry <= parent.expiry, EnfeoffError::ExceedsParentExpiry);
        require!(expiry > now, EnfeoffError::Expired);

        let (list, len) = pack_recipients(&recipients)?;
        if allow_any {
            // only a parent that is itself allow_any may pass wildcard scope down
            require!(parent.allow_any, EnfeoffError::ScopeNotSubset);
        } else {
            require!(len > 0, EnfeoffError::ScopeNotSubset);
            if !parent.allow_any {
                let parent_list = &parent.recipients[..parent.recipients_len as usize];
                for r in &list[..len as usize] {
                    require!(parent_list.contains(r), EnfeoffError::ScopeNotSubset);
                }
            }
        }

        let m = &mut ctx.accounts.mandate;
        m.vault = vault.key();
        m.id = vault.next_id;
        m.parent = parent.key();
        m.depth = depth;
        m.authority = authority;
        m.cap = cap;
        m.spent = 0;
        m.expiry = expiry;
        m.allow_any = allow_any;
        m.recipients = list;
        m.recipients_len = len;
        m.revoked = false;
        m.instant_limit = 0;
        m.release_delay = 0;
        m.bump = ctx.bumps.mandate;
        vault.next_id = vault
            .next_id
            .checked_add(1)
            .ok_or(EnfeoffError::MathOverflow)?;
        Ok(())
    }

    /// Spend from the vault under `mandate`. `remaining_accounts` = ancestors, parent -> root.
    pub fn spend<'info>(ctx: Context<'_, '_, 'info, 'info, Spend<'info>>, amount: u64) -> Result<()> {
        let recipient_owner = ctx.accounts.recipient_token.owner;
        let vault_key = ctx.accounts.vault.key();
        check_and_charge(
            vault_key,
            &mut ctx.accounts.mandate,
            ctx.remaining_accounts,
            recipient_owner,
            amount,
            true,
        )?;
        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.vault_token,
            &ctx.accounts.recipient_token,
            &ctx.accounts.token_program,
            amount,
        )
    }

    /// Like `spend`, but also creates a receipt PDA for `action_id`: a repeated action_id
    /// fails at account creation (I5, replay protection).
    pub fn spend_once<'info>(
        ctx: Context<'_, '_, 'info, 'info, SpendOnce<'info>>,
        amount: u64,
        action_id: [u8; 32],
    ) -> Result<()> {
        let r = &mut ctx.accounts.receipt;
        r.vault = ctx.accounts.vault.key();
        r.mandate = ctx.accounts.mandate.key();
        r.action_id = action_id;
        r.bump = ctx.bumps.receipt;
        let recipient_owner = ctx.accounts.recipient_token.owner;
        let vault_key = ctx.accounts.vault.key();
        check_and_charge(
            vault_key,
            &mut ctx.accounts.mandate,
            ctx.remaining_accounts,
            recipient_owner,
            amount,
            true,
        )?;
        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.vault_token,
            &ctx.accounts.recipient_token,
            &ctx.accounts.token_program,
            amount,
        )
    }

    /// Owner sets a veto policy on a mandate: spends above `instant_limit` (0 = off) must be
    /// queued and wait `release_delay` seconds. Binds the mandate and all its descendants.
    pub fn set_veto_policy(ctx: Context<SetVetoPolicy>, instant_limit: u64, release_delay: i64) -> Result<()> {
        require!(release_delay >= 0, EnfeoffError::MathOverflow);
        let m = &mut ctx.accounts.mandate;
        m.instant_limit = instant_limit;
        m.release_delay = release_delay;
        Ok(())
    }

    /// Queue a spend that exceeds an instant limit. Validated now, charged on execution.
    pub fn queue_spend<'info>(
        ctx: Context<'_, '_, 'info, 'info, QueueSpend<'info>>,
        amount: u64,
        nonce: u64,
    ) -> Result<()> {
        let recipient_owner = ctx.accounts.recipient_token.owner;
        let (_, delay) = evaluate(
            ctx.accounts.vault.key(),
            &ctx.accounts.mandate,
            ctx.remaining_accounts,
            recipient_owner,
            amount,
            false,
        )?;
        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.pending;
        p.mandate = ctx.accounts.mandate.key();
        p.nonce = nonce;
        p.amount = amount;
        p.recipient = recipient_owner;
        p.release_at = now.checked_add(delay).ok_or(EnfeoffError::MathOverflow)?;
        p.status = PENDING_QUEUED;
        p.bump = ctx.bumps.pending;
        Ok(())
    }

    /// Owner cancels a queued spend before it is executed.
    pub fn veto(ctx: Context<Veto>) -> Result<()> {
        let p = &mut ctx.accounts.pending;
        require!(p.status == PENDING_QUEUED, EnfeoffError::NotPending);
        p.status = PENDING_VETOED;
        Ok(())
    }

    /// Release a queued spend after its delay. Every invariant is re-checked now.
    pub fn execute_pending<'info>(ctx: Context<'_, '_, 'info, 'info, ExecutePending<'info>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (amount, recipient_owner) = {
            let p = &mut ctx.accounts.pending;
            require!(p.status == PENDING_QUEUED, EnfeoffError::NotPending);
            require!(now >= p.release_at, EnfeoffError::NotReleased);
            p.status = PENDING_EXECUTED;
            (p.amount, p.recipient)
        };
        check_and_charge(
            ctx.accounts.vault.key(),
            &mut ctx.accounts.mandate,
            ctx.remaining_accounts,
            recipient_owner,
            amount,
            false,
        )?;
        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.vault_token,
            &ctx.accounts.recipient_token,
            &ctx.accounts.token_program,
            amount,
        )
    }

    /// Owner, or the parent mandate's authority, revokes a mandate (I3: subtree dies).
    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        if signer != ctx.accounts.vault.owner {
            let p = ctx
                .accounts
                .parent
                .as_ref()
                .ok_or(EnfeoffError::Unauthorized)?;
            require_keys_eq!(p.key(), ctx.accounts.mandate.parent, EnfeoffError::Unauthorized);
            require_keys_eq!(p.vault, ctx.accounts.vault.key(), EnfeoffError::Unauthorized);
            require_keys_eq!(p.authority, signer, EnfeoffError::Unauthorized);
        }
        ctx.accounts.mandate.revoked = true;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Core enforcement (I1-I4 on the spend path)
// ---------------------------------------------------------------------------

fn pack_recipients(recipients: &[Pubkey]) -> Result<([Pubkey; MAX_RECIPIENTS], u8)> {
    require!(
        recipients.len() <= MAX_RECIPIENTS,
        EnfeoffError::TooManyRecipients
    );
    let mut out = [Pubkey::default(); MAX_RECIPIENTS];
    for (i, r) in recipients.iter().enumerate() {
        out[i] = *r;
    }
    Ok((out, recipients.len() as u8))
}

fn check_live(m: &Mandate, now: i64) -> Result<()> {
    require!(!m.revoked, EnfeoffError::Revoked);
    require!(now < m.expiry, EnfeoffError::Expired);
    Ok(())
}

fn check_budget(m: &Mandate, amount: u64) -> Result<u64> {
    let new_spent = m
        .spent
        .checked_add(amount)
        .ok_or(EnfeoffError::MathOverflow)?;
    require!(new_spent <= m.cap, EnfeoffError::BudgetExceeded);
    Ok(new_spent)
}

/// Verifies the ancestor chain and every check, without mutating anything.
/// Returns the loaded ancestors (parent -> root) and the release delay that applies to `amount`.
/// Order: chain -> liveness -> recipient scope -> instant limit -> budgets.
fn evaluate<'info>(
    vault_key: Pubkey,
    leaf: &Account<'info, Mandate>,
    ancestors: &'info [AccountInfo<'info>],
    recipient_owner: Pubkey,
    amount: u64,
    enforce_instant: bool,
) -> Result<(Vec<Account<'info, Mandate>>, i64)> {
    require!(amount > 0, EnfeoffError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    // Exactly one ancestor per level of depth: parent -> root.
    require!(
        leaf.depth <= MAX_DEPTH && ancestors.len() == leaf.depth as usize,
        EnfeoffError::BadAncestorChain
    );

    let mut chain: Vec<Account<'info, Mandate>> = Vec::with_capacity(ancestors.len());
    let mut expected = leaf.parent;
    let mut depth = leaf.depth;
    for info in ancestors {
        require_keys_eq!(info.key(), expected, EnfeoffError::BadAncestorChain);
        require!(info.is_writable, EnfeoffError::BadAncestorChain);
        // checks program ownership + discriminator
        let m = Account::<Mandate>::try_from(info)
            .map_err(|_| error!(EnfeoffError::BadAncestorChain))?;
        require_keys_eq!(m.vault, vault_key, EnfeoffError::BadAncestorChain);
        require!(
            depth > 0 && m.depth == depth - 1,
            EnfeoffError::BadAncestorChain
        );
        expected = m.parent;
        depth = m.depth;
        chain.push(m);
    }
    // must terminate at a root
    require!(
        depth == 0 && expected == Pubkey::default(),
        EnfeoffError::BadAncestorChain
    );

    // I3: any revoked / expired node kills the spend
    check_live(leaf, now)?;
    for m in chain.iter() {
        check_live(m, now)?;
    }

    // I4: recipient scope (before budget, so injection -> RecipientNotAllowed)
    if !leaf.allow_any {
        let list = &leaf.recipients[..leaf.recipients_len as usize];
        require!(
            list.contains(&recipient_owner),
            EnfeoffError::RecipientNotAllowed
        );
    }

    // I6: an instant limit on the leaf or any ancestor forces large spends through the queue
    let mut delay: i64 = 0;
    for m in std::iter::once(&**leaf).chain(chain.iter().map(|a| &**a)) {
        if m.instant_limit > 0 && amount > m.instant_limit {
            require!(!enforce_instant, EnfeoffError::RequiresQueue);
            delay = delay.max(m.release_delay);
        }
    }

    // I2: every node must stay within its cap
    check_budget(leaf, amount)?;
    for m in chain.iter() {
        check_budget(m, amount)?;
    }
    Ok((chain, delay))
}

/// Charges `amount` to the leaf and every ancestor. Mutations only persist if the whole
/// instruction succeeds.
fn check_and_charge<'info>(
    vault_key: Pubkey,
    leaf: &mut Account<'info, Mandate>,
    ancestors: &'info [AccountInfo<'info>],
    recipient_owner: Pubkey,
    amount: u64,
    enforce_instant: bool,
) -> Result<()> {
    let (mut chain, _) = evaluate(vault_key, leaf, ancestors, recipient_owner, amount, enforce_instant)?;
    let leaf_new = check_budget(leaf, amount)?;
    let mut new_spents = Vec::with_capacity(chain.len());
    for m in chain.iter() {
        new_spents.push(check_budget(m, amount)?);
    }
    leaf.spent = leaf_new;
    for (m, ns) in chain.iter_mut().zip(new_spents) {
        m.spent = ns;
        m.exit(&crate::ID)?; // persist (ancestors are not in the Accounts struct)
    }
    Ok(())
}

fn transfer_from_vault<'info>(
    vault: &Account<'info, Vault>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let owner = vault.owner;
    let seeds: &[&[u8]] = &[b"vault", owner.as_ref(), &[vault.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub next_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub vault: Pubkey,
    pub id: u64,
    pub parent: Pubkey,
    pub depth: u8,
    pub authority: Pubkey,
    pub cap: u64,
    pub spent: u64,
    pub expiry: i64,
    pub allow_any: bool,
    pub recipients: [Pubkey; MAX_RECIPIENTS],
    pub recipients_len: u8,
    pub revoked: bool,
    pub instant_limit: u64,
    pub release_delay: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(
        init, payer = owner, space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", owner.key().as_ref()], bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    #[account(
        init, payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateRoot<'info> {
    #[account(
        mut, has_one = owner @ EnfeoffError::Unauthorized,
        seeds = [b"vault", owner.key().as_ref()], bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init, payer = owner, space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", vault.key().as_ref(), &vault.next_id.to_le_bytes()], bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Delegate<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        constraint = parent.vault == vault.key() @ EnfeoffError::BadAncestorChain,
        constraint = parent.authority == authority.key() @ EnfeoffError::Unauthorized
    )]
    pub parent: Account<'info, Mandate>,
    #[account(
        init, payer = payer, space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", vault.key().as_ref(), &vault.next_id.to_le_bytes()], bump
    )]
    pub mandate: Account<'info, Mandate>,
    /// the parent mandate's spending key
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Spend<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain,
        constraint = mandate.authority == authority.key() @ EnfeoffError::Unauthorized
    )]
    pub mandate: Account<'info, Mandate>,
    pub authority: Signer<'info>,
    #[account(mut, token::mint = vault.mint, token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint)]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub vault: Pubkey,
    pub mandate: Pubkey,
    pub action_id: [u8; 32],
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(amount: u64, action_id: [u8; 32])]
pub struct SpendOnce<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain,
        constraint = mandate.authority == authority.key() @ EnfeoffError::Unauthorized
    )]
    pub mandate: Account<'info, Mandate>,
    pub authority: Signer<'info>,
    #[account(mut, token::mint = vault.mint, token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint)]
    pub recipient_token: Account<'info, TokenAccount>,
    #[account(
        init, payer = payer, space = 8 + Receipt::INIT_SPACE,
        seeds = [b"receipt", vault.key().as_ref(), action_id.as_ref()], bump
    )]
    pub receipt: Account<'info, Receipt>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub const PENDING_QUEUED: u8 = 0;
pub const PENDING_EXECUTED: u8 = 1;
pub const PENDING_VETOED: u8 = 2;

#[account]
#[derive(InitSpace)]
pub struct Pending {
    pub mandate: Pubkey,
    pub nonce: u64,
    pub amount: u64,
    pub recipient: Pubkey,
    pub release_at: i64,
    pub status: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct SetVetoPolicy<'info> {
    #[account(has_one = owner @ EnfeoffError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    #[account(mut, constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain)]
    pub mandate: Account<'info, Mandate>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: u64)]
pub struct QueueSpend<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain,
        constraint = mandate.authority == authority.key() @ EnfeoffError::Unauthorized
    )]
    pub mandate: Account<'info, Mandate>,
    pub authority: Signer<'info>,
    #[account(token::mint = vault.mint)]
    pub recipient_token: Account<'info, TokenAccount>,
    #[account(
        init, payer = payer, space = 8 + Pending::INIT_SPACE,
        seeds = [b"pending", mandate.key().as_ref(), &nonce.to_le_bytes()], bump
    )]
    pub pending: Account<'info, Pending>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Veto<'info> {
    #[account(has_one = owner @ EnfeoffError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    #[account(constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain)]
    pub mandate: Account<'info, Mandate>,
    #[account(mut, constraint = pending.mandate == mandate.key() @ EnfeoffError::BadAncestorChain)]
    pub pending: Account<'info, Pending>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecutePending<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain,
        constraint = mandate.authority == authority.key() @ EnfeoffError::Unauthorized
    )]
    pub mandate: Account<'info, Mandate>,
    pub authority: Signer<'info>,
    #[account(mut, constraint = pending.mandate == mandate.key() @ EnfeoffError::BadAncestorChain)]
    pub pending: Account<'info, Pending>,
    #[account(mut, token::mint = vault.mint, token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut, token::mint = vault.mint,
        constraint = recipient_token.owner == pending.recipient @ EnfeoffError::RecipientNotAllowed
    )]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Revoke<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = mandate.vault == vault.key() @ EnfeoffError::BadAncestorChain
    )]
    pub mandate: Account<'info, Mandate>,
    pub signer: Signer<'info>,
    /// required unless signer is the vault owner
    pub parent: Option<Account<'info, Mandate>>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EnfeoffError {
    #[msg("Child cap exceeds the parent's remaining budget")]
    ExceedsParentBudget,
    #[msg("Child expiry is later than the parent's expiry")]
    ExceedsParentExpiry,
    #[msg("Child recipient scope is not a subset of the parent's")]
    ScopeNotSubset,
    #[msg("Maximum delegation depth exceeded")]
    DepthExceeded,
    #[msg("Mandate or an ancestor has been revoked")]
    Revoked,
    #[msg("Mandate or an ancestor has expired")]
    Expired,
    #[msg("Spend exceeds the cap of this mandate or an ancestor")]
    BudgetExceeded,
    #[msg("Recipient is not in this mandate's allowlist")]
    RecipientNotAllowed,
    #[msg("Ancestor accounts are missing, out of order, or from another vault")]
    BadAncestorChain,
    #[msg("Signer is not authorised for this action")]
    Unauthorized,
    #[msg("This action_id has already been used")]
    ReceiptExists,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Too many recipients (max 4)")]
    TooManyRecipients,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Spend exceeds an instant limit: queue it and wait for the release time")]
    RequiresQueue,
    #[msg("Queued spend is not yet releasable")]
    NotReleased,
    #[msg("Queued spend was already executed or vetoed")]
    NotPending,
}
