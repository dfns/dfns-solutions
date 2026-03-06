"""
Bank Custody Backend — Flask REST API

This is the main entry point for the backend server. It wires together all
the route blueprints and initializes the SQLite database on startup.

The API is stateless and uses JWT Bearer tokens (issued by Auth0) for
authentication. Any client (web, mobile, CLI) can consume it.

Routes:
  /api/wallets/*     — Customer wallet CRUD and balance queries (via Dfns)
  /api/transfers/*   — Transfer initiation and history
  /api/delegations/* — Family access delegation (view / transfer permissions)
  /api/admin/*       — Bank employee dashboard (customer list, transfer approval)
  /api/health        — Simple health check
"""

from flask import Flask
from flask_cors import CORS

from config import Config
from database import init_db
from routes.wallets import wallets_bp
from routes.transfers import transfers_bp
from routes.delegation import delegation_bp
from routes.admin import admin_bp

app = Flask(__name__)
app.config.from_object(Config)

# Allow the Next.js frontend (localhost:3000) to call the API with credentials
CORS(app, origins=["http://localhost:3000"], supports_credentials=True)

# Register route blueprints — each blueprint handles a logical group of endpoints
app.register_blueprint(wallets_bp)
app.register_blueprint(transfers_bp)
app.register_blueprint(delegation_bp)
app.register_blueprint(admin_bp)


@app.route("/api/health")
def health():
    """Health check endpoint. Returns 200 if the server is running."""
    return {"status": "ok"}


# Create the SQLite tables on startup (idempotent — uses CREATE TABLE IF NOT EXISTS)
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(debug=True, port=5001)
