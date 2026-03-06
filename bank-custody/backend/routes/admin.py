"""
Admin routes — bank employee dashboard.

These endpoints are restricted to users with role='employee' (enforced by
the @require_employee decorator, which checks the Auth0 role claim).

Employees can:
  - View all customers and their wallet counts
  - View a specific customer's wallets
  - Review pending transfers (approve or reject)

When a transfer is approved, the backend broadcasts it on-chain via Dfns.
When rejected, the transfer is simply marked as 'rejected' in the database.
"""

from decimal import Decimal

from flask import Blueprint, jsonify, request, g

from auth import require_employee
from database import get_db, dict_from_row, dicts_from_rows
from dfns_client import get_dfns_client

admin_bp = Blueprint("admin", __name__)


@admin_bp.route("/api/admin/customers", methods=["GET"])
@require_employee
def list_customers():
    """
    List all customers with their wallet counts.

    Used by the bank dashboard to show an overview of all customers.
    Only users with role='customer' are listed (not employees).
    """
    db = get_db()
    customers = dicts_from_rows(
        db.execute(
            """
            SELECT u.*, COUNT(w.dfns_wallet_id) as wallet_count
            FROM users u
            LEFT JOIN wallets w ON w.owner_id = u.id
            WHERE u.role = 'customer'
            GROUP BY u.id
            ORDER BY u.created_at DESC
            """,
        ).fetchall()
    )
    db.close()
    return jsonify({"customers": customers})


@admin_bp.route("/api/admin/customers/<customer_id>/wallets", methods=["GET"])
@require_employee
def list_customer_wallets(customer_id):
    """
    List all wallets for a specific customer.

    Each wallet is enriched with its address and status from Dfns.
    """
    db = get_db()
    wallets = dicts_from_rows(
        db.execute("SELECT * FROM wallets WHERE owner_id = ? ORDER BY created_at DESC", (customer_id,)).fetchall()
    )

    # Enrich with live data from Dfns
    dfns = get_dfns_client()
    for wallet in wallets:
        try:
            details = dfns.wallets.get_wallet(wallet_id=wallet["dfns_wallet_id"])
            wallet["address"] = details.get("address", "")
            wallet["status"] = details.get("status", "")
        except Exception:
            wallet["address"] = ""
            wallet["status"] = "unknown"

    db.close()
    return jsonify({"wallets": wallets})


@admin_bp.route("/api/admin/transfers", methods=["GET"])
@require_employee
def list_pending_transfers():
    """
    List transfer requests filtered by status.

    Query params:
      ?status=pending  (default) — transfers awaiting employee review
      ?status=approved — previously approved transfers
      ?status=rejected — previously rejected transfers

    Each transfer includes the wallet name and initiator details.
    """
    db = get_db()
    status = request.args.get("status", "pending")

    transfers = dicts_from_rows(
        db.execute(
            """
            SELECT tr.*, w.name as wallet_name, u.email as initiator_email, u.name as initiator_name
            FROM transfer_requests tr
            JOIN wallets w ON w.dfns_wallet_id = tr.wallet_id
            JOIN users u ON u.id = tr.initiated_by
            WHERE tr.status = ?
            ORDER BY tr.created_at ASC
            """,
            (status,),
        ).fetchall()
    )
    db.close()
    return jsonify({"transfers": transfers})


@admin_bp.route("/api/admin/transfers/<int:transfer_id>/approve", methods=["POST"])
@require_employee
def approve_transfer(transfer_id):
    """
    Approve a pending transfer and broadcast it on-chain via Dfns.

    Request body (optional):
      { "comment": "Looks good" }

    Steps:
      1. Verify the transfer exists and is in 'pending' status
      2. Convert the ETH amount to wei (using Decimal for precision)
      3. Call Dfns transfer_asset to broadcast the transaction
      4. Update the transfer status to 'approved' with the Dfns transaction ID
    """
    data = request.get_json() or {}
    comment = data.get("comment", "")

    db = get_db()
    transfer = dict_from_row(
        db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
    )
    if transfer is None:
        db.close()
        return jsonify({"error": "Transfer not found"}), 404

    if transfer["status"] != "pending":
        db.close()
        return jsonify({"error": f"Transfer is already {transfer['status']}"}), 400

    # Broadcast the transaction via Dfns
    dfns = get_dfns_client()
    try:
        # Convert ETH to wei (1 ETH = 10^18 wei)
        amount_wei = str(int(Decimal(transfer["amount"]) * 10**18))
        tx = dfns.wallets.transfer_asset(
            wallet_id=transfer["wallet_id"],
            body={
                "kind": "Native",
                "to": transfer["to_address"],
                "amount": amount_wei,
            },
        )
        dfns_tx_id = tx.get("id", "")

        # Update transfer record with approval details
        db.execute(
            """
            UPDATE transfer_requests
            SET status = 'approved', dfns_tx_id = ?, reviewed_by = ?, review_comment = ?
            WHERE id = ?
            """,
            (dfns_tx_id, g.user["id"], comment, transfer_id),
        )
        db.commit()

        updated = dict_from_row(
            db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
        )
        db.close()
        return jsonify({"transfer": updated, "message": "Transfer approved and broadcasted"})

    except Exception as e:
        db.close()
        return jsonify({"error": f"Broadcast failed: {str(e)}"}), 500


@admin_bp.route("/api/admin/transfers/<int:transfer_id>/reject", methods=["POST"])
@require_employee
def reject_transfer(transfer_id):
    """
    Reject a pending transfer.

    Request body (optional):
      { "comment": "Amount too high, please contact support" }

    The transfer is marked as 'rejected' and is NOT broadcast on-chain.
    """
    data = request.get_json() or {}
    comment = data.get("comment", "")

    db = get_db()
    transfer = dict_from_row(
        db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
    )
    if transfer is None:
        db.close()
        return jsonify({"error": "Transfer not found"}), 404

    if transfer["status"] != "pending":
        db.close()
        return jsonify({"error": f"Transfer is already {transfer['status']}"}), 400

    db.execute(
        """
        UPDATE transfer_requests
        SET status = 'rejected', reviewed_by = ?, review_comment = ?
        WHERE id = ?
        """,
        (g.user["id"], comment, transfer_id),
    )
    db.commit()

    updated = dict_from_row(
        db.execute("SELECT * FROM transfer_requests WHERE id = ?", (transfer_id,)).fetchone()
    )
    db.close()
    return jsonify({"transfer": updated, "message": "Transfer rejected"})
