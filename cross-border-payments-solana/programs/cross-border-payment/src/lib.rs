use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("2nfuzVit3AP8mKuup1bzA7AraQrbfBdYaPYYxMu5NkjK");

/// The `cross_border_payment` module provides instructions for a three-step payment flow:
/// 1. `initialize_payment`: Sets up the payment record with a unique ID and amount.
/// 2. `set_fx_rate`: An authority (e.g., FX provider) sets the outgoing amount based on the current exchange rate.
/// 3. `execute_payment`: The sender triggers an atomic swap, burning the input currency and minting the output currency.
#[program]
pub mod cross_border_payment {
    use super::*;

    pub fn initialize_payment(
        ctx: Context<InitializePayment>,
        payment_id: u64,
        amount_in: u64,
    ) -> Result<()> {
        let payment = &mut ctx.accounts.payment;
        payment.id = payment_id;
        payment.sender = ctx.accounts.sender.key();
        payment.receiver = ctx.accounts.receiver.key();
        payment.amount_in = amount_in;
        payment.amount_out = 0;
        payment.status = PaymentStatus::PendingFX;
        payment.bump = ctx.bumps.payment;

        Ok(())
    }

    pub fn set_fx_rate(ctx: Context<SetFXRate>, _payment_id: u64, amount_out: u64) -> Result<()> {
        let payment = &mut ctx.accounts.payment;
        require!(
            payment.status == PaymentStatus::PendingFX,
            ErrorCode::InvalidStatus
        );

        payment.amount_out = amount_out;
        payment.status = PaymentStatus::FXRateSet;

        Ok(())
    }

    pub fn execute_payment(ctx: Context<ExecutePayment>, _payment_id: u64) -> Result<()> {
        let payment = &mut ctx.accounts.payment;

        require!(
            payment.status == PaymentStatus::FXRateSet,
            ErrorCode::InvalidStatus
        );
        require!(
            payment.sender == ctx.accounts.sender.key(),
            ErrorCode::InvalidSender
        );

        // Burn input currency from sender
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.source_mint.to_account_info(),
                from: ctx.accounts.sender_source_ata.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        );
        token::burn(burn_ctx, payment.amount_in)?;

        // Mint output currency to receiver
        let seeds = &[
            b"payment",
            payment.sender.as_ref(),
            &payment.id.to_le_bytes(),
            &[payment.bump],
        ];
        let signer = &[&seeds[..]];

        let mint_to_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.target_mint.to_account_info(),
                to: ctx.accounts.receiver_target_ata.to_account_info(),
                authority: ctx.accounts.target_mint_authority.to_account_info(),
            },
            signer,
        );
        token::mint_to(mint_to_ctx, payment.amount_out)?;

        payment.status = PaymentStatus::Completed;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(payment_id: u64)]
pub struct InitializePayment<'info> {
    #[account(
        init,
        payer = sender,
        space = 8 + 8 + 32 + 32 + 8 + 8 + 1 + 1,
        seeds = [b"payment", sender.key().as_ref(), &payment_id.to_le_bytes()],
        bump
    )]
    pub payment: Account<'info, Payment>,
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: Receiver address (non-signer)
    pub receiver: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: u64)]
pub struct SetFXRate<'info> {
    #[account(
        mut,
        seeds = [b"payment", payment.sender.as_ref(), &payment_id.to_le_bytes()],
        bump = payment.bump
    )]
    pub payment: Account<'info, Payment>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(payment_id: u64)]
pub struct ExecutePayment<'info> {
    #[account(
        mut,
        seeds = [b"payment", sender.key().as_ref(), &payment_id.to_le_bytes()],
        bump = payment.bump
    )]
    pub payment: Account<'info, Payment>,
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mut)]
    pub source_mint: Account<'info, Mint>,
    #[account(mut)]
    pub sender_source_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub target_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = receiver_target_ata.owner == payment.receiver @ ErrorCode::InvalidReceiverATA
    )]
    pub receiver_target_ata: Account<'info, TokenAccount>,
    /// CHECK: Validated via CPI signer in program
    pub target_mint_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Payment {
    pub id: u64,
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub status: PaymentStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PaymentStatus {
    PendingFX,
    FXRateSet,
    Completed,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid status for this operation")]
    InvalidStatus,
    #[msg("Only the original sender can execute")]
    InvalidSender,
    #[msg("Receiver ATA must be owned by the payment receiver")]
    InvalidReceiverATA,
}
