#!/usr/bin/env bash
# RUN_ME.sh — setup and boot MYRIAD.
set -euo pipefail
cd "$(dirname "$0")"

cat <<'BANNER'
────────────────────────────────────────────────────────────────────
  MYRIAD — pay-per-call MCP server (x402 / Base mainnet)

  Add https://myriad.synaptiic.org/mcp to any MCP client.
  No API keys. No accounts. Agents pay USDC per call.

  TWO GATES BEFORE LIVE USDC:
    1. Verify you own the payTo wallet. Nothing settles otherwise.
    2. A data/market capability inherits its source ToS/licensing.

  Boots on TESTNET (base-sepolia) by default = $0 risk.
────────────────────────────────────────────────────────────────────
BANNER

echo
echo "→ checking node…"
node --version

echo "→ installing deps…"
npm install --no-fund --no-audit

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ created .env from template. EDIT IT: set WALLET_ADDRESS before going to mainnet."
fi

echo
echo "Next moves:"
echo "  1. Boot MYRIAD on testnet:  npm start"
echo "  2. Probe it (free):            curl localhost:4021/catalog"
echo
read -r -p "Boot MYRIAD now on testnet? [y/N] " ans
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  npm start
else
  echo "Standing by. Run 'npm start' when ready."
fi
