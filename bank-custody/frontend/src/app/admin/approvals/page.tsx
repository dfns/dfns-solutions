/**
 * Approval queue page — bank employees review pending transfers here.
 *
 * Shows all transfers with status='pending' (queued because they exceeded
 * the approval threshold). Each transfer is rendered as an ApprovalCard
 * with Approve / Reject buttons.
 *
 * When approved:
 *   - The backend converts ETH to wei and calls Dfns transfer_asset
 *   - The transaction is broadcast on-chain
 *   - The transfer status changes to 'approved'
 *
 * When rejected:
 *   - The transfer is marked as 'rejected'
 *   - No on-chain transaction occurs
 *
 * The list auto-refreshes after each action.
 */

"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import ApprovalCard from "@/components/ApprovalCard";
import { useApi } from "@/lib/useApi";

interface PendingTransfer {
  id: number;
  wallet_name: string;
  initiator_name: string;
  initiator_email: string;
  to_address: string;
  amount: string;
  asset: string;
  created_at: string;
}

export default function ApprovalsPage() {
  const { apiFetch, ready, role } = useApi();
  const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  /** Fetch pending transfers from the API */
  const refresh = async () => {
    const data = await apiFetch("/api/admin/transfers?status=pending");
    setTransfers(data.transfers || []);
  };

  useEffect(() => {
    if (!ready) return;
    refresh().finally(() => setLoading(false));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Approve a transfer — broadcasts on-chain via Dfns */
  const handleApprove = async (id: number, comment: string) => {
    await apiFetch(`/api/admin/transfers/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    await refresh();
  };

  /** Reject a transfer — marks as rejected, no on-chain action */
  const handleReject = async (id: number, comment: string) => {
    await apiFetch(`/api/admin/transfers/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    await refresh();
  };

  if (loading) {
    return (
      <>
        <Navbar role={role} />
        <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>Loading...</div>
      </>
    );
  }

  return (
    <>
      <Navbar role={role} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Approval Queue</h1>
        <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 14 }}>
          Transfers exceeding the threshold require your review.
        </p>

        {transfers.length === 0 ? (
          <div style={{ background: "white", borderRadius: 12, padding: 40, textAlign: "center", color: "#9ca3af" }}>
            No pending approvals
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {transfers.map((t) => (
              <ApprovalCard key={t.id} transfer={t} onApprove={handleApprove} onReject={handleReject} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
