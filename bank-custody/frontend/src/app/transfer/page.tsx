/**
 * Transfer page — send ETH from a wallet.
 *
 * Shows the TransferForm component with all available wallets:
 *   - The user's own wallets
 *   - Delegated wallets where the user has 'transfer' permission
 *
 * Supports preselection via query param: /transfer?wallet=wa-xxx
 * (used when clicking "Send funds" from the wallet detail page).
 *
 * Wrapped in a Suspense boundary because useSearchParams() requires it in Next.js 15.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import TransferForm from "@/components/TransferForm";
import { useApi } from "@/lib/useApi";

interface Wallet {
  dfns_wallet_id: string;
  name: string;
  network?: string;
}

/** Outer wrapper — provides the Suspense boundary required by useSearchParams */
export default function TransferPage() {
  return (
    <Suspense>
      <TransferPageInner />
    </Suspense>
  );
}

/** Inner component — uses useSearchParams to read the preselected wallet */
function TransferPageInner() {
  const { apiFetch, ready, role } = useApi();
  const searchParams = useSearchParams();
  const preselectedWallet = searchParams.get("wallet");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    apiFetch("/api/wallets")
      .then((data) => {
        const all = [...(data.wallets || [])];
        // Include delegated wallets that have transfer permission
        const delegated = (data.delegated_wallets || []).filter(
          (w: { delegation_permission?: string }) => w.delegation_permission === "transfer"
        );
        setWallets([...all, ...delegated]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiFetch, ready]);

  // Reorder so the preselected wallet (from query param) appears first
  const orderedWallets = preselectedWallet
    ? [
        ...wallets.filter((w) => w.dfns_wallet_id === preselectedWallet),
        ...wallets.filter((w) => w.dfns_wallet_id !== preselectedWallet),
      ]
    : wallets;

  /** Submit the transfer to the backend */
  const handleSubmit = async (data: { wallet_id: string; to_address: string; amount: string; asset: string }) => {
    const result = await apiFetch("/api/transfers", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result;
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
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Send Funds</h1>
        <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 14 }}>
          Transfers over the approval threshold require bank approval before execution.
        </p>

        {wallets.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", background: "white", borderRadius: 12 }}>
            No crypto accounts available. Create one first.
          </div>
        ) : (
          <div style={{ background: "white", borderRadius: 12, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <TransferForm wallets={orderedWallets} onSubmit={handleSubmit} />
          </div>
        )}
      </div>
    </>
  );
}
