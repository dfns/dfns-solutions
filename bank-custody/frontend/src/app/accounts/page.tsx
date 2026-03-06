/**
 * Accounts page — the main dashboard showing all of the user's accounts.
 *
 * Displays three types of accounts in a single grid:
 *   1. Fiat accounts (EUR checking/savings) — auto-created on first login
 *   2. Own crypto wallets — created by the user via Dfns
 *   3. Delegated wallets — shared by family members (marked with a "Shared" badge)
 *
 * Also provides a "Create crypto account" form that calls Dfns to create
 * a real blockchain wallet. The wallet appears immediately in the grid.
 *
 * Crypto balances are fetched live from Dfns on every page load.
 */

"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import WalletCard from "@/components/WalletCard";
import { useApi } from "@/lib/useApi";
import { formatCryptoBalance } from "@/lib/format";

interface FiatAccount {
  id: string;
  name: string;
  currency: string;
  balance: number;
  iban: string;
}

interface Wallet {
  dfns_wallet_id: string;
  name: string;
  network?: string;
  address?: string;
  balance?: unknown;
  delegation_permission?: string;
}

export default function AccountsPage() {
  const { apiFetch, ready, role } = useApi();
  const [fiatAccounts, setFiatAccounts] = useState<FiatAccount[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [delegatedWallets, setDelegatedWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newWalletName, setNewWalletName] = useState("");
  const [newWalletNetwork, setNewWalletNetwork] = useState("EthereumSepolia");
  const [creating, setCreating] = useState(false);

  // Fetch all accounts on mount
  useEffect(() => {
    if (!ready) return;
    apiFetch("/api/wallets")
      .then((data) => {
        setFiatAccounts(data.fiat_accounts || []);
        setWallets(data.wallets || []);
        setDelegatedWallets(data.delegated_wallets || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiFetch, ready]);

  /** Create a new crypto wallet via Dfns, then refresh the list */
  const handleCreate = async () => {
    setCreating(true);
    try {
      await apiFetch("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ name: newWalletName || "My Wallet", network: newWalletNetwork }),
      });
      const data = await apiFetch("/api/wallets");
      setWallets(data.wallets || []);
      setShowCreate(false);
      setNewWalletName("");
    } catch {
      // handled silently
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar role={role} />
        <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>Loading your accounts...</div>
      </>
    );
  }

  return (
    <>
      <Navbar role={role} />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>My Accounts</h1>
          <button
            onClick={() => setShowCreate(true)}
            style={{ padding: "10px 20px", background: "#0f2027", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
          >
            + New crypto account
          </button>
        </div>

        {/* Wallet creation form (shown when button is clicked) */}
        {showCreate && (
          <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Create crypto account</h3>
            <div style={{ display: "flex", gap: 12 }}>
              <input
                type="text"
                value={newWalletName}
                onChange={(e) => setNewWalletName(e.target.value)}
                placeholder="Account name (e.g. My Ethereum)"
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              />
              <select
                value={newWalletNetwork}
                onChange={(e) => setNewWalletNetwork(e.target.value)}
                style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              >
                <option value="EthereumSepolia">Ethereum (Sepolia)</option>
                <option value="Bitcoin">Bitcoin</option>
                <option value="Polygon">Polygon</option>
              </select>
              <button onClick={handleCreate} disabled={creating} style={{ padding: "8px 20px", background: "#059669", color: "white", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
                {creating ? "Creating..." : "Create"}
              </button>
              <button onClick={() => setShowCreate(false)} style={{ padding: "8px 20px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Account grid — fiat accounts, own wallets, and delegated wallets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {fiatAccounts.map((a) => (
            <WalletCard key={a.id} id={a.id} name={a.name} type="fiat" currency={a.currency} balance={a.balance} iban={a.iban} />
          ))}
          {wallets.map((w) => (
            <WalletCard key={w.dfns_wallet_id} id={w.dfns_wallet_id} name={w.name} type="crypto" address={w.address} balance={formatCryptoBalance(w.balance)} network={w.network} />
          ))}
          {delegatedWallets.map((w) => (
            <WalletCard key={w.dfns_wallet_id} id={w.dfns_wallet_id} name={w.name} type="crypto" address={w.address} balance={formatCryptoBalance(w.balance)} network={w.network} delegated />
          ))}
        </div>

        {/* Empty state */}
        {fiatAccounts.length === 0 && wallets.length === 0 && (
          <div style={{ textAlign: "center", padding: 64, color: "#9ca3af" }}>
            <p style={{ fontSize: 18 }}>No accounts yet</p>
            <p>Create your first crypto account to get started.</p>
          </div>
        )}
      </div>
    </>
  );
}
