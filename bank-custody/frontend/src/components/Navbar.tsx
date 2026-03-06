/**
 * Top navigation bar — shown on every authenticated page.
 *
 * Links: Accounts, Send, Family, and (for employees only) Admin.
 * The `role` prop controls whether the Admin link is visible.
 * Highlights the active link based on the current URL path.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 32px",
  height: 64,
  background: "#0f2027",
  color: "white",
  fontSize: 14,
};

const linkStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.7)",
  textDecoration: "none",
  padding: "8px 16px",
  borderRadius: 6,
  transition: "all 0.15s",
};

const activeLinkStyle: React.CSSProperties = {
  ...linkStyle,
  color: "white",
  background: "rgba(255,255,255,0.12)",
};

export default function Navbar({ role }: { role?: string }) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <nav style={navStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <Link href="/accounts" style={{ color: "white", textDecoration: "none", fontWeight: 700, fontSize: 18 }}>
          SecureBank
        </Link>
        <div style={{ display: "flex", gap: 4 }}>
          <Link href="/accounts" style={isActive("/accounts") ? activeLinkStyle : linkStyle}>
            Accounts
          </Link>
          <Link href="/transfer" style={isActive("/transfer") ? activeLinkStyle : linkStyle}>
            Send
          </Link>
          <Link href="/family" style={isActive("/family") ? activeLinkStyle : linkStyle}>
            Family
          </Link>
          {role === "employee" && (
            <Link href="/admin" style={isActive("/admin") ? activeLinkStyle : linkStyle}>
              Admin
            </Link>
          )}
        </div>
      </div>
      <a href="/auth/logout" style={linkStyle}>
        Sign out
      </a>
    </nav>
  );
}
