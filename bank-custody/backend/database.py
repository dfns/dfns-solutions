"""
SQLite database setup and helpers.

The database stores everything that Dfns does NOT know about:
  - User records (Auth0 sub → local user mapping)
  - Fiat accounts (demo data, auto-created on first login)
  - Wallet ownership (which user owns which Dfns wallet)
  - Delegations (family access sharing with permissions and transfer limits)
  - Transfer requests (approval queue for high-value transfers)

Dfns remains the source of truth for wallet addresses, balances, and on-chain
transaction status. The local DB only tracks ownership, naming, and approvals.
"""

import sqlite3
from config import Config


def get_db():
    """Open a connection to the SQLite database with FK enforcement enabled."""
    db = sqlite3.connect(Config.DATABASE)
    db.row_factory = sqlite3.Row    # Rows behave like dicts (access by column name)
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    """Create all tables if they don't already exist. Safe to call on every startup."""
    db = get_db()
    db.executescript("""
        -- Users are auto-created on first login from Auth0 token claims.
        -- The `id` is the Auth0 `sub` claim (e.g. "auth0|abc123").
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            role TEXT DEFAULT 'customer',       -- 'customer' or 'employee'
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Demo fiat accounts (EUR checking/savings) — auto-created for each new customer.
        -- These are purely cosmetic and not backed by a real banking API.
        CREATE TABLE IF NOT EXISTS fiat_accounts (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            currency TEXT DEFAULT 'EUR',
            balance REAL DEFAULT 0,
            iban TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Crypto wallets — each row links a Dfns wallet ID to its owner.
        -- All on-chain data (address, balance, status) is fetched live from Dfns.
        CREATE TABLE IF NOT EXISTS wallets (
            dfns_wallet_id TEXT PRIMARY KEY,     -- The Dfns wallet ID (e.g. "wa-xxx-xxx")
            owner_id TEXT NOT NULL REFERENCES users(id),
            name TEXT,                           -- User-friendly name (e.g. "Alice's Wallet")
            network TEXT DEFAULT 'EthereumSepolia',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Family delegations — grant view or transfer access to another user.
        -- The `transfer_limit` field allows per-person approval thresholds
        -- (e.g. a kid can send up to 0.01 ETH without approval).
        CREATE TABLE IF NOT EXISTS delegations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_id TEXT NOT NULL REFERENCES wallets(dfns_wallet_id),
            grantor_id TEXT NOT NULL REFERENCES users(id),   -- The wallet owner who grants access
            grantee_id TEXT NOT NULL REFERENCES users(id),   -- The family member who receives access
            permission TEXT DEFAULT 'view',      -- 'view' (read-only) or 'transfer' (can send)
            transfer_limit REAL,                 -- Per-person ETH threshold (NULL = use global)
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Transfer requests — the approval queue.
        -- Transfers below the threshold are broadcasted immediately (status = 'broadcasted').
        -- Transfers at or above the threshold are queued (status = 'pending') for employee review.
        CREATE TABLE IF NOT EXISTS transfer_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_id TEXT NOT NULL REFERENCES wallets(dfns_wallet_id),
            initiated_by TEXT NOT NULL REFERENCES users(id),
            to_address TEXT NOT NULL,            -- Destination blockchain address
            amount TEXT NOT NULL,                -- Amount in ETH (stored as string for precision)
            asset TEXT NOT NULL,                 -- Asset type (e.g. "ETH")
            status TEXT DEFAULT 'pending',       -- 'pending', 'approved', 'rejected', 'broadcasted'
            dfns_tx_id TEXT,                     -- Dfns transaction ID (set after broadcast)
            reviewed_by TEXT REFERENCES users(id),  -- Employee who approved/rejected
            review_comment TEXT,                 -- Optional comment from the reviewer
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    db.commit()
    db.close()


def dict_from_row(row):
    """Convert a sqlite3.Row to a plain dict. Returns None if row is None."""
    if row is None:
        return None
    return dict(row)


def dicts_from_rows(rows):
    """Convert a list of sqlite3.Rows to a list of plain dicts."""
    return [dict(row) for row in rows]
