/**
 * TransferForm — form for sending ETH from a wallet.
 *
 * Used on the /transfer page. Lets the user:
 *   1. Pick a source wallet (own or delegated with transfer permission)
 *   2. Enter a recipient address and amount
 *   3. Submit the transfer
 *
 * After submission, shows a status message:
 *   - Amber "queued" message if the transfer needs bank approval (amount >= threshold)
 *   - Green "broadcasted" message if it was executed immediately
 *   - Red error message if the transfer failed
 *
 * The parent component (TransferPage) handles the actual API call via onSubmit.
 */

"use client";

import { useState } from "react";

interface Wallet {
  dfns_wallet_id: string;
  name: string;
  network?: string;
}

interface TransferFormProps {
  wallets: Wallet[];
  onSubmit: (data: { wallet_id: string; to_address: string; amount: string; asset: string }) => Promise<{ message?: string; transfer?: { status?: string } }>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

export default function TransferForm({ wallets, onSubmit }: TransferFormProps) {
  const [walletId, setWalletId] = useState(wallets[0]?.dfns_wallet_id || "");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message?: string; error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await onSubmit({ wallet_id: walletId, to_address: toAddress, amount, asset: "ETH" });
      // Show different messages based on whether the transfer was queued or executed
      const isPending = res.transfer?.status === "pending";
      setResult({ message: isPending ? "Transfer queued for bank approval" : "Transfer broadcasted successfully" });
      setToAddress("");
      setAmount("");
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : "Transfer failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <label style={labelStyle}>From wallet</label>
        <select value={walletId} onChange={(e) => setWalletId(e.target.value)} style={inputStyle}>
          {wallets.map((w) => (
            <option key={w.dfns_wallet_id} value={w.dfns_wallet_id}>
              {w.name} ({w.network})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Recipient address</label>
        <input
          type="text"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          placeholder="0x..."
          required
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Amount (ETH)</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.01"
          required
          style={inputStyle}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "12px 24px",
          background: loading ? "#9ca3af" : "#0f2027",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 15,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Submitting..." : "Send"}
      </button>

      {/* Success/queued message */}
      {result?.message && (
        <div style={{
          padding: 12,
          background: result.message.includes("queued") ? "#fffbeb" : "#ecfdf5",
          color: result.message.includes("queued") ? "#d97706" : "#059669",
          borderRadius: 8,
          fontSize: 14,
        }}>
          {result.message}
        </div>
      )}
      {/* Error message */}
      {result?.error && (
        <div style={{ padding: 12, background: "#fef2f2", color: "#dc2626", borderRadius: 8, fontSize: 14 }}>
          {result.error}
        </div>
      )}
    </form>
  );
}
