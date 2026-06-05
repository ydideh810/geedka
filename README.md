# The Stall + PROSPECTOR

A domain-agnostic **x402 capability chassis** + a four-stream **[REDACTED]**
that decides what capability to put in it. Built as the answer to one question:
*where is the way into the agentic economy that a solo operator can actually
take, given that the giants now own the rail?*

## The architecture decision

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

The Stall ships with **no product baked in** — only a `ping` probe so it boots
and can prove the rail. The function slot stays empty until PROSPECTOR proposes
a capability backed by signal in the archive.

## [REDACTED]4 — what the [REDACTED] does

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

`base_rpc` is the breakthrough that removes the auth wall for settlement-level
signal. Public Base RPC + the USDC contract's public `AuthorizationUsed` events
together cover every x402 settlement on Base with no credentials.

| Analysis | Hook | Needs | v0.4 status |
|---|---|---|---|
| `growth` | "the school just arrived" — list adjacent under convergence price | `bazaar` for category-level; `dune`/`base_rpc` for per-endpoint | partial without history |
| `seam` | **the seam hook** — collapse a 2-3-endpoint chain, price at 70% of summed | settlement-level data | unlocked by `base_rpc` |
| `convergence` | the funnel-narrow hook — ship the narrow version agents converged on | endpoint-level call counts over time | unlocked by `dune` or by accruing `base_rpc` over time |
| `concentration` | the hedge hook — better latency/price/schema, surfaced to the dependent cluster | (a) few-payers — works on raw `base_rpc` data; (b) cluster-dominant — needs cluster tagging | (a) unlocked; (b) gated |

First end-to-end run with `base_rpc`: 1,222 real settlements pulled in 2.6s,
4 honest concentration signals emitted including one 100%-strength dependency
(106 settlements from 2 distinct wallets). All from public data, no auth.

## The archive thesis (the second timeline)

The same `archive.db` that drives near-term hook detection is also Schema #3
of the long-term thesis: **settlement + identity claim + mandate, joined**.
Litigators, regulators, and insurers in 2027-2028 will need this join and
nobody else is keeping it as a unified record right now. Every settlement
row with `funding_source_cluster`, `framework_signature`, and `mandate_id`
populated is one row of the 2028 asset. One build, two timelines.

## Layout

```
the-stall/
  RUN_ME.sh                  self-documenting setup + boot
  src/
    server.js                the chassis: loads caps, paywalls them, serves free /catalog
    payment.js               ⚠ the ONLY file touching x402 wiring (isolated for protocol churn)
    registry.js              auto-loads + validates drop-in capability modules
  capabilities/
    _TEMPLATE.js             the contract: copy → fill → it goes live next deploy
    ping.js                  trivial probe (NOT the product)
  prospector/
    PROSPECTOR.md            v0.3 doctrine: streams, analyses, archive thesis, hook techniques
    scout.mjs                ★ orchestrator — `npm run scan`
    db/
      schema.sql             Schema #3-shaped: settlement + identity + mandate
      init.mjs               opens archive.db, applies schema
    streams/
      bazaar.mjs             Stream 3 — no auth, runs by default
      cloudflare.mjs         Stream 1 — env-gated by CF_API_TOKEN
      dune.mjs               Stream 2 — env-gated by DUNE_API_KEY
      x402scan.mjs           Stream 4 — env-gated by X402SCAN_API_URL
    analysis/
      growth.mjs             derivative shapes — hockey-stick / category emergence
      sequences.mjs          wallet call-chains → seam hook candidates
      convergence.mjs        funnel narrowing → narrow-hook candidates
      concentration.mjs      origin-destination ratios → hedge candidates
    legacy/
      prospector_scan_v0_2.mjs  preserved; `npm run scan:legacy`
```

## Quickstart

```bash
./RUN_ME.sh           # installs, scaffolds .env, optionally boots on testnet
npm run scan          # PROSPECTOR scout: pulls streams, runs analyses, prints seat report
npm start             # boot the stall (base-sepolia by default = $0 risk)
curl localhost:4021/catalog
```

Stream 3 (Bazaar) runs every scout cycle with no setup. To unlock seam +
convergence + concentration signals, provision **either** Dune (free tier:
get a key, fork `hashed_official/x402-analytics`, set `DUNE_API_KEY` and
the two `DUNE_QUERY_*` IDs) **or** x402scan (`X402SCAN_API_URL`).

## Two gates before live USDC

1. **Wallet ownership.** `WALLET_ADDRESS` must be a verified-owned Base address.
   Nothing settles to a wallet you don't control.
2. **Source ToS / licensing.** Any data- or market-intelligence capability
   inherits the terms of its source. PROSPECTOR flags this per capability spec.

## Deploy (Railway)

Standard Node service. Set env vars (`WALLET_ADDRESS`, `X402_NETWORK=base`,
`FACILITATOR_URL=<CDP facilitator>`, `PORT`), point at `npm start`. The scout
runs as a separate cron or `npm run scan` invocation; keep the `archive.db`
volume persistent across deploys (it's the asset).

## Status

- [x] Chassis boots, loads capabilities, paywalls them, serves free introspection
- [x] [REDACTED]4 — five-stream [REDACTED] + SQLite archive + four analysis modules
- [x] `base_rpc` stream: no-auth on-chain settlement reader (Base public RPC)
- [x] Concentration (few-payers path) producing real signals from live mainnet
- [x] Sequences self-loop bug fixed (require distinct resources in chain windows)
- [x] Dune SQL query templates in `prospector/dune_queries/`
- [x] Wallet ownership verified (GATE 1) — `0x03d773c5…584c` on Base mainnet, EIP-191 signature recovered, see `WALLET_VERIFIED.md`
- [ ] Scout wired to a heartbeat cadence (Aegis 10-min / Claude Code cron) — Kyle action
- [ ] First strong-strength signal → first capability spec → first settled call
