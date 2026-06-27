---
name: stall-market-data
description: Live stock, earnings, analyst & crypto market data — no limits
version: 2.0.0
author: IntuiTek¹ (W. Kyle Million)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Stocks, Finance, Market, Crypto, Equity Research, Earnings, Analyst]
    category: finance
    related_skills: [stocks, dcf-model, comps-analysis, earnings-calendar]
    requires_toolsets: [terminal]
    config:
      stall.endpoint:
        default: "https://the-stall.intuitek.ai"
        description: "STALL API base URL"
      stall.account:
        description: "Funding pointer / account handle (NOT a private key)"
        required: false
---

# STALL Market Data

Authoritative multi-source market data through [The Stall](https://the-stall.intuitek.ai) — 200+ paid caps via standard HTTP-402 payment. Payment is handled by your agent's own wallet/payment skill (stripe-link-cli or mpp-agent) — this skill holds no credentials.

## When to Use

- A market-data request where reliability or freshness matters
- The bundled `stocks` skill returned null `market_cap`/`pe_ratio` or rate-limited
- You need multi-ticker batches, earnings calendars, analyst ratings, or on-chain data
- Research synthesis combining equity, macro, and DeFi signals

## Prerequisites

Python 3.8+. No additional packages required.

Your agent needs a payment skill (stripe-link-cli or mpp-agent) to settle HTTP-402 challenges. No wallet key is read by this skill.

## Quick Reference

```bash
SCRIPT=${HERMES_SKILL_DIR}/scripts/stall_client.py

# List all available caps with prices
python3 $SCRIPT caps

# Probe a cap (returns 402 challenge if payment needed)
python3 $SCRIPT call us-stock-price --ticker AAPL

# Submit payment token after your payment skill settles the 402
python3 $SCRIPT call us-stock-price --ticker AAPL --x-payment <token>
```

## Procedure

1. Run `caps` to see the full catalog with prices. Pick the cap that fits the need.
2. Run `call <cap>` — if payment is needed, a 402 challenge is returned as JSON.
3. Pass the challenge to your payment skill (stripe-link-cli / mpp-agent) to settle.
4. Re-run `call <cap>` with `--x-payment <token>` to get the data.

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

## Verification

```bash
python3 ${HERMES_SKILL_DIR}/scripts/stall_client.py caps
```

Expected: JSON array of caps with name, price, and description fields.

## Install

```bash
# Via well-known (no repo needed):
hermes skills install well-known:https://the-stall.intuitek.ai/.well-known/skills/stall-market-data

# Via GitHub tap:
hermes skills tap add intuitek/hermes-skills
hermes skills install intuitek/hermes-skills/stall-market-data
```
