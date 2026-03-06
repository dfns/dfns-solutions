"""
Transfer routes — initiate and list crypto transfers.

Transfer flow:
  1. User submits a transfer (wallet, recipient address, amount)
  2. Backend checks authorization (owner or delegated user with transfer permission)
  3. Backend determines the applicable threshold:
     - If the user is a delegated user with a `transfer_limit`, use that
     - Otherwise, use the global APPROVAL_THRESHOLD from config
  4. If amount < threshold → execute immediately via Dfns (status = 'broadcasted')
  5. If amount >= threshold → queue for bank employee approval (status = 'pending')

The Dfns `transfer_asset` method requires the amount in wei (1 ETH = 10^18 wei).
We use Python's Decimal for precise conversion to avoid floating-point errors.
"""

from decimal import Decimal

from flask import Blueprint, jsonify, request, g

from auth import require_auth
from config import Config
from database import get_db, dict_from_row, dicts_from_rows
from dfns_client import get_dfns_client

transfers_bp = Blueprint("transfers", __name__)


@transfers_bp.route("/api/transfers", methods=["GET"])
@require_auth
def list_transfers():
    """
    List transfers visible to the current user.

    Includes transfers the user initiated AND transfers on wallets they own
    (so a wallet owner can see transfers made by delegated family members).
    """
    db = get_db()
    user_id = g.user["id"]

    transfers = dicts_from_rows(
        db.execute(
            """
            SELECT tr.*, w.name as wallet_name
            FROM transfer_requests tr
            JOIN wallets w ON w.dfns_wallet_id = tr.wallet_id
            WHERE tr.initiated_by = ?
               OR w.owner_id = ?
            ORDER BY tr.created_at DESC
            """,
            (user_id, user_id),
        ).fetchall()
    )
    db.close()
    return jsonify({"transfers": transfers})


@transfers_bp.route("/api/transfers", methods=["POST"])
@require_auth
def create_transfer():
    """
    Initiate a crypto transfer.

    Request body:
      { "wallet_id": "wa-xxx", "to_address": "0x...", "amount": "0.01", "asset": "ETH" }

    Authorization:
      - Wallet owner can always transfer
      - Delegated user needs 'transfer' permission on the wallet

    Returns:
      - 201 with status='broadcasted' if executed immediately
      - 201 with status='pending' if queued for employee approval
    """
    data = request.get_json() or {}
    wallet_id = data.get("wallet_id")
    to_address = data.get("to_address")
    amount = data.get("amount")
    asset = data.get("asset", "ETH")

    if not all([wallet_id, to_address, amount]):
        return jsonify({"error": "wallet_id, to_address, and amount are required"}), 400

    db = get_db()
    user_id = g.user["id"]

    # Verify the user owns the wallet or has a transfer delegation
    wallet = dict_from_row(
        db.execute("SELECT * FROM wallets WHERE dfns_wallet_id = ?", (wallet_id,)).fetchone()
    )
    if wallet is None:
        db.close()
        return jsonify({"error": "Wallet not found"}), 404

    # Check delegation if the user is not the wallet owner
    delegation = None
    if wallet["owner_id"] != user_id:
        delegation = dict_from_row(
            db.execute(
                "SELECT * FROM delegations WHERE wallet_id = ? AND grantee_id = ? AND permission = 'transfer'",
                (wallet_id, user_id),
            ).fetchone()
        )
        if delegation is None:
            db.close()
            return jsonify({"error": "No transfer permission for this wallet"}), 403

    # Parse the amount
    try:
        amount_float = float(amount)
    except ValueError:
        db.close()
        return jsonify({"error": "Invalid amount"}), 400

    # Determine the approval threshold:
    # - Delegated users may have a per-person transfer_limit (e.g. 0.01 ETH for a kid)
    # - Otherwise, use the global APPROVAL_THRESHOLD from config
    threshold = Config.APPROVAL_THRESHOLD
    if delegation and delegation.get("transfer_limit") is not None:
        threshold = delegation["transfer_limit"]

    needs_approval = amount_float >= threshold

    if needs_approval:
        # Queue for bank employee approval — don't broadcast yet
        db.execute(
            """
            INSERT INTO transfer_requests (wallet_id, initiated_by, to_address, amount, asset, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
            """,
            (wallet_id, user_id, to_address, amount, asset),
        )
        db.commit()
        transfer_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        transfer = dict_from_row(
            db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
        )
        db.close()
        return jsonify({"transfer": transfer, "message": "Transfer queued for approval"}), 201
    else:
        # Execute immediately via Dfns — broadcast the transaction on-chain
        dfns = get_dfns_client()
        try:
            # Convert ETH to wei (1 ETH = 10^18 wei). Use Decimal for precision.
            amount_wei = str(int(Decimal(amount) * 10**18))
            tx = dfns.wallets.transfer_asset(
                wallet_id=wallet_id,
                body={
                    "kind": "Native",
                    "to": to_address,
                    "amount": amount_wei,
                },
            )
            dfns_tx_id = tx.get("id", "")

            # Record the transfer locally with status 'broadcasted'
            db.execute(
                """
                INSERT INTO transfer_requests
                    (wallet_id, initiated_by, to_address, amount, asset, status, dfns_tx_id)
                VALUES (?, ?, ?, ?, ?, 'broadcasted', ?)
                """,
                (wallet_id, user_id, to_address, amount, asset, dfns_tx_id),
            )
            db.commit()
            transfer_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            transfer = dict_from_row(
                db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
            )
            db.close()
            return jsonify({"transfer": transfer, "message": "Transfer broadcasted"}), 201

        except Exception as e:
            db.close()
            return jsonify({"error": f"Transfer failed: {str(e)}"}), 500
