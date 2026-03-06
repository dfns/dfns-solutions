/**
 * ApprovalCard — displays a single pending transfer for employee review.
 *
 * Used on the /admin/approvals page. Shows:
 *   - Transfer amount and asset
 *   - Source wallet and initiator name
 *   - Full destination address
 *   - Optional comment field
 *   - Approve / Reject buttons
 *
 * When approved, the backend broadcasts the transfer on-chain via Dfns.
 * When rejected, the transfer is simply marked as rejected.
 */

"use client";

import { useState } from "react";

interface ApprovalCardProps {
  transfer: {
    id: number;
    wallet_name: string;
    initiator_name: string;
    initiator_email: string;
    to_address: string;
    amount: string;
    asset: string;
    created_at: string;
  };
  onApprove: (id: number, comment: string) => Promise<void>;
  onReject: (id: number, comment: string) => Promise<void>;
}

export default function ApprovalCard({ transfer, onApprove, onReject }: ApprovalCardProps) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: "approve" | "reject") => {
    setLoading(true);
    try {
      if (action === "approve") {
        await onApprove(transfer.id, comment);
      } else {
        await onReject(transfer.id, comment);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      {/* Transfer details */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
            {transfer.amount} {transfer.asset}
          </div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            From <strong>{transfer.wallet_name}</strong> by {transfer.initiator_name || transfer.initiator_email}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>
          {new Date(transfer.created_at).toLocaleString()}
        </div>
      </div>

      {/* Destination address */}
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, fontFamily: "monospace", wordBreak: "break-all" }}>
        To: {transfer.to_address}
      </div>

      {/* Action row: comment + approve/reject buttons */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comment (optional)"
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
        />
        <button
          onClick={() => handleAction("approve")}
          disabled={loading}
          style={{ padding: "8px 20px", background: "#059669", color: "white", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
        >
          Approve
        </button>
        <button
          onClick={() => handleAction("reject")}
          disabled={loading}
          style={{ padding: "8px 20px", background: "#dc2626", color: "white", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
