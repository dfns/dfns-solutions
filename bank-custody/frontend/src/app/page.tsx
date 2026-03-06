/**
 * Landing page — shown to unauthenticated users.
 *
 * If the user is already logged in (has an Auth0 session), they're
 * redirected straight to /accounts. Otherwise, shows a branded login page
 * with a "Sign in" button that triggers the Auth0 Universal Login flow.
 *
 * This is a Server Component — it can access the Auth0 session directly.
 */

import { auth0 } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth0.getSession();

  if (session) {
    redirect("/accounts");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)" }}>
      <div style={{ textAlign: "center", color: "white", maxWidth: 480, padding: "0 24px" }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>SecureBank</h1>
        <p style={{ fontSize: 18, opacity: 0.85, marginBottom: 40, lineHeight: 1.6 }}>
          Your fiat and crypto accounts, unified in one place. Seamless banking, powered by institutional-grade custody.
        </p>
        <a
          href="/auth/login"
          style={{
            display: "inline-block",
            padding: "14px 40px",
            background: "white",
            color: "#0f2027",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          Sign in to your account
        </a>
      </div>
    </div>
  );
}
