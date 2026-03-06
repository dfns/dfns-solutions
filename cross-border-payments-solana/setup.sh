#!/usr/bin/env bash
set -e

echo "=== Solana Cross-Border Payments — Setup ==="
echo ""

# 1. Rust / Cargo
if command -v cargo &> /dev/null; then
  echo "Rust already installed: $(rustc --version)"
else
  echo "Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  echo "Installed: $(rustc --version)"
fi

# 2. Solana CLI
if command -v solana &> /dev/null; then
  echo "Solana CLI already installed: $(solana --version)"
else
  echo "Installing Solana CLI..."
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  echo "Installed: $(solana --version)"
fi

# 3. Anchor via avm
if command -v anchor &> /dev/null; then
  echo "Anchor already installed: $(anchor --version)"
else
  echo "Installing Anchor Version Manager (avm)..."
  cargo install --git https://github.com/coral-xyz/anchor avm --force
  echo "Installing Anchor 0.32.1..."
  avm install 0.32.1
  avm use 0.32.1
  echo "Installed: $(anchor --version)"
fi

# 4. Node dependencies
echo ""
echo "Installing Node.js dependencies..."
npm install

# 5. Generate a local keypair if none exists (needed for anchor test)
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  echo ""
  echo "Generating local Solana keypair (for local testing only)..."
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json"
fi

solana config set --url localhost > /dev/null 2>&1

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  anchor build        # Build the Anchor program"
echo "  anchor test         # Run tests on a local validator"
echo "  cp .env.example dfns/.env  # Configure Dfns credentials for devnet"
