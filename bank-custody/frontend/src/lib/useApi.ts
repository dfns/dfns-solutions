/**
 * useApi hook — provides authenticated API access for client components.
 *
 * This hook:
 *   1. Fetches the Auth0 access token from /auth/token on mount
 *   2. Decodes the JWT client-side to extract the user's role (employee vs customer)
 *   3. Returns `apiFetch` — a fetch wrapper that adds the Authorization header
 *
 * Usage:
 *   const { apiFetch, ready, role } = useApi();
 *   if (!ready) return <Loading />;
 *   const data = await apiFetch("/api/wallets");
 *
 * The `role` is extracted from the custom claims namespace in the JWT.
 * It's used to show/hide the Admin link in the navbar.
 *
 * The `ready` flag becomes true once the token is loaded — pages should
 * wait for it before making API calls.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

/** Backend API base URL (set via NEXT_PUBLIC_API_URL env var) */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

/** Custom claims namespace — must match the Auth0 Post-Login Action and backend auth.py */
const CLAIMS_NS = "https://bank-custody.example.com";

/**
 * Decode a JWT payload without verification (client-side only).
 * We only need the claims for UI decisions (role display), not for security.
 * The backend independently verifies the token for all API calls.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

/** Fetch the access token from our server-side token endpoint */
async function getAccessToken(): Promise<string> {
  const res = await fetch("/auth/token");
  if (!res.ok) throw new Error("Not authenticated");
  const data = await res.json();
  return data.accessToken;
}

export function useApi() {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string>("customer");

  // Fetch token on mount and extract the user's role from custom claims
  useEffect(() => {
    getAccessToken()
      .then((t) => {
        setToken(t);
        const payload = decodeJwtPayload(t);
        const roles = (payload[`${CLAIMS_NS}/roles`] as string[]) || [];
        if (roles.some((r) => r.toLowerCase() === "employee")) {
          setRole("employee");
        }
      })
      .catch(() => setToken(null));
  }, []);

  /**
   * Authenticated fetch wrapper.
   * Adds Content-Type and Authorization headers automatically.
   * Throws an Error with the API error message on non-2xx responses.
   */
  const apiFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const currentToken = token || (await getAccessToken());
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
          ...options.headers,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error ${res.status}`);
      }

      return res.json();
    },
    [token]
  );

  return { apiFetch, ready: token !== null, role };
}
