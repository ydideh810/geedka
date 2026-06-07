# The Stall

**Live x402 capability chassis** — pay-per-call AI data services for USDC on Base mainnet.

[![Live](https://img.shields.io/badge/status-LIVE-brightgreen)](https://the-stall.intuitek.ai/health)
[![Network](https://img.shields.io/badge/network-Base%20mainnet-0052FF)](https://base.org)
[![Currency](https://img.shields.io/badge/payment-USDC%20%C2%B7%20x402-26A17B)](https://x402.org)
[![Provider](https://img.shields.io/badge/provider-IntuiTek%C2%B9-5A1AE5)](https://intuitek.ai)
[![thebrierfox/the-stall MCP server](https://glama.ai/mcp/servers/thebrierfox/the-stall/badges/score.svg)](https://glama.ai/mcp/servers/thebrierfox/the-stall)

> **Live endpoint:** `https://the-stall.intuitek.ai`
> **MCP endpoint:** [`/mcp`](https://the-stall.intuitek.ai/mcp) — streamable HTTP, use POST
> **Agent card:** [`/.well-known/agent.json`](https://the-stall.intuitek.ai/.well-known/agent.json)
> **x402 discovery:** [`/.well-known/x402`](https://the-stall.intuitek.ai/.well-known/x402)
> **Catalog:** [`/catalog`](https://the-stall.intuitek.ai/catalog)
> **MCP registry:** `ai.intuitek.the-stall/the-stall`

---

## Current capabilities — 172 live tools (v4.27.0)

Full catalog at `/catalog`. Each capability is behind a per-call x402 paywall — no API keys, no accounts, no monthly fees. Pay USDC on Base mainnet per call.

| Capability | Price | Description |
|---|---|---|
| `address-security` | $0.007 | Wallet/address security and reputation check |
| `agent-access-check` | $0.006 | Checks whether a website is accessible and agent-friendly |
| `agent-kya-score` | $0.003 | Know Your Agent (KYA) trust score for any EVM wallet |
| `ai-image-gen` | $0.080 | Generate an AI image from a text prompt using DALL-E 3 |
| `air-quality` | $0.002 | Real-time US AQI and pollutant readings for any lat/lon |
| `analyst-ratings` | $0.010 | Wall Street analyst consensus and price targets for any US equity |
| `base-season` | $0.003 | Base chain season snapshot: total chain TVL, top 10 protocols by Base-native TVL, category breakdown, 7d trend, and top Base ecosystem tokens by market cap |
| `block-intel` | $0.002 | Returns block header data (number, hash, timestamp, gas used/limit, base fee, tx count, validator address) for any block on Base, Ethereum, or Arbitrum |
| `breadcrumb-extractor` | $0.003 | Extracts structured breadcrumb navigation from a URL |
| `btc-game-theory` | $0.006 | Bitcoin mining game theory and systems dynamics in one call |
| `btc-miner-econ` | $0.005 | Bitcoin mining economics and fee-market game theory via mempool |
| `btc-systems-theory` | $0.008 | Seven-lens systems theory analysis of the Bitcoin network |
| `chain-pulse` | $0.006 | Returns an Ethereum block header + current stablecoin depeg status in one call |
| `chromatic-dispersion` | $0.004 | Fiber optic chromatic dispersion calculator |
| `citation-formatter` | $0.008 | Looks up an academic paper by DOI and formats it as BibTeX, APA, MLA, or Chicago citation |
| `city-lookup` | $0.010 | Search airports and cities by keyword, IATA code, or city name |
| `classic-novels` | $0.004 | Looks up classic and contemporary books by title, author, or ISBN via Open Library (748M+ editions) |
| `clinical-trials` | $0.005 | Search ClinicalTrials |
| `code-api-surface` | $0.10 | Analyzes a code snippet and returns its API surface: HTTP routes (method + path), exported symbols, and middleware |
| `code-test-detector` | $0.005 | Detects testing frameworks and test coverage presence in a code snippet or GitHub repository |
| `commodity-futures` | $0.010 | Returns live price and intraday metrics for major commodity futures: crude oil, natural gas, gold, silver, copper, platinum, wheat, corn, soybeans, and coffee |
| `company-due-diligence` | $0.007 | AI-agent due diligence on any company |
| `company-intel` | $0.012 | Returns SEC EDGAR due diligence data for any US public company by ticker symbol: legal name, CIK, SIC industry code and description, state of incorpor |
| `concentration-risk-score` | $0.10 | Returns a concentration-risk score for an x402 pay_to wallet: HHI, unique payer count, top-payer share, persistence across scans, and a risk tier (LOW / MEDIUM / HIGH / CRITICAL) |
| `congressional-trades` | $0.022 | US Congressional stock trades (STOCK Act disclosures) |
| `consumer-brief` | $0.350 | AI-synthesized US consumer health briefing |
| `country-info` | $0.002 | Country information lookup by name, ISO code (alpha-2 or alpha-3), or capital city |
| `credit-spreads` | $0.008 | Returns current US corporate credit spreads from ICE BofA indices via FRED (free, no API key): High Yield OAS, Investment Grade OAS, and BBB (lowest IG tier) OAS |
| `crypto-fear-greed` | $0.005 | Crypto Fear & Greed Index — current score (0=extreme fear, 100=extreme greed), 7-day trend, 30-day min/max/avg, and trading regime signal |
| `crypto-fiat-price` | $0.015 | Cryptocurrency price in any fiat currency — JPY, EUR, CNY, GBP, KRW, INR, AUD, BRL, or 80+ more |
| `crypto-news-impact` | $0.008 | Latest cryptocurrency news headlines from CoinDesk with live price correlation for mentioned assets |
| `crypto-pulse` | $0.007 | Crypto market pulse — latest Ethereum (or Base) block context plus top crypto gainers and losers by 24h change, in a single call |
| `crypto-top-movers` | $0.008 | Real-time cryptocurrency market snapshot: top 5 gainers and top 5 losers by 24-hour percentage change (among the top 100 coins by market cap), plus th |
| `db-perf-intel` | $0.003 | Database performance intelligence: current versions, EOL status, and benchmark-grounded performance profiles for PostgreSQL, MySQL, MariaDB, MongoDB, |
| `defi-market-pulse` | $0.006 | Combined DeFi yield intelligence and market momentum in one call — 33% cheaper than separate yield-farming-active + market-movers calls ($0 |
| `defi-portfolio` | $0.007 | Multi-chain DeFi portfolio scanner |
| `defi-state-pack` | $0.008 | Returns Ethereum block header + stablecoin depeg status + top DeFi yield farming pools in one call |
| `defi-yields` | $0.025 | Returns top DeFi yield pools ranked by APY from DeFiLlama |
| `dex-pair-search` | $0.005 | Search DEX trading pairs for any token (by symbol, name, or contract address) across 50+ chains including Ethereum, Solana, Base, BSC, Arbitrum, Polygon, and Avalanche |
| `dex-swap-quote` | $0.012 | Best-route DEX swap quote across 20+ chains via Li |
| `dex-trending-pools` | $0.015 | Trending DEX liquidity pools with buy/sell pressure data across multiple timeframes (5m, 1h, 6h, 24h) |
| `dividend-calendar` | $0.008 | Upcoming dividend ex-dates from NASDAQ — all stocks going ex-dividend on a given date (default: today) or in the next 1–7 days |
| `dividend-intel` | $0.015 | Full dividend intelligence for any US equity: trailing 12-month yield, forward annual rate, payout frequency (monthly/quarterly/semi-annual/annual), 5 |
| `dns-lookup` | $0.003 | DNS record lookup for any domain via Cloudflare DoH |
| `document-qa-prep` | $0.005 | Prepares a document for question-answering and RAG pipelines |
| `domain-whois` | $0.006 | Domain WHOIS/RDAP lookup |
| `drug-intel` | $0.008 | FDA drug intelligence: labeling (warnings, dosage, drug interactions, contraindications, indications), adverse event report summary (top reactions + total count), and recent recall history |
| `earnings-calendar` | $0.005 | Upcoming US stock earnings — report date, EPS estimate, pre/post-market timing |
| `earnings-surprises` | $0.010 | Historical EPS beat/miss data for any US equity: actual EPS, consensus estimate, surprise %, beat rate, estimate revisions (30-day EPS drift), and next earnings date |
| `earthquake-intel` | $0.005 | Real-time earthquake intelligence from USGS |
| `economic-calendar` | $0.010 | Upcoming US macro data release schedule: CPI, NFP, FOMC, GDP, PCE, PPI, JOLTS, Retail Sales, Housing Starts, and 20+ more releases with exact dates, times (ET), and market-impact priority |
| `email-verify` | $0.006 | Email address validation and quality scoring |
| `energy-brief` | $0.350 | AI-synthesized US energy market situation briefing |
| `ens-lookup` | $0.004 | ENS name ↔ Ethereum address resolution |
| `equity-brief` | $0.350 | AI-synthesized equity situation brief for any US stock |
| `equity-fundamentals` | $0.015 | Fundamental valuation metrics for any US public company — P/E TTM, forward P/E, PEG, P/B, EV/EBITDA, margins, ROE, ROA, revenue TTM, earnings/revenue growth, free cash flow, market cap, beta |
| `equity-sentiment` | $0.015 | Equity market Fear & Greed composite |
| `equity-technicals` | $0.49 | Returns a complete technical analysis package for any US stock: RSI(14) with oversold/overbought signal, MACD(12/26/9) with histogram, Bollinger Bands |
| `erc20-snapshot` | $0.007 | Complete ERC20 token state in one call: name, symbol, decimals, total supply (raw + formatted), wallet balance, and allowance |
| `etf-holdings` | $0.018 | Top holdings, sector weights, and asset allocation for any US ETF (SPY, VOO, QQQ, AGG, XLK, etc |
| `eth-block` | $0.002 | Returns an Ethereum block header and transaction hashes by block number, hex string, or tag (latest/pending/earliest/safe/finalized) |
| `evm-log-events` | $0.004 | Query EVM contract event logs via eth_getLogs |
| `evm-nonce` | $0.002 | Returns the current nonce (confirmed transaction count) and pending nonce for any EVM wallet address |
| `evm-token-security` | $0.007 | Honeypot, rug-pull, and scam detection for any EVM token |
| `fact-check` | $0.500 | AI-powered claim verification |
| `fda-recall-watch` | $0.008 | FDA recall and enforcement search across drugs, food/cosmetics, and medical devices (85,000+ actions) |
| `fec-donor-intel` | $0.008 | FEC campaign finance lookup — search all US federal political donations by individual or organization name |
| `federal-contract-intel` | $0.008 | US federal contract and grant intelligence for any company via USASpending |
| `flight-tracker` | $0.008 | Recent departures or arrivals at any major airport via OpenSky Network (free, crowd-sourced ADS-B) |
| `fomc-tracker` | $0.008 | US Federal Funds Rate, next FOMC meeting date + countdown, rate trend (hiking/holding/cutting), and full 2026 schedule |
| `forex-rates` | $0.005 | Real-time fiat foreign exchange rates |
| `funding-rates` | $0.020 | Returns current perpetual funding rates for 200+ assets on Hyperliquid DEX, sorted by absolute funding magnitude |
| `gas-estimate` | $0.003 | Multi-chain gas price oracle: fast/standard/slow Gwei + USD cost for a transfer |
| `gas-prices` | $0.005 | Current gas prices and EIP-1559 fee recommendations across 6 major EVM chains: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain |
| `generate-meme` | $0.005 | Generates a meme image from 211 built-in templates |
| `geocode` | $0.003 | Forward and reverse geocoding via OpenStreetMap Nominatim |
| `github-repo-intel` | $0.010 | GitHub repository intelligence: stars, forks, open issues, language, license, last push date, latest release version and date, topics, and whether the repo is actively maintained |
| `global-equity-indices` | $0.010 | Global equity snapshot: 9 major indices (Nikkei 225, Hang Seng, ASX 200, Nifty 50, Shanghai, FTSE 100, DAX, CAC 40, Euro Stoxx 50) plus DXY |
| `gov-votes` | $0.004 | US Congressional vote records from official government XML sources (senate |
| `hedge-fund-holdings` | $0.025 | Returns top stock holdings from any institution's latest SEC 13F filing |
| `hf-model-search` | $0.002 | Search HuggingFace Hub for ML models |
| `hn-search` | $0.010 | Hacker News story and comment search via Algolia |
| `housing-brief` | $0.350 | AI-synthesized US housing market briefing |
| `http-headers` | $0.003 | HTTP response headers inspector and security grader |
| `image-detect` | $0.040 | Detects the true image format of any URL via magic byte inspection — works even when the file extension or Content-Type header lies (common with proxied or CDN-hosted images) |
| `imf-country-outlook` | $0.006 | IMF World Economic Outlook forecasts — current year + 3-year horizon for 180+ countries |
| `insider-trades` | $0.012 | Recent SEC Form 4 insider trading activity for any US public company |
| `intel-pack` | $0.15 | Three-source intelligence pack in one x402 call: equity market snapshot (SPY/QQQ/IWM/VIX/risk signal) + top DeFi yield pools by APY + top prediction markets by volume |
| `ip-intel` | $0.003 | Geolocation and network intelligence for IP addresses or domain names |
| `ipo-calendar` | $0.020 | Returns live IPO calendar from Nasdaq — upcoming deals with expected pricing dates, recently priced offerings, new S-1 filings, and withdrawn deals |
| `job-search` | $1.500 | Search remote and hybrid job listings by keyword and location |
| `json-extract` | $0.004 | Extracts and parses JSON from mixed-content text |
| `kimchi-premium` | $0.001 | Real-time Kimchi Premium for any Upbit-listed token: KRW price on Upbit vs USD price on global exchange (Kraken/OKX), FX-adjusted |
| `korean-crypto-movers` | $0.008 | Top movers and volume leaders on Korean exchanges (Upbit, 263 KRW markets) |
| `korean-market-movers` | $0.010 | Real-time movers and volume-spike leaders across all KRW-denominated markets on Upbit (South Korea's largest crypto exchange) |
| `labor-brief` | $0.350 | AI-synthesized US labor market briefing |
| `labor-market` | $0.008 | Returns US labor market leading indicators from FRED (free, no API key): initial jobless claims (weekly), continued claims, JOLTS job openings, nonfar |
| `lbo-model` | $4.50 | Full LBO model: sources & uses, year-by-year operating model, debt schedule with cash sweep, IRR and MOIC, plus 3×3 entry/exit sensitivity tables |
| `legal-search` | $0.008 | Searches 5M+ US court opinions (SCOTUS, federal circuits, district courts, state courts) via CourtListener |
| `limitless-markets` | $0.006 | Returns active prediction markets from Limitless Exchange with current Yes/No probabilities |
| `macro-brief` | $0.350 | AI-synthesized US macroeconomic situation briefing |
| `macro-indicators` | $0.008 | Returns current US macroeconomic indicators: Fed Funds Rate, CPI (with year-over-year inflation %), Unemployment Rate, and Real GDP |
| `manufacturing-brief` | $0.350 | AI-synthesized US manufacturing & industrial sector briefing |
| `market-intelligence` | $0.50 | Returns settlement-verified x402 endpoint intelligence |
| `market-movers` | $0.004 | Today's top market movers — equity gainers, losers, most-active, and crypto gainers/losers by 24h change |
| `market-overview` | $0.10 | Single-call market snapshot: SPY, QQQ, IWM, and DIA price + intraday % change, VIX fear gauge, 10-year Treasury yield (^TNX), and a derived risk-postu |
| `market-sentiment` | $0.015 | Combined crypto market sentiment signal: Crypto Fear & Greed Index (alternative |
| `meme-generator` | $0.005 | Generate a meme image URL from text |
| `news-sentiment` | $0.004 | Returns global news coverage and sentiment for any company, stock ticker, or topic |
| `nft-metadata` | $0.002 | Fetch NFT metadata, traits, image URL, and collection floor price for any ERC-721 or ERC-1155 token |
| `npi-lookup` | $0.004 | US NPI registry lookup — find any licensed US healthcare provider or organization by NPI number, name, state, or specialty |
| `npm-lookup` | $0.007 | Node |
| `options-chain` | $0.010 | CBOE delayed options chain for any US equity or index — returns stock price, per-contract IV, greeks (delta/gamma/theta/vega), OI, volume, and bid/ask |
| `options-snapshot` | $0.015 | Options intelligence snapshot for any US equity — IV30, put/call volume ratio, top calls and puts by trading volume, and unusual-volume flags |
| `page-intel` | $0.004 | Extracts structured content from any public URL: page title, meta description, H1-H3 headings, all links (with text and internal/external flag), and a 500-character text preview |
| `page-links` | $0.004 | Extracts all hyperlinks from a webpage |
| `ping` | $0.001 | Liveness + echo probe |
| `place-details` | $0.020 | Enriched place and business details by name (OSM Nominatim) |
| `policy-impact-mapper` | $0.007 | Analyzes regulatory and policy text to map its impact across industry sectors |
| `polymarket-accuracy-score` | $0.004 | Historical Polymarket crowd accuracy score: % of markets where the final crowd majority correctly predicted the outcome, plus Brier score (calibration quality) |
| `polymarket-category-performance` | $0.004 | Polymarket category activity breakdown: volume, liquidity, market count, and top market per category (crypto, politics, sports, ai, macro, equities) |
| `polymarket-sentiment-shift` | $0.008 | Returns Polymarket prediction markets with the biggest recent probability shifts — useful for detecting sudden consensus changes on elections, crypto prices, and macro outcomes |
| `portfolio-rebalance` | $0.005 | Pure-math portfolio rebalancing calculator |
| `prediction-markets` | $0.05 | Returns top active Polymarket prediction markets sorted by trading volume |
| `prediction-stock-pulse` | $0.016 | One call returns prediction market sentiment (Limitless Exchange) + live equity price for a specified ticker |
| `protocol-revenue-leaders` | $0.001 | Returns DeFi protocols ranked by daily fees (revenue generated) |
| `pypi-lookup` | $0.007 | Python package metadata from PyPI |
| `readable-content` | $0.004 | Fetches any public URL and returns the full readable article text as clean Markdown, stripped of navigation, ads, and boilerplate |
| `reddit-intel` | $0.012 | Searches Reddit posts and/or comments by keyword |
| `regex-tester` | $0.003 | Safe regex testing and extraction |
| `research-paper-search` | $0.003 | Academic paper search across 250M+ works via OpenAlex (free, no key) |
| `research-synthesis` | $0.200 | AI-synthesized intelligence report for any query — aggregates Hacker News, OpenAlex academic papers, Reddit, arXiv preprints, and DuckDuckGo in parall |
| `roast` | $0.040 | Witty AI roast of any target — person, company, product, code snippet, or concept |
| `rss-reader` | $0.004 | Fetches and parses any public RSS 2 |
| `sanctions-screening` | $0.005 | OFAC SDN sanctions screening — checks whether a person, company, vessel, or aircraft appears on the US Treasury Specially Designated Nationals list |
| `sec-filing-intel` | $0.015 | Real-time SEC EDGAR filing lookup by ticker or CIK |
| `sec-insider-trades` | $0.008 | SEC EDGAR Form 4 insider trading data for any US public company — shows recent insider buys, sells, awards, and exercises with shares, price, and post-transaction ownership |
| `sector-rotation` | $0.020 | S&P 500 sector rotation: relative performance of all 11 GICS sectors (XLK XLF XLE XLV XLI XLY XLP XLB XLRE XLU XLC) vs SPY benchmark |
| `short-volume-intel` | $0.012 | Daily FINRA consolidated short-sale volume for any US equity ticker: short volume, total volume, and short ratio (short/total) for the last N trading days |
| `social-intel` | $0.004 | Returns public profile data for any social platform account |
| `solana-token-risk` | $0.35 | Rug-pull and risk scanner for Solana SPL tokens |
| `solana-tx-explainer` | $0.07 | Given a Solana transaction signature, returns a decoded breakdown: fee payer, programs invoked (Jupiter, Raydium, Pump.fun, SPL Token, etc.), SPL toke |
| `solar-intel` | $0.020 | Solar irradiance analysis and 7-day forecast for any location |
| `sports-prediction` | $0.005 | Returns today's (or a given date's) sports games with team win-loss records, venue, scheduled time, and live score |
| `sports-scores` | $0.004 | Live and recent sports scores for NBA, NFL, MLB, NHL, MLS, EPL, La Liga, Bundesliga, Serie A, Champions League, and more |
| `ssl-cert` | $0.004 | Inspects the TLS/SSL certificate of any HTTPS host |
| `stablecoin-watch` | $0.05 | Real-time depeg monitor for top USD stablecoins (USDT, USDC, DAI, USDS, and others ranked by market cap) |
| `stock-brief` | $0.015 | US equity snapshot + Limitless prediction market sentiment in one call |
| `stock-ohlcv` | $0.010 | Returns historical OHLCV (open/high/low/close/volume) candlestick data for a stock, ETF, or index |
| `stock-price-multi` | $0.018 | Returns current US equity prices for up to 5 tickers in one call — STRC, AMD, MSTR, SLV, USO, or any NYSE/NASDAQ symbol |
| `strategy-signal` | $0.090 | Technical analysis signal for any US equity, ETF, or crypto |
| `timezone` | $0.002 | Timezone intelligence using the IANA database (418 zones) built into Node |
| `token-top-holders` | $0.015 | Returns top holders for any Ethereum ERC-20 token (by contract address), with concentration metrics |
| `treasury-auction-calendar` | $0.018 | Returns upcoming US Treasury auction schedule (Bills, Notes, Bonds, TIPS, FRNs) from TreasuryDirect |
| `treasury-yields` | $0.008 | Returns current US Treasury yield curve at 3M, 5Y, 10Y, and 30Y nodes from CBOE interest-rate indices (free, no API key) |
| `tx-explainer` | $0.014 | Given a transaction hash and chain, returns a decoded breakdown: sender, recipient, ETH value transferred, gas used, transaction fee, decoded method n |
| `tx-intel` | $0.006 | Decode and explain any EVM transaction — in one x402 payment |
| `unit-converter` | $0.002 | Converts between 100+ units across 12 categories: length, weight, temperature, volume, speed, area, energy, pressure, data, time, angle, frequency |
| `us-stock-price` | $0.018 | Returns current US equity price and intraday metrics (change %, volume, day high/low, 52-week range) for any NYSE/NASDAQ ticker |
| `usgs-earthquake` | $0.002 | Real-time global earthquake events from USGS |
| `wallet-balance` | $0.002 | Returns the native token balance (ETH, POL, BNB) for any EVM wallet address |
| `wallet-credit-score` | $0.020 | Composite credit score (0–100) for any EVM wallet |
| `wallet-screener` | $0.010 | Risk screening for EVM wallet addresses |
| `weather` | $0.007 | Current weather conditions and 7-day daily forecast for any location worldwide |
| `weather-alerts` | $0.003 | Active NOAA weather alerts for any US state — tornado warnings, flash flood watches, hurricane warnings, blizzard advisories, heat alerts, and 80+ other NWS event types |
| `web-change-monitor` | $0.005 | Returns content-change signals for any public URL: ETag, Last-Modified, Content-Length, and Content-Type via HTTP HEAD |
| `web-company-intel` | $0.003 | Extract structured company intelligence from any public website |
| `web-scrape-links` | $0.004 | Extracts all hyperlinks from any public webpage |
| `whale-radar` | $0.003 | Polymarket whale intelligence for a given proxy wallet address |
| `world-bank-data` | $0.003 | World Bank open data — 1600+ development indicators for 200+ countries |
| `x402-endpoint-intel` | $0.020 | Market intelligence for any x402 endpoint or operator wallet |
| `yield-farming-active` | $0.005 | Returns active DeFi yield farming pools sorted by 30-day average APY |

### Quick call (x402 flow)

```bash
# 1. GET the endpoint — server returns HTTP 402 with payment challenge
curl https://the-stall.intuitek.ai/cap/us-stock-price?ticker=AAPL
# → 402 {"x402Version":"1","accepts":[{"network":"base","asset":"USDC","maxAmountRequired":"30000","paymentRequirements":{...}}]}

# 2. Pay in USDC on Base via the x402 facilitator
# 3. Retry the request with the X-PAYMENT header — server returns data
```

See the [x402 protocol spec](https://x402.org) for client SDKs (TypeScript, Python) that handle steps 2-3 automatically.

### MCP (streamable HTTP)

```json
{
  "mcpServers": {
    "the-stall": {
      "type": "streamable-http",
      "url": "https://the-stall.intuitek.ai/mcp"
    }
  }
}
```

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
    defi-portfolio.js        multi-chain wallet scanner (ETH/Base/Polygon/Arb)
    ... 168 more capability modules (see /catalog)
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
- [x] **172 capabilities LIVE** at `https://the-stall.intuitek.ai` (Base mainnet, v4.27.0)
- [x] MCP endpoint at `/mcp` (streamable-http, accepts `application/json`)
- [x] A2A Agent Card at `/.well-known/agent.json`
- [x] x402 discovery document at `/.well-known/x402`
- [x] Official MCP registry: `ai.intuitek.the-stall/the-stall`
- [x] Payment logging (JSONL) — every settled call recorded
- [x] First settled call → x402 Bazaar seeded (block 46944973, Base mainnet, 2026-06-05)
- [x] PROSPECTOR scout wired to heartbeat cadence (v0.4, 3.7M+ settlements archived)
- [x] Listed on [Glama](https://glama.ai/mcp/servers/thebrierfox/the-stall)

---

*Built by [IntuiTek¹](https://intuitek.ai) — autonomous infrastructure for the agentic economy.*
