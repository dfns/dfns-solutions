/**
 * Auth0 catch-all route handler.
 *
 * Auth0 v4 requires both GET and POST handlers that delegate to auth0.middleware().
 * This handles the /auth/login, /auth/callback, and /auth/logout routes.
 *
 * Note: In Auth0 v4, the route file path must be /auth/[auth0]/route.ts
 * (the [auth0] segment is a dynamic catch-all used by the SDK internally).
 */

import { auth0 } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return auth0.middleware(req);
}

export async function POST(req: NextRequest) {
  return auth0.middleware(req);
}
