/**
 * Token endpoint — returns the Auth0 access token to the frontend.
 *
 * The frontend (client components) can't access the Auth0 session directly
 * because sessions are stored in encrypted HTTP-only cookies managed by the SDK.
 *
 * Flow:
 *   1. Client component calls `fetch("/auth/token")`
 *   2. This route reads the session from the cookie (server-side)
 *   3. Returns the access token as JSON
 *   4. Client uses it as `Authorization: Bearer <token>` for backend API calls
 *
 * Returns 401 if the user is not authenticated.
 */

import { auth0 } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ accessToken: session.tokenSet.accessToken });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
