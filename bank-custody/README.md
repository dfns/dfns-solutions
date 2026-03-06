# Bank Custody Platform

A full-stack web application demonstrating how a bank can offer crypto wallets to its customers using [Dfns](https://www.dfns.co/) as infrastructure. Crypto accounts sit alongside traditional fiat accounts — same look, same feel. Dfns powers the crypto side invisibly; customers never know it exists.

> Full tutorial: [docs.dfns.co/solutions/bank-custody](https://docs.dfns.co/solutions/bank-custody)

## What it does

- **Unified banking dashboard** — fiat accounts (EUR checking, savings) and crypto wallets (Ethereum, Bitcoin) displayed side by side
- **Wallet creation** — customers create new crypto accounts (Dfns creates the wallet behind the scenes)
- **Transfers with approval** — send crypto; transfers over a threshold require bank employee approval
- **Family delegation** — grant view or co-signer access to family members, with per-person transfer limits
- **Employee dashboard** — bank staff review and approve/reject pending transfers

## Architecture

```
┌─────────────────────┐
│   Next.js Frontend  │──┐
│  (React, Auth0)     │  │   ┌─────────────────────┐     ┌─────────────┐
└─────────────────────┘  ├──▶│   Flask Backend      │────▶│   Dfns API  │
                         │   │   (Python REST API)  │     │             │
┌─────────────────────┐  │   │  • Auth0 JWT verify  │     │  • Wallets  │
│   Mobile (future)   │──┘   │  • SQLite            │     │  • Txns     │
└─────────────────────┘      │  • Dfns Python SDK   │     └─────────────┘
                             └─────────────────────┘
```

The backend is a **pure REST API** with JWT auth — any client (web, mobile, CLI) can consume it.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + TypeScript |
| Backend | Flask (Python) |
| Database | SQLite |
| Auth | Auth0 |
| Crypto custody | Dfns (Python SDK, service account) |
| Blockchain | Ethereum Sepolia (via Dfns — no direct RPC) |

## Quick Start

### 1. Prerequisites

- Python 3.10+
- Node.js 18+
- A [Dfns](https://www.dfns.co/) account with a service account
- An [Auth0](https://auth0.com/) tenant

### 2. Configure Auth0

Create an Auth0 application (Regular Web Application) and an API:

| Setting | Value |
|---------|-------|
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| API Audience | `https://bank-custody-api` |

Authorize your application to access the API (Application → APIs tab → toggle on). On the API settings, enable **RBAC** and **Allow Offline Access**.

To enable bank employee access, create a role called `employee` in Auth0 and add a Post-Login Action that includes roles in the token:

```js
// Auth0 Action: "Add roles to token"
// IMPORTANT: The namespace MUST NOT be your Auth0 domain — Auth0 silently strips
// custom claims namespaced under its own domain. Use any other HTTPS URI.
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://bank-custody.example.com";
  api.accessToken.setCustomClaim(`${namespace}/roles`, event.authorization?.roles || []);
  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
  api.accessToken.setCustomClaim(`${namespace}/name`, event.user.name);
};
```

### 3. Configure environment

```bash
cd bank-custody

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your Dfns and Auth0 credentials

# Frontend
cp frontend/.env.example frontend/.env
# Edit frontend/.env with your Auth0 credentials
```

**Backend** (`backend/.env`):

| Variable | Description |
|----------|-------------|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_AUTH_TOKEN` | Service account auth token |
| `DFNS_CRED_ID` | Service account credential ID |
| `DFNS_PRIVATE_KEY` | Service account private key (PEM format) |
| `AUTH0_DOMAIN` | Your Auth0 tenant domain (e.g. `your-tenant.auth0.com`) |
| `AUTH0_AUDIENCE` | Auth0 API audience identifier |
| `APPROVAL_THRESHOLD` | Transfer amount in ETH requiring bank approval (default: `1000`) |

**Frontend** (`frontend/.env`):

| Variable | Description |
|----------|-------------|
| `AUTH0_SECRET` | Random string for session encryption |
| `APP_BASE_URL` | Frontend URL (default: `http://localhost:3000`) |
| `AUTH0_DOMAIN` | Your Auth0 tenant domain |
| `AUTH0_CLIENT_ID` | Auth0 application client ID |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret |
| `AUTH0_AUDIENCE` | Auth0 API audience identifier |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: `http://localhost:5001`) |

### 4. Start the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py    # Starts on http://localhost:5001
```

> Fiat accounts are auto-created for each customer on first login — no seed script needed.

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev      # Starts on http://localhost:3000
```

## Demo Walkthrough

The demo tells the story of a family banking with SecureBank: two parents (Alice and Bob) and their kid (Charlie). The bank offers crypto wallets alongside traditional fiat accounts, with policies that match each family member's needs.

### Part 1 — Bank setup

Before any customers sign up, set up the bank's compliance infrastructure.

**Create the bank employee:**

1. Create an Auth0 user for the compliance officer (e.g. `compliance@yourbank.com`)
2. In Auth0 → User Management → Roles, assign the `employee` role to this user

**Configure approval policy:**

The `APPROVAL_THRESHOLD` in `backend/.env` sets the global transfer limit (in ETH). Transfers at or above this amount require employee approval. Default is `1000`. For the demo, set it to something low like `0.05` so you can test the approval flow without large amounts.

### Part 2 — Create the family

Create three Auth0 users — they'll register automatically in the app on first login:

| User | Email | Role |
|------|-------|------|
| Parent 1 (Alice) | `alice@example.com` | Customer |
| Parent 2 (Bob) | `bob@example.com` | Customer |
| Kid (Charlie) | `charlie@example.com` | Customer |

### Part 3 — Alice sets up the family wallets

Log in as **Alice** (Parent 1):

1. **Create her own wallet** — click "+ New crypto account", name it "Alice's Wallet" (Ethereum Sepolia)
2. **Create the kid's wallet** — click "+ New crypto account" again, name it "Charlie's Wallet"
3. **Fund both wallets** using a [Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
4. **Share access** — go to the **Family** page:
   - Share "Alice's Wallet" with Bob → **View + Transfer** (full co-signer access)
   - Share "Charlie's Wallet" with Bob → **View + Transfer**
   - Share "Charlie's Wallet" with Charlie → **View + Transfer**, set the approval threshold to `0.01` ETH (low limit for the kid)

### Part 4 — Bob creates his own wallet

Log in as **Bob** (Parent 2):

1. **Create his own wallet** — click "+ New crypto account", name it "Bob's Wallet" (Ethereum Sepolia)
2. Verify he can see Alice's wallets and Charlie's wallet in his dashboard (marked as "Shared")
3. **Share access** — go to **Family** and share "Bob's Wallet" with Alice → **View + Transfer**

### Part 5 — Charlie sends some pocket money

Log in as **Charlie** (Kid):

1. Verify he can see "Charlie's Wallet" in the dashboard (marked as "Shared")
2. **Send a tiny amount** (e.g. 0.001 ETH) — goes through immediately (under his 0.01 ETH limit)
3. **Send a larger amount** (e.g. 0.02 ETH) — queued for approval (over his personal limit)

### Part 6 — Bank employee reviews

Log in as the **bank employee**:

1. Go to the **Admin** section
2. See Charlie's pending transfer
3. **Approve** or **Reject** the transfer
4. Approved transfers execute on-chain via Dfns

## API Endpoints

### Customer (require Auth0 JWT)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/wallets` | List fiat accounts, own wallets, and delegated wallets |
| `POST` | `/api/wallets` | Create a new crypto wallet |
| `GET` | `/api/wallets/:id` | Wallet detail + balance |
| `GET` | `/api/transfers` | My transfer history |
| `POST` | `/api/transfers` | Initiate a transfer |
| `GET` | `/api/delegations` | List my delegations |
| `POST` | `/api/delegations` | Grant family access (with optional transfer_limit) |
| `DELETE` | `/api/delegations/:id` | Revoke access |

### Employee (require Auth0 JWT + employee role)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/customers` | List all customers |
| `GET` | `/api/admin/customers/:id/wallets` | List a customer's wallets |
| `GET` | `/api/admin/transfers` | Pending transfers |
| `POST` | `/api/admin/transfers/:id/approve` | Approve + broadcast |
| `POST` | `/api/admin/transfers/:id/reject` | Reject transfer |

## Design Decisions

- **Dfns is source of truth** for wallet balances, addresses, and transaction status. SQLite only stores what Dfns doesn't know: user–wallet ownership, friendly names, delegations, and the approval queue.
- **Service account pattern** — the backend holds a Dfns service account key. Customers never interact with Dfns directly. This is the "bank-as-custodian" model.
- **Mobile-ready API** — pure REST, JWT Bearer auth, JSON responses. No server-side sessions or cookies required.
- **Policy-based approvals** — transfers above a configurable threshold are queued for human review before execution. Delegated users (like kids) can have a per-person limit that's lower than the global threshold.
