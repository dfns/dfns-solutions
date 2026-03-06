"""
Application configuration.

All settings are read from environment variables (loaded from .env via python-dotenv).
See .env.example for the full list of required variables.
"""

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))


class Config:
    # --- Flask ---
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    DATABASE = os.getenv('DATABASE', os.path.join(os.path.dirname(__file__), 'bank_custody.db'))

    # --- Dfns (service account credentials) ---
    # The backend uses a single Dfns service account to manage all customer wallets.
    # This is the "bank-as-custodian" model: the bank has full control over wallet ops.
    DFNS_API_URL = os.getenv('DFNS_API_URL', 'https://api.dfns.io')
    DFNS_AUTH_TOKEN = os.getenv('DFNS_AUTH_TOKEN', '')
    DFNS_CRED_ID = os.getenv('DFNS_CRED_ID', '')
    DFNS_PRIVATE_KEY = os.getenv('DFNS_PRIVATE_KEY', '')

    # --- Auth0 ---
    # The backend verifies JWTs issued by Auth0. It does NOT need the client secret —
    # verification is done via Auth0's public JWKS endpoint.
    AUTH0_DOMAIN = os.getenv('AUTH0_DOMAIN', '')      # e.g. "your-tenant.auth0.com"
    AUTH0_AUDIENCE = os.getenv('AUTH0_AUDIENCE', 'https://bank-custody-api')

    # --- Transfer approval ---
    # Transfers at or above this amount (in ETH) require bank employee approval.
    # Delegated users (e.g. kids) can have a lower per-person limit set on their delegation.
    APPROVAL_THRESHOLD = float(os.getenv('APPROVAL_THRESHOLD', '1000'))
