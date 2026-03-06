"""
Delegation routes — family access sharing.

Wallet owners can grant two levels of access to family members:
  - "view"     — see the wallet balance and transaction history
  - "transfer" — view + initiate transfers (subject to per-person limits)

The `transfer_limit` field allows per-person approval thresholds:
  - A parent can set a 0.01 ETH limit for their kid
  - Transfers below the limit execute immediately
  - Transfers above the limit go to the bank approval queue

Delegations are stored in SQLite and enforced in the transfers and wallets routes.
The wallet owner can revoke access at any time.
"""

from flask import Blueprint, jsonify, request, g

from auth import require_auth
from database import get_db, dict_from_row, dicts_from_rows

delegation_bp = Blueprint("delegation", __name__)


@delegation_bp.route("/api/delegations", methods=["GET"])
@require_auth
def list_delegations():
    """
    List all delegations for the current user.

    Returns:
      {
        "granted": [...],   — Delegations the user has granted (they own the wallets)
        "received": [...]   — Delegations the user has received (others shared with them)
      }

    Each delegation includes the wallet name and the other party's name/email.
    """
    db = get_db()
    user_id = g.user["id"]

    # Delegations I've granted (I'm the grantor = wallet owner)
    granted = dicts_from_rows(
        db.execute(
            """
            SELECT d.*, u.email as grantee_email, u.name as grantee_name, w.name as wallet_name
            FROM delegations d
            JOIN users u ON u.id = d.grantee_id
            JOIN wallets w ON w.dfns_wallet_id = d.wallet_id
            WHERE d.grantor_id = ?
            ORDER BY d.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    )

    # Delegations I've received (I'm the grantee = family member)
    received = dicts_from_rows(
        db.execute(
            """
            SELECT d.*, u.email as grantor_email, u.name as grantor_name, w.name as wallet_name
            FROM delegations d
            JOIN users u ON u.id = d.grantor_id
            JOIN wallets w ON w.dfns_wallet_id = d.wallet_id
            WHERE d.grantee_id = ?
            ORDER BY d.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    )

    db.close()
    return jsonify({"granted": granted, "received": received})


@delegation_bp.route("/api/delegations", methods=["POST"])
@require_auth
def create_delegation():
    """
    Grant wallet access to a family member.

    Request body:
      {
        "wallet_id": "wa-xxx",
        "grantee_email": "charlie@example.com",
        "permission": "transfer",         — "view" or "transfer"
        "transfer_limit": 0.01            — Optional per-person ETH threshold
      }

    If a delegation already exists for this wallet + grantee, it is updated
    (e.g. upgrading from "view" to "transfer" or changing the limit).

    The grantee must already have logged in (so their user record exists).
    """
    data = request.get_json() or {}
    wallet_id = data.get("wallet_id")
    grantee_email = data.get("grantee_email")
    permission = data.get("permission", "view")
    transfer_limit = data.get("transfer_limit")

    if not wallet_id or not grantee_email:
        return jsonify({"error": "wallet_id and grantee_email are required"}), 400

    if permission not in ("view", "transfer"):
        return jsonify({"error": "permission must be 'view' or 'transfer'"}), 400

    # Validate transfer_limit if provided
    if transfer_limit is not None:
        try:
            transfer_limit = float(transfer_limit)
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid transfer_limit"}), 400

    db = get_db()
    user_id = g.user["id"]

    # Only the wallet owner can grant delegations
    wallet = dict_from_row(
        db.execute("SELECT * FROM wallets WHERE dfns_wallet_id = ? AND owner_id = ?", (wallet_id, user_id)).fetchone()
    )
    if wallet is None:
        db.close()
        return jsonify({"error": "Wallet not found or not owned by you"}), 404

    # Find the grantee by email — they must have logged in at least once
    grantee = dict_from_row(
        db.execute("SELECT * FROM users WHERE email = ?", (grantee_email,)).fetchone()
    )
    if grantee is None:
        db.close()
        return jsonify({"error": "User not found with that email"}), 404

    if grantee["id"] == user_id:
        db.close()
        return jsonify({"error": "Cannot delegate to yourself"}), 400

    # Check for existing delegation — update if it already exists
    existing = dict_from_row(
        db.execute(
            "SELECT * FROM delegations WHERE wallet_id = ? AND grantee_id = ?",
            (wallet_id, grantee["id"]),
        ).fetchone()
    )
    if existing:
        # Update existing delegation (e.g. change permission or limit)
        db.execute(
            "UPDATE delegations SET permission = ?, transfer_limit = ? WHERE id = ?",
            (permission, transfer_limit, existing["id"]),
        )
        db.commit()
        delegation = dict_from_row(
            db.execute("SELECT * FROM delegations WHERE id = ?", (existing["id"],)).fetchone()
        )
    else:
        # Create new delegation
        db.execute(
            "INSERT INTO delegations (wallet_id, grantor_id, grantee_id, permission, transfer_limit) VALUES (?, ?, ?, ?, ?)",
            (wallet_id, user_id, grantee["id"], permission, transfer_limit),
        )
        db.commit()
        delegation_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        delegation = dict_from_row(
            db.execute("SELECT * FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
        )

    db.close()
    return jsonify(delegation), 201


@delegation_bp.route("/api/delegations/<int:delegation_id>", methods=["DELETE"])
@require_auth
def revoke_delegation(delegation_id):
    """
    Revoke a delegation. Only the grantor (wallet owner) can revoke.

    After revocation, the grantee immediately loses access to the wallet.
    """
    db = get_db()
    user_id = g.user["id"]

    delegation = dict_from_row(
        db.execute("SELECT * FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
    )
    if delegation is None:
        db.close()
        return jsonify({"error": "Delegation not found"}), 404

    if delegation["grantor_id"] != user_id:
        db.close()
        return jsonify({"error": "Only the grantor can revoke a delegation"}), 403

    db.execute("DELETE FROM delegations WHERE id = ?", (delegation_id,))
    db.commit()
    db.close()
    return jsonify({"message": "Delegation revoked"}), 200
