/**
 * Auth0 client configuration (server-side).
 *
 * Uses @auth0/nextjs-auth0 v4 which provides:
 *   - Automatic session management via encrypted cookies
 *   - A middleware-based approach (auth0.middleware) for handling login/logout/callback
 *   - Server-side session access via auth0.getSession()
 *
 * The `audience` parameter ensures Auth0 issues an access token (not just an ID token)
 * scoped to our API. Without it, the token would be opaque and unusable by the backend.
 *
 * Environment variables (read automatically by the SDK):
 *   AUTH0_SECRET       — Random string for session encryption
 *   AUTH0_DOMAIN       — Auth0 tenant domain (e.g. "your-tenant.auth0.com")
 *   AUTH0_CLIENT_ID    — Auth0 application client ID
 *   AUTH0_CLIENT_SECRET — Auth0 application client secret
 *   APP_BASE_URL       — This app's URL (e.g. "http://localhost:3000")
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
  },
});
