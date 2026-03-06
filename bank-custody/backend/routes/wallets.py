"""
Wallet routes — CRUD and balance queries.

These endpoints let customers:
  - List their own wallets, delegated wallets, and fiat accounts
  - Create new crypto wallets (backed by Dfns)
  - View wallet details including live on-chain balance

All wallet operations go through the bank's Dfns service account.
Customers never interact with Dfns directly — they just see "their crypto accounts".

On-chain data (address, balance, status) is fetched live from Dfns on every request.
SQLite only stores the wallet-to-user mapping, friendly names, and network.
"""

from flask import Blueprint, jsonify, request, g

from auth import require_auth
from database import get_db, dict_from_row, dicts_from_rows
from dfns_client import get_dfns_client

wallets_bp = Blueprint("wallets", __name__)


@wallets_bp.route("/api/wallets", methods=["GET"])
@require_auth
def list_wallets():
    """
    List the current user's wallets, delegated wallets, and fiat accounts.

    Returns:
      {
        "fiat_accounts": [...],       — Demo EUR accounts (auto-created on first login)
        "wallets": [...],             — User's own crypto wallets
        "delegated_wallets": [...]    — Wallets shared with this user by family members
      }

    Each wallet is enriched with live data from Dfns (address, balance, status).
    """
    db = get_db()
    user_id = g.user["id"]

    # Own wallets (the user created these)
    own = dicts_from_rows(
        db.execute("SELECT * FROM wallets WHERE owner_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    )

    # Wallets delegated to this user by family members (via the Family page)
    delegated_rows = dicts_from_rows(
        db.execute(
            """
            SELECT w.*, d.permission as delegation_permission, d.grantor_id
            FROM delegations d
            JOIN wallets w ON w.dfns_wallet_id = d.wallet_id
            WHERE d.grantee_id = ?
            ORDER BY d.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    )

    # Demo fiat accounts (EUR checking/savings)
    fiat = dicts_from_rows(
        db.execute("SELECT * FROM fiat_accounts WHERE owner_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    )

    # Enrich all wallets with live on-chain data from Dfns
    dfns = get_dfns_client()
    for wallet in own + delegated_rows:
        try:
            details = dfns.wallets.get_wallet(wallet_id=wallet["dfns_wallet_id"])
            wallet["address"] = details.get("address", "")
            wallet["network"] = details.get("network", wallet.get("network", ""))
            wallet["status"] = details.get("status", "")
            wallet["balance"] = _get_wallet_balance(dfns, wallet["dfns_wallet_id"])
        except Exception:
            wallet["address"] = ""
            wallet["balance"] = None
            wallet["status"] = "unknown"

    db.close()
    return jsonify({
        "fiat_accounts": fiat,
        "wallets": own,
        "delegated_wallets": delegated_rows,
    })


@wallets_bp.route("/api/wallets", methods=["POST"])
@require_auth
def create_wallet():
    """
    Create a new crypto wallet for the current user.

    Request body:
      { "name": "Alice's Wallet", "network": "EthereumSepolia" }

    This calls Dfns to create a real blockchain wallet, then stores the
    wallet-to-user mapping in SQLite. Returns the new wallet with its address.
    """
    data = request.get_json() or {}
    name = data.get("name", "My Wallet")
    network = data.get("network", "EthereumSepolia")

    # Create the wallet on Dfns — this generates a real blockchain address
    dfns = get_dfns_client()
    result = dfns.wallets.create_wallet({"network": network})

    wallet_id = result["id"]

    # Store the wallet-to-user mapping locally
    db = get_db()
    db.execute(
        "INSERT INTO wallets (dfns_wallet_id, owner_id, name, network) VALUES (?, ?, ?, ?)",
        (wallet_id, g.user["id"], name, network),
    )
    db.commit()

    wallet = dict_from_row(db.execute("SELECT * FROM wallets WHERE dfns_wallet_id = ?", (wallet_id,)).fetchone())
    wallet["address"] = result.get("address", "")
    wallet["status"] = result.get("status", "")
    db.close()

    return jsonify(wallet), 201


@wallets_bp.route("/api/wallets/<wallet_id>", methods=["GET"])
@require_auth
def get_wallet(wallet_id):
    """
    Get detailed wallet information including balance and transfer history.

    Access control:
      - Wallet owner: full access
      - Delegated user (family member): access based on their delegation permission
      - Bank employee: full access (for the admin dashboard)

    Returns the wallet with live Dfns data + transfer history from SQLite.
    """
    db = get_db()
    user_id = g.user["id"]

    wallet = dict_from_row(
        db.execute("SELECT * FROM wallets WHERE dfns_wallet_id = ?", (wallet_id,)).fetchone()
    )
    if wallet is None:
        db.close()
        return jsonify({"error": "Wallet not found"}), 404

    # Access check: owner, delegated user, or bank employee
    if wallet["owner_id"] != user_id:
        delegation = dict_from_row(
            db.execute(
                "SELECT * FROM delegations WHERE wallet_id = ? AND grantee_id = ?",
                (wallet_id, user_id),
            ).fetchone()
        )
        if delegation is None and g.user["role"] != "employee":
            db.close()
            return jsonify({"error": "Access denied"}), 403
        wallet["delegation_permission"] = delegation["permission"] if delegation else "employee"

    # Enrich with live data from Dfns (address, balance, status)
    dfns = get_dfns_client()
    try:
        details = dfns.wallets.get_wallet(wallet_id=wallet_id)
        wallet["address"] = details.get("address", "")
        wallet["network"] = details.get("network", wallet.get("network", ""))
        wallet["status"] = details.get("status", "")
        wallet["balance"] = _get_wallet_balance(dfns, wallet_id)
    except Exception:
        wallet["address"] = ""
        wallet["balance"] = None
        wallet["status"] = "unknown"

    # Include transfer history for this wallet
    transfers = dicts_from_rows(
        db.execute(
            "SELECT * FROM transfer_requests WHERE wallet_id = ? ORDER BY created_at DESC",
            (wallet_id,),
        ).fetchall()
    )
    wallet["transfers"] = transfers

    db.close()
    return jsonify(wallet)


def _get_wallet_balance(dfns, wallet_id):
    """
    Fetch wallet assets from Dfns.

    Returns the raw Dfns response: { "assets": [{ "kind": "Native", "balance": "...",
    "symbol": "SepoliaETH", "decimals": 18 }] }

    The frontend parses this to display a human-readable balance.
    """
    try:
        assets = dfns.wallets.get_wallet_assets(wallet_id=wallet_id)
        return assets
    except Exception:
        return None
