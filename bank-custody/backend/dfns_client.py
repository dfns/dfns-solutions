"""
Dfns SDK client — singleton.

Initializes a DfnsClient using the service account credentials from Config.
The client is created once and reused for all requests (module-level singleton).

The bank uses a single Dfns service account to manage ALL customer wallets.
Customers never interact with Dfns directly — every wallet operation
(create, transfer, balance query) goes through this client.

Key SDK classes:
  - KeySigner: signs API requests with the service account's private key
  - DfnsClientConfig: holds the auth token, base URL, and signer
  - DfnsClient: the main client — provides `client.wallets.*` methods

Dfns Python SDK: https://github.com/dfns/dfns-sdk-python
"""

from dfns_sdk import DfnsClient, DfnsClientConfig
from dfns_sdk.auth import KeySigner

from config import Config

_client = None


def get_dfns_client() -> DfnsClient:
    """Return the singleton DfnsClient, creating it on first call."""
    global _client
    if _client is None:
        # KeySigner handles request signing using the service account's private key.
        # Each API request to Dfns is signed to prove it comes from an authorized app.
        key_signer = KeySigner(
            credential_id=Config.DFNS_CRED_ID,
            private_key=Config.DFNS_PRIVATE_KEY,
            app_origin=Config.DFNS_API_URL,
        )
        config = DfnsClientConfig(
            auth_token=Config.DFNS_AUTH_TOKEN,
            base_url=Config.DFNS_API_URL,
            signer=key_signer,
        )
        _client = DfnsClient(config)
    return _client
