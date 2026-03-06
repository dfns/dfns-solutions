/**
 * Account detail page — shows a single crypto wallet with balance and transaction history.
 *
 * Displays:
 *   - Wallet name, network, and status (Active/Pending)
 *   - Live balance fetched from Dfns
 *   - Full blockchain address (for receiving funds)
 *   - "Send funds" button (links to the transfer page with this wallet preselected)
 *   - Transaction history showing all transfers from this wallet
 *
 * Access control:
 *   - Wallet owner: full access
 *   - Delegated family member: access based on delegation permission
 *   - Bank employee: full access
 *
 * Note: This page is only for crypto wallets. Fiat accounts (EUR checking/savings)
 * are display-only on the accounts page and don't have a detail view.
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useApi } from "@/lib/useApi";
import { formatCryptoBalance } from "@/lib/format";

interface Transfer {
  id: number;
  to_address: string;
  amount: string;
  asset: string;
  status: string;
  created_at: string;
}

interface WalletDetail {
  dfns_wallet_id: string;
  name: string;
  address?: string;
  network?: string;
  status?: string;
  balance?: unknown;
  transfers: Transfer[];
}

/** Color coding for transfer statuses */
const statusColors: Record<string, string> = {
  pending: "#f59e0b",      // Amber — waiting for bank approval
  approved: "#059669",     // Green — approved and broadcasted
  rejected: "#dc2626",     // Red — rejected by the bank
  broadcasted: "#3b82f6",  // Blue — sent directly (below threshold)
};

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch, ready, role } = useApi();
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !id) return;
    apiFetch(`/api/wallets/${id}`)
      .then(setWallet)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiFetch, ready, id]);

  if (loading) {
    return (
      <>
        <Navbar role={role} />
        <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>Loading...</div>
      </>
    );
  }

  if (error || !wallet) {
    return (
      <>
        <Navbar role={role} />
        <div style={{ padding: 32, textAlign: "center", color: "#dc2626" }}>{error || "Account not found"}</div>
      </>
    );
  }

  return (
    <>
      <Navbar role={role} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <Link href="/accounts" style={{ color: "#6b7280", textDecoration: "none", fontSize: 13, display: "block", marginBottom: 16 }}>
          &larr; Back to accounts
        </Link>

        {/* Wallet overview card */}
        <div style={{ background: "white", borderRadius: 12, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>{wallet.name}</h1>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{wallet.network}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatCryptoBalance(wallet.balance)}</div>
              <div style={{ fontSize: 12, color: wallet.status === "Active" ? "#059669" : "#f59e0b" }}>{wallet.status}</div>
            </div>
          </div>
          {/* Blockchain address (for receiving funds / faucet) */}
          {wallet.address && (
            <div style={{ marginTop: 20, padding: 12, background: "#f9fafb", borderRadius: 8, fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", color: "#6b7280" }}>
              {wallet.address}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Link href={`/transfer?wallet=${wallet.dfns_wallet_id}`} style={{ display: "inline-block", padding: "10px 20px", background: "#0f2027", color: "white", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
              Send funds
            </Link>
          </div>
        </div>

        {/* Transaction history */}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Transaction History</h2>
        {wallet.transfers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", background: "white", borderRadius: 12 }}>
            No transactions yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {wallet.transfers.map((tx) => (
              <div key={tx.id} style={{ background: "white", borderRadius: 8, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{tx.amount} {tx.asset}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>To: {tx.to_address.slice(0, 10)}...{tx.to_address.slice(-8)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: statusColors[tx.status] || "#6b7280", textTransform: "capitalize" }}>
                    {tx.status}
                  </span>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                    {new Date(tx.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
