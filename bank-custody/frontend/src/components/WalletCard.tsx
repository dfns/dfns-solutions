/**
 * WalletCard — displays a single account (fiat or crypto) in a card layout.
 *
 * Used on the Accounts page to show all accounts in a grid.
 * - Crypto wallets link to their detail page (/accounts/:id)
 * - Fiat accounts are display-only (no detail page)
 * - Delegated wallets show a "Shared" badge
 *
 * The balance for crypto wallets is pre-formatted by the caller using
 * formatCryptoBalance(). Fiat balances are formatted using Intl.NumberFormat.
 */

"use client";

import Link from "next/link";

interface WalletCardProps {
  id: string;
  name: string;
  type: "fiat" | "crypto";
  currency?: string;
  balance?: string | number | null;
  address?: string;
  iban?: string;
  network?: string;
  delegated?: boolean;
}

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  textDecoration: "none",
  color: "inherit",
  display: "block",
  transition: "box-shadow 0.15s",
};

export default function WalletCard({ id, name, type, currency, balance, address, iban, network, delegated }: WalletCardProps) {
  const formatBalance = () => {
    if (balance === null || balance === undefined) return "\u2014";
    if (type === "fiat") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "EUR" }).format(Number(balance));
    }
    return `${balance}`;
  };

  const subtitle = type === "fiat" ? iban : address;
  const badge = type === "crypto" ? network : currency;

  const content = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ background: type === "crypto" ? "#ede9fe" : "#ecfdf5", color: type === "crypto" ? "#7c3aed" : "#059669", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
              {badge}
            </span>
            {delegated && (
              <span style={{ background: "#fef3c7", color: "#d97706", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                Shared
              </span>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{name}</div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{formatBalance()}</div>
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {subtitle}
        </div>
      )}
    </>
  );

  // Fiat accounts are display-only; crypto wallets link to the detail page
  if (type === "fiat") {
    return <div style={cardStyle}>{content}</div>;
  }

  return <Link href={`/accounts/${id}`} style={cardStyle}>{content}</Link>;
}
