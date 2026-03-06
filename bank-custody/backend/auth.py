"""
Authentication and authorization middleware.

Verifies Auth0 JWT access tokens and manages local user records.

Auth flow:
  1. The Next.js frontend authenticates the user via Auth0 and obtains a JWT access token.
  2. The frontend sends the token as `Authorization: Bearer <token>` on every API call.
  3. This module verifies the token signature against Auth0's JWKS (public keys).
  4. On first login, it auto-creates a local user record and demo fiat accounts.

Custom claims:
  Auth0 tokens include custom claims added by a Post-Login Action:
    - `https://bank-custody.example.com/email`  — the user's email
    - `https://bank-custody.example.com/name`   — the user's display name
    - `https://bank-custody.example.com/roles`  — list of Auth0 roles (e.g. ["employee"])

  IMPORTANT: The namespace MUST NOT be your Auth0 tenant domain. Auth0 silently
  strips custom claims namespaced under its own domain. We use a custom URI instead.

Decorators:
  @require_auth     — verifies JWT and sets g.user for the current request
  @require_employee — same as @require_auth, but also checks that the user is an employee
"""

import json
import uuid
from functools import wraps
from urllib.request import urlopen

from flask import request, g, jsonify
from jose import jwt, JWTError

from config import Config
from database import get_db, dict_from_row

# In-memory cache for Auth0's JSON Web Key Set. Fetched once and reused.
# In production you'd want TTL-based expiry, but for a demo this is fine.
_jwks_cache = None

# Custom claims namespace — must match the Auth0 Post-Login Action exactly.
# See README.md for the Action code.
NS = "https://bank-custody.example.com"


def _get_jwks():
    """Fetch and cache Auth0's JWKS (public keys used to verify JWT signatures)."""
    global _jwks_cache
    if _jwks_cache is None:
        url = f"https://{Config.AUTH0_DOMAIN}/.well-known/jwks.json"
        response = urlopen(url)
        _jwks_cache = json.loads(response.read())
    return _jwks_cache


def _decode_token(token):
    """
    Verify and decode a JWT access token.

    Steps:
      1. Fetch Auth0's JWKS (cached after first call)
      2. Find the RSA public key matching the token's `kid` header
      3. Verify signature, audience, issuer, and expiration
      4. Return the decoded payload (dict of claims)

    Raises JWTError if the token is invalid, expired, or has no matching key.
    """
    jwks = _get_jwks()
    unverified_header = jwt.get_unverified_header(token)

    # Find the RSA key that matches this token's key ID (kid)
    rsa_key = {}
    for key in jwks["keys"]:
        if key["kid"] == unverified_header.get("kid"):
            rsa_key = {
                "kty": key["kty"],
                "kid": key["kid"],
                "use": key["use"],
                "n": key["n"],
                "e": key["e"],
            }
            break

    if not rsa_key:
        raise JWTError("No matching key found")

    # Verify and decode the token
    payload = jwt.decode(
        token,
        rsa_key,
        algorithms=["RS256"],
        audience=Config.AUTH0_AUDIENCE,
        issuer=f"https://{Config.AUTH0_DOMAIN}/",
    )
    return payload


def _ensure_user(payload):
    """
    Find or create the local user record from Auth0 token claims.

    On first login:
      - Creates the user in SQLite (id = Auth0 sub claim)
      - Determines role from custom claims (employee if role is assigned in Auth0, else customer)
      - For customers: auto-creates two demo fiat accounts (EUR checking + savings)
        so the dashboard looks realistic without any manual setup.

    Returns the user dict.
    """
    sub = payload["sub"]
    email = payload.get(f"{NS}/email", "")
    name = payload.get(f"{NS}/name", "")

    # Extract role from custom claims — Auth0 roles may have varying capitalization
    roles = [r.lower() for r in payload.get(f"{NS}/roles", [])]
    role = "employee" if "employee" in roles else "customer"

    db = get_db()
    user = dict_from_row(db.execute("SELECT * FROM users WHERE id = ?", (sub,)).fetchone())

    if user is None:
        # First login — create user record
        db.execute(
            "INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)",
            (sub, email, name, role),
        )
        # Auto-create demo fiat accounts for customers (not employees)
        if role == "customer":
            first_name = name.split()[0] if name else (email.split("@")[0].capitalize() if email else "User")
            db.execute(
                "INSERT INTO fiat_accounts (id, owner_id, name, currency, balance, iban) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), sub, f"{first_name}'s EUR Checking", "EUR", 12450.00, f"FR76 3000 6000 {uuid.uuid4().int % 10**13:013d}"),
            )
            db.execute(
                "INSERT INTO fiat_accounts (id, owner_id, name, currency, balance, iban) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), sub, f"{first_name}'s EUR Savings", "EUR", 85200.50, f"FR76 3000 6000 {uuid.uuid4().int % 10**13:013d}"),
            )
        db.commit()
        user = dict_from_row(db.execute("SELECT * FROM users WHERE id = ?", (sub,)).fetchone())

    db.close()
    return user


def require_auth(f):
    """
    Flask route decorator: require a valid Auth0 JWT.

    Extracts the Bearer token from the Authorization header, verifies it,
    and sets `g.user` to the local user record for the duration of the request.
    Returns 401 if the token is missing or invalid.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        token = auth_header.split(" ", 1)[1]
        try:
            payload = _decode_token(token)
        except JWTError as e:
            return jsonify({"error": f"Invalid token: {str(e)}"}), 401

        user = _ensure_user(payload)
        g.user = user
        return f(*args, **kwargs)

    return decorated


def require_employee(f):
    """
    Flask route decorator: require an authenticated bank employee.

    Builds on @require_auth — first verifies the JWT, then checks that
    the user has role='employee'. Returns 403 if they're a regular customer.
    """
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        if g.user["role"] != "employee":
            return jsonify({"error": "Employee access required"}), 403
        return f(*args, **kwargs)

    return decorated
