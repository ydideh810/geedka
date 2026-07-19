# MYRIAD Integrator Guide

**Building production agent workflows on MYRIAD**

MYRIAD is an x402 pay-per-call data chassis — agents probe endpoints, pay USDC on Base, receive structured JSON. No accounts, no subscriptions required. This guide covers three proven production workflow patterns.

---

## Pattern 1 — Earnings Intelligence Pipeline

**Use case:** Daily earnings research agent, pre-earnings positioning tool, EPS-surprise screener.

### Fastest path: earnings-intel-bundle

One call returns earnings dates, EPS beat/miss history, fundamental valuations, and FOMC context for any ticker at $0.08:

```
GET /cap/earnings-intel-bundle?ticker=AAPL
```

Returns: `earnings_calendar` + `earnings_surprises` + `fundamentals` + `fomc` in a single response.

### Full pipeline (individual caps)

For agents that need each layer independently or at different cadences:

| Step | Cap | Price | Params | Returns |
|------|-----|-------|--------|---------|
| 1 | [earnings-calendar](/cap/earnings-calendar) | $0.001 | `days_ahead=7` | Upcoming report dates + EPS estimates |
| 2 | [earnings-surprises](/cap/earnings-surprises) | $0.059 | `ticker=AAPL` | Beat/miss history, surprise %, trend |
| 3 | [equity-fundamentals](/cap/equity-fundamentals) | $0.059 | `ticker=AAPL` | P/E, EV/EBITDA, margins, FCF |
| 4 | [fomc-tracker](/cap/fomc-tracker) | $0.008 | none | Fed funds rate + next FOMC meeting |
| 5 | [equity-brief](/cap/equity-brief) | $0.350 | `ticker=AAPL` | AI-synthesized situation brief (optional) |

**Production pattern:** Call earnings-calendar daily to get the upcoming schedule. When a ticker approaches its report date, pre-fetch earnings-surprises + equity-fundamentals in parallel, then call equity-brief for the AI synthesis layer on the morning of the report.

---

## Pattern 2 — Market Monitor Agent

**Use case:** Portfolio risk monitor, sector rotation signal, daily market briefing pipeline.

| Cap | Price | Cadence | Signal |
|-----|-------|---------|--------|
| [stock-price-multi](/cap/stock-price-multi) | $0.001 | Every 15 min | Price + intraday change across N tickers |
| [crypto-top-movers](/cap/crypto-top-movers) | $0.001 | Hourly | Top gainers/losers across crypto markets |
| [fomc-tracker](/cap/fomc-tracker) | $0.008 | Daily | Fed rate + days until next FOMC decision |
| [sector-rotation](/cap/sector-rotation) | $0.059 | Daily | Relative sector strength (SPY vs sector ETFs) |
| [credit-spreads](/cap/credit-spreads) | $0.059 | Daily | Investment-grade and HY spread levels |
| [macro-brief](/cap/macro-brief) | varies | Weekly | Economic regime context |

**Production pattern:** Run stock-price-multi + crypto-top-movers on a polling interval. Run the macro context caps (fomc-tracker, sector-rotation, credit-spreads) once daily. Feed all outputs into a synthesis call (research-synthesis or equity-brief) to produce a daily briefing document.

---

## Pattern 3 — Research-Synthesis Chain

**Use case:** Autonomous research agent, due-diligence assistant, news-to-insight pipeline.

### Single-call synthesis

```
GET /cap/research-synthesis?query=S%26P+500+earnings+outlook+Q3+2026
```

Returns a structured intelligence report: executive summary, key findings, market implications, and source attribution — assembled from HN, OpenAlex, Reddit, arXiv, and DuckDuckGo in one $0.309 call.

Comparable research synthesis services charge $1.40+ per call. MYRIAD research-synthesis delivers comparable output at ~1/5th the cost.

### Enriched research pipeline

| Step | Cap | Purpose |
|------|-----|---------|
| 1 | [research-synthesis](/cap/research-synthesis) | Core intelligence report for any topic |
| 2 | [fact-check](/cap/fact-check) | Verify key claims from synthesis output |
| 3 | [web-change-monitor](/cap/web-change-monitor) | Track source URLs for subsequent changes |
| 4 | [arxiv-intel](/cap/arxiv-intel) | Deep technical paper search on a subtopic |

---

## x402 Integration

Every MYRIAD endpoint follows the x402 protocol:

1. Agent calls `GET /cap/<name>?param=value` — receives `402 Payment Required`
2. Response body contains `{ "x402Version": "1", "accepts": [{ "network": "base-mainnet", "asset": "USDC", "amount": "...", "payTo": "0x..." }] }`
3. Agent signs a payment via Coinbase CDP facilitator, sends `X-PAYMENT` header
4. Re-call with payment header — receives `200 OK` with JSON result

**No wallet?** Use prepaid credits instead:
- `POST /v1/fiat/checkout` with `{ "bundle": "starter" }` → Stripe checkout URL ($5 for 100 credits)
- `GET /v1/fiat/token?session_id=...` → Bearer token
- Call any cap with `Authorization: Bearer <token>` — no gas, no signing required

---

## Full Resources

- x402 manifest: `/`.well-known/x402`
- MCP endpoint: `/mcp` (streamable-http)
- SSE endpoint: `/sse`
- Full catalog: `/catalog`
- OpenAPI spec: `/openapi.json`
- Cap reference: `/llms.txt`

*Updated: 2026-07-03 | 278 caps | Base mainnet*
