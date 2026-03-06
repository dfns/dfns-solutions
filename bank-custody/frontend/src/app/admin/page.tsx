/**
 * Admin dashboard — bank employee overview.
 *
 * Shows:
 *   - Total customer count
 *   - Pending approval count (with amber highlight if > 0)
 *   - Customer list with wallet counts
 *
 * The "Pending approvals" card links to /admin/approvals where employees
 * can review and approve/reject transfers.
 *
 * Access control: The backend returns 403 for non-employees. The Admin nav
 * link is also hidden client-side for non-employees (see Navbar component).
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useApi } from "@/lib/useApi";

interface Customer {
  id: string;
  email: string;
  name: string;
  wallet_count: number;
  created_at: string;
}

export default function AdminPage() {
  const { apiFetch, ready, role } = useApi();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      apiFetch("/api/admin/customers"),
      apiFetch("/api/admin/transfers?status=pending"),
    ])
      .then(([custData, txData]) => {
        setCustomers(custData.customers || []);
        setPendingCount((txData.transfers || []).length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiFetch, ready]);

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
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Bank Dashboard</h1>

        {/* Quick stats cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{customers.length}</div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>Customers</div>
          </div>
          {/* Pending approvals card — highlights amber when there are items to review */}
          <Link href="/admin/approvals" style={{ background: pendingCount > 0 ? "#fef3c7" : "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: pendingCount > 0 ? "#d97706" : "inherit" }}>{pendingCount}</div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>Pending approvals</div>
          </Link>
        </div>

        {/* Customer table */}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Customers</h2>
        <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #f3f4f6", textAlign: "left" }}>
                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#6b7280" }}>Name</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#6b7280" }}>Email</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#6b7280" }}>Wallets</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#6b7280" }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{c.name || "\u2014"}</td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{c.email}</td>
                  <td style={{ padding: "12px 16px" }}>{c.wallet_count}</td>
                  <td style={{ padding: "12px 16px", color: "#9ca3af" }}>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>No customers yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
