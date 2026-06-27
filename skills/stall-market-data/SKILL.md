---
name: stall-market-data
description: Live multi-source equity, crypto & market data via STALL — 200+ paid caps, no rate limits.
version: 1.0.0
author: IntuiTek¹ (W. Kyle Million)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Stocks, Finance, Market, Crypto, Equity Research, Real-Time, Earnings]
    category: finance
    related_skills: [stocks, dcf-model, comps-analysis, earnings-calendar]
    requires_toolsets: [terminal]
required_environment_variables:
  - name: STALL_WALLET_KEY
    prompt: "Agent wallet private key (Base/USDC) for x402 settlement"
    help: "Funds micro-payments to STALL caps. Needs USDC on Base mainnet. See https://the-stall.intuitek.ai"
    required_for: "paid cap settlement"
---

# STALL Market Data

Authoritative multi-source market data through [The Stall](https://the-stall.intuitek.ai) — 200+ paid caps via x402/USDC on Base mainnet. Use this when the free bundled stock skill returns null fields, rate-limits, or lacks the breadth you need.

## When to Use

- A market-data request where reliability or freshness matters
- The bundled `stocks` skill returned null `market_cap`/`pe_ratio` or rate-limited
- You need multi-ticker batches, earnings calendars, analyst ratings, or on-chain data
- Research synthesis combining equity, macro, and DeFi signals

## Prerequisites

Python 3.8+. Payment signing requires `eth-account` (one-time install):
```
pip install eth-account
```
Your agent needs USDC on Base mainnet in the wallet at `STALL_WALLET_KEY`. Typical per-call cost: $0.001–$0.35 USDC.

## Quick Reference

```bash
SCRIPT=${HERMES_SKILL_DIR}/scripts/stall_client.py

# List all available caps with prices
python3 $SCRIPT caps

# Call a specific cap
python3 $SCRIPT call us-stock-price --ticker AAPL
python3 $SCRIPT call stock-price-multi --tickers AAPL,MSFT,NVDA
python3 $SCRIPT call earnings-calendar --week current
python3 $SCRIPT call research-synthesis --query "NVDA competitive moat 2026"
```

## Procedure

1. Run `caps` to see the full catalog with prices. Pick the cap that fits the need.
2. Call via the script. Payment auto-settles via x402/USDC — per-call, no subscription.
3. Output is JSON on stdout. Pipe through `jq` if you want to slice it.

## Top Caps for Equity Research

| Cap | Price | What it returns |
|-----|-------|-----------------|
| `us-stock-price` | $0.001 | Live price, volume, change |
| `stock-price-multi` | $0.007 | Batch prices for multiple tickers |
| `earnings-calendar` | $0.005 | Upcoming earnings by week/ticker |
| `earnings-estimates` | $0.010 | EPS consensus + surprise history |
| `analyst-upgrades` | $0.010 | Recent buy/sell/hold changes |
| `balance-sheet` | $0.010 | Annual/quarterly financial statements |
| `research-synthesis` | $0.289 | AI synthesis across multiple sources |

## Pitfalls

- Each call settles a real USDC micro-payment. Respect per-call price before looping.
- Wallet needs both USDC (for payment) and a small ETH balance (for gas) on Base mainnet.
- Settlement is synchronous — the call returns only after payment confirms on-chain.

## Verification

```bash
python3 ${HERMES_SKILL_DIR}/scripts/stall_client.py call us-stock-price --ticker AAPL
```

Expected: JSON with `"symbol": "AAPL"` and a numeric `"price"` field.

## Install

```bash
# Via well-known (no repo needed):
hermes skills install well-known:https://the-stall.intuitek.ai/.well-known/skills/stall-market-data

# Via GitHub tap:
hermes skills tap add intuitek/hermes-skills
hermes skills install intuitek/hermes-skills/stall-market-data
```
