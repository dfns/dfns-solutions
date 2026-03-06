/**
 * Family access page — share wallet access with family members.
 *
 * Wallet owners can:
 *   - Grant "view" or "transfer" access to another user (by email)
 *   - Set a per-person transfer limit (e.g. 0.01 ETH for a kid)
 *   - Revoke previously granted access
 *
 * The page shows two sections:
 *   1. "Shared by you" — delegations the current user has granted
 *   2. "Shared with you" — delegations the current user has received
 *
 * The grantee must have logged in at least once (so their email exists in the DB).
 * If a delegation already exists, it's updated rather than duplicated.
 */

"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { useApi } from "@/lib/useApi";

interface Delegation {
  id: number;
  wallet_id: string;
  wallet_name: string;
  grantee_email?: string;
  grantee_name?: string;
  grantor_email?: string;
  grantor_name?: string;
  permission: string;
  transfer_limit?: number | null;
  created_at: string;
}

interface Wallet {
  dfns_wallet_id: string;
  name: string;
}

export default function FamilyPage() {
  const { apiFetch, ready, role } = useApi();
  const [granted, setGranted] = useState<Delegation[]>([]);
  const [received, setReceived] = useState<Delegation[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  // Grant form state
  const [walletId, setWalletId] = useState("");
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("view");
  const [transferLimit, setTransferLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  /** Fetch delegations and wallets from the API */
  const refresh = async () => {
    const [delegations, walletData] = await Promise.all([
      apiFetch("/api/delegations"),
      apiFetch("/api/wallets"),
    ]);
    setGranted(delegations.granted || []);
    setReceived(delegations.received || []);
    const w = walletData.wallets || [];
    setWallets(w);
    if (w.length > 0 && !walletId) setWalletId(w[0].dfns_wallet_id);
  };

  useEffect(() => {
    if (!ready) return;
    refresh().finally(() => setLoading(false));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Grant access to a family member */
  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await apiFetch("/api/delegations", {
        method: "POST",
        body: JSON.stringify({
          wallet_id: walletId,
          grantee_email: email,
          permission,
          // Only include transfer_limit if permission is "transfer" and a limit is set
          ...(permission === "transfer" && transferLimit ? { transfer_limit: parseFloat(transferLimit) } : {}),
        }),
      });
      setMessage("Access granted successfully");
      setEmail("");
      await refresh();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to grant access");
    } finally {
      setSubmitting(false);
    }
  };

  /** Revoke a delegation */
  const handleRevoke = async (id: number) => {
    try {
      await apiFetch(`/api/delegations/${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      // handled silently
    }
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
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Family Access</h1>
        <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 14 }}>
          Share view or transfer access to your crypto accounts with family members.
        </p>

        {/* Grant access form */}
        <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 32 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Grant access</h3>
          {wallets.length === 0 ? (
            <p style={{ color: "#9ca3af" }}>Create a crypto account first to share access.</p>
          ) : (
            <form onSubmit={handleGrant} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <select value={walletId} onChange={(e) => setWalletId(e.target.value)} style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}>
                {wallets.map((w) => (
                  <option key={w.dfns_wallet_id} value={w.dfns_wallet_id}>{w.name}</option>
                ))}
              </select>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Family member's email"
                required
                style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              />
              <select value={permission} onChange={(e) => setPermission(e.target.value)} style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}>
                <option value="view">View only</option>
                <option value="transfer">View + Transfer</option>
              </select>
              {/* Per-person transfer limit — only shown when permission is "transfer" */}
              {permission === "transfer" && (
                <input
                  type="number"
                  step="any"
                  value={transferLimit}
                  onChange={(e) => setTransferLimit(e.target.value)}
                  placeholder="Approval threshold (ETH)"
                  style={{ width: 180, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                />
              )}
              <button type="submit" disabled={submitting} style={{ padding: "8px 20px", background: "#0f2027", color: "white", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
                {submitting ? "..." : "Grant"}
              </button>
            </form>
          )}
          {message && <div style={{ marginTop: 12, fontSize: 13, color: message.includes("success") ? "#059669" : "#dc2626" }}>{message}</div>}
        </div>

        {/* Delegations granted by me */}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Shared by you</h2>
        {granted.length === 0 ? (
          <div style={{ background: "white", borderRadius: 12, padding: 24, color: "#9ca3af", textAlign: "center", marginBottom: 32 }}>
            No active delegations
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            {granted.map((d) => (
              <div key={d.id} style={{ background: "white", borderRadius: 8, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.grantee_name || d.grantee_email}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {d.wallet_name} &middot; {d.permission}
                    {d.transfer_limit != null && ` \u00b7 limit: ${d.transfer_limit} ETH`}
                  </div>
                </div>
                <button onClick={() => handleRevoke(d.id)} style={{ padding: "6px 14px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Delegations received from others */}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Shared with you</h2>
        {received.length === 0 ? (
          <div style={{ background: "white", borderRadius: 12, padding: 24, color: "#9ca3af", textAlign: "center" }}>
            No accounts have been shared with you
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {received.map((d) => (
              <div key={d.id} style={{ background: "white", borderRadius: 8, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.wallet_name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Shared by {d.grantor_name || d.grantor_email} &middot; {d.permission}
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
