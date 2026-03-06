/**
 * Next.js middleware — handles Auth0 authentication routes.
 *
 * Auth0 v4 uses a middleware-based approach instead of API route handlers.
 * This middleware intercepts all requests to /auth/* and delegates to the
 * Auth0 SDK, which handles:
 *   /auth/login    — Redirect to Auth0 Universal Login
 *   /auth/callback — Process the OAuth callback after login
 *   /auth/logout   — End the session and redirect to Auth0 logout
 *   /auth/token    — (custom route, see app/auth/token/route.ts)
 *
 * The matcher ensures only /auth/* routes are processed — all other pages
 * pass through without any middleware overhead.
 */

import { auth0 } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  return auth0.middleware(req);
}

export const config = {
  matcher: ["/auth/:path*"],
};
