#!/usr/bin/env bash
# RUN_ME.sh — self-documents, then sets up and boots The Stall.
set -euo pipefail
cd "$(dirname "$0")"

cat <<'BANNER'
────────────────────────────────────────────────────────────────────
  THE STALL  +  PROSPECTOR  (v0.3)
  A domain-agnostic x402 capability chassis + the four-stream flow
  observer that decides what capability to put in it.

  THE STALL    a reusable paid endpoint in the agentic bazaar. Ships
               with one trivial probe (ping) so it boots and can take
               a first payment to get cataloged. The product slot is
               INTENTIONALLY EMPTY until PROSPECTOR signals fill it.

  PROSPECTOR   the discovery operator. Streams: bazaar (no auth),
               cloudflare (CF_API_TOKEN), dune (DUNE_API_KEY),
               x402scan (X402SCAN_API_URL). Analyses: growth, seam,
               convergence, concentration. See prospector/PROSPECTOR.md.

  TWO GATES BEFORE LIVE USDC:
    1. Verify you own the payTo wallet. Nothing settles otherwise.
    2. A data/market capability inherits its source's ToS/licensing.

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
echo "  1. Run the scout (Stream 3 works with no setup):  npm run scan"
echo "  2. Light up settlement-level signals:              add DUNE_API_KEY or X402SCAN_API_URL to .env"
echo "  3. Boot the stall on testnet:                      npm start"
echo "  4. Probe it (free):                                curl localhost:4021/catalog"
echo "  5. Read the operator doctrine:                     prospector/PROSPECTOR.md"
echo
read -r -p "Boot the stall now on testnet? [y/N] " ans
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  npm start
else
  echo "Standing by. Run 'npm start' when ready."
fi
