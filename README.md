# The Stall

**Live x402 capability chassis** — pay-per-call AI data services for USDC on Base mainnet.

[![Live](https://img.shields.io/badge/status-LIVE-brightgreen)](https://the-stall.intuitek.ai/health)
[![Network](https://img.shields.io/badge/network-Base%20mainnet-0052FF)](https://base.org)
[![Currency](https://img.shields.io/badge/payment-USDC%20%C2%B7%20x402-26A17B)](https://x402.org)
[![Provider](https://img.shields.io/badge/provider-IntuiTek%C2%B9-5A1AE5)](https://intuitek.ai)

> **Live endpoint:** `https://the-stall.intuitek.ai`
> **Agent card:** [`/.well-known/agent.json`](https://the-stall.intuitek.ai/.well-known/agent.json)
> **x402 discovery:** [`/.well-known/x402`](https://the-stall.intuitek.ai/.well-known/x402)
> **Catalog:** [`/catalog`](https://the-stall.intuitek.ai/catalog)

---

## Current capabilities

| Capability | Price | Description |
|---|---|---|
| `ping` | $0.001 | Liveness + echo probe. Confirms the x402 rail end-to-end. |
| `us-stock-price` | $0.030 | Current US equity price + intraday metrics (change %, volume, day high/low, 52-week range) for any NYSE/NASDAQ ticker. Live during market hours via Yahoo Finance. 31% below comparable market rate. |
| `concentration-risk-score` | $0.100 | HHI-based concentration-risk score for any x402 `pay_to` wallet. Returns unique payers, top-payer share, persistence, and a risk tier (LOW / MEDIUM / HIGH / CRITICAL). Use before building a workflow dependency on an external endpoint. |
| `market-intelligence` | $0.500 | Settlement-verified x402 endpoint intelligence. Shows which endpoints have genuine organic payer breadth — sourced from on-chain Base mainnet settlements, not just catalog listings. Filter by category, price range, min payers. |

### Quick call (x402 flow)

```bash
# 1. GET the endpoint — server returns HTTP 402 with payment challenge
curl https://the-stall.intuitek.ai/cap/us-stock-price?ticker=AAPL
# → 402 {"x402Version":"1","accepts":[{"network":"base","asset":"USDC","maxAmountRequired":"30000","paymentRequirements":{...}}]}

# 2. Pay in USDC on Base via the x402 facilitator
# 3. Retry the request with the X-PAYMENT header — server returns data
```

See the [x402 protocol spec](https://x402.org) for client SDKs (TypeScript, Python) that handle steps 2-3 automatically.

---

## Architecture

A domain-agnostic **x402 capability chassis** + a four-stream **[REDACTED]** (PROSPECTOR) that decides what capability to put in it. Built as the answer to one question:
*where is the way into the agentic economy that a solo operator can actually take, given that the giants now own the rail?*

### The architecture decision

The giants (Coinbase, Stripe, AWS, Visa, the x402 Foundation) own the **rail** —
settlement, wallets, the discovery index. That seat is taken; don't fight for it.
A marketplace owner needs **stalls filled** — their revenue is the rail toll,
not the merchandise. The endpoint layer is open *by design*: listing is free,
a service is auto-cataloged on first settled payment.

So this splits into two parts:

| | **The Stall** | **PROSPECTOR** |
|---|---|---|
| is | infra — a reusable paid endpoint | a persona + a [REDACTED] |
| owns | x402 wiring, payment, schemas | the doctrine + the archive |
| changes | almost never | every scan cycle |
| answers | "how does an agent pay me" | "what will an agent pay me for, where the seat is open" |

### [REDACTED]4 — what the [REDACTED] does

v0.4 retires catalog scanning as the primary scout (v0.1/v0.2 keyword counters
bottomed out — at 2k depth every bucket was contested, catalog is 40k+ anyway).
The seat doesn't live in the catalog; it lives in the **flows between endpoints**.

Five streams write into a SQLite archive (`archive.db`), four analyses read it:

| Stream | Auth | What it gives |
|---|---|---|
| `bazaar` | none | every Bazaar endpoint with first-seen/last-seen → new-endpoint feed |
| `base_rpc` | **none** | live x402 settlements from Base mainnet via public RPC — payer/recipient/amount per EIP-3009 event |
| `cloudflare` | `CF_API_TOKEN` | AI-bot traffic share by user-agent and AS → school identity |
| `dune` | `DUNE_API_KEY` + query IDs | SQL-side aggregation convenience over the same on-chain data (optional) |
| `x402scan` | `X402SCAN_API_URL` | settlement feed if x402scan publishes a public API (placeholder; none as of 2026-05) |

`base_rpc` removes the auth wall for settlement-level signal. Public Base RPC + the USDC contract's public `AuthorizationUsed` events cover every x402 settlement on Base with no credentials.

| Analysis | Hook | v0.4 status |
|---|---|---|
| `growth` | category emergence — list adjacent under convergence price | partial without history |
| `seam` | collapse a 2-3-endpoint chain, price at 70% of summed | unlocked by `base_rpc` |
| `convergence` | ship the narrow version agents converged on | unlocked by accruing `base_rpc` over time |
| `concentration` | better latency/price/schema, surfaced to the dependent cluster | (a) few-payers: unlocked; (b) cluster-dominant: gated |

First end-to-end run with `base_rpc`: 1,222 real settlements pulled in 2.6s, 4 honest concentration signals emitted including one 100%-strength dependency (106 settlements from 2 distinct wallets). All from public data, no auth.

### The archive thesis (the second timeline)

The same `archive.db` that drives near-term hook detection is also Schema #3
of a long-term thesis: **settlement + identity claim + mandate, joined**.
Litigators, regulators, and insurers will need this join; nobody else is
keeping it as a unified record right now. One build, two timelines.

---

## Layout

```
the-stall/
  RUN_ME.sh                  self-documenting setup + boot
  src/
    server.js                the chassis: loads caps, paywalls them, serves free /catalog
    payment.js               the ONLY file touching x402 wiring (isolated for protocol churn)
    registry.js              auto-loads + validates drop-in capability modules
  capabilities/
    _TEMPLATE.js             the contract: copy → fill → it goes live next deploy
    ping.js                  liveness probe
    us-stock-price.js        US equity price + intraday metrics (Yahoo Finance)
    concentration-risk-score.js  HHI-based payer concentration analysis
    market-intelligence.js   settlement-verified endpoint intelligence
```

## Quickstart (self-hosted)

```bash
./RUN_ME.sh           # installs, scaffolds .env, optionally boots on testnet
npm run scan          # PROSPECTOR scout: pulls streams, runs analyses, prints seat report
npm start             # boot the stall (base-sepolia by default = $0 risk)
curl localhost:4021/catalog
```

Stream 3 (Bazaar) runs every scout cycle with no setup. To unlock seam +
convergence + concentration signals, provision **either** Dune (free tier) **or** x402scan.

## Two gates before live USDC (if self-hosting)

1. **Wallet ownership.** `WALLET_ADDRESS` must be a verified-owned Base address.
2. **Source ToS / licensing.** Any data- or market-intelligence capability inherits the terms of its source.

## Deploy (Railway)

Standard Node service. Set env vars (`WALLET_ADDRESS`, `X402_NETWORK=base`,
`FACILITATOR_URL=<CDP facilitator>`, `PORT`), point at `npm start`. Keep the
`archive.db` volume persistent across deploys (it's the asset).

---

## Status

- [x] Chassis boots, loads capabilities, paywalls them, serves free introspection
- [x] [REDACTED]4 — five-stream [REDACTED] + SQLite archive + four analysis modules
- [x] `base_rpc` stream: no-auth on-chain settlement reader (Base public RPC)
- [x] Concentration (few-payers path) producing real signals from live mainnet
- [x] Wallet ownership verified (GATE 1) — Base mainnet, EIP-191 signature recovered
- [x] **4 capabilities LIVE** at `https://the-stall.intuitek.ai` (Base mainnet)
- [x] A2A Agent Card at `/.well-known/agent.json`
- [x] x402 discovery document at `/.well-known/x402`
- [x] Payment logging (JSONL) — every settled call recorded
- [ ] First settled call → auto-catalogs in x402 Bazaar
- [ ] PROSPECTOR scout wired to heartbeat cadence

---

*Built by [IntuiTek¹](https://intuitek.ai) — autonomous infrastructure for the agentic economy.*
