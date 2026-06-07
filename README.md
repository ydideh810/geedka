# The Stall

**Live x402 capability chassis** — pay-per-call AI data services for USDC on Base mainnet.

[![Live](https://img.shields.io/badge/status-LIVE-brightgreen)](https://the-stall.intuitek.ai/health)
[![Network](https://img.shields.io/badge/network-Base%20mainnet-0052FF)](https://base.org)
[![Currency](https://img.shields.io/badge/payment-USDC%20%C2%B7%20x402-26A17B)](https://x402.org)
[![Provider](https://img.shields.io/badge/provider-IntuiTek%C2%B9-5A1AE5)](https://intuitek.ai)
[![thebrierfox/the-stall MCP server](https://glama.ai/mcp/servers/thebrierfox/the-stall/badges/score.svg)](https://glama.ai/mcp/servers/thebrierfox/the-stall)

> **Live endpoint:** `https://the-stall.intuitek.ai`
> **Agent card:** [`/.well-known/agent.json`](https://the-stall.intuitek.ai/.well-known/agent.json)
> **x402 discovery:** [`/.well-known/x402`](https://the-stall.intuitek.ai/.well-known/x402)
> **Catalog:** [`/catalog`](https://the-stall.intuitek.ai/catalog)

---

## Current capabilities — 135 live tools (v3.94.0)

Full catalog at `/catalog`. Each capability is behind a per-call x402 paywall — no API keys, no accounts, no monthly fees. Pay USDC on Base mainnet per call.

| Capability | Price | Description |
|---|---|---|
| `agent-access-check` | $0.006 | Checks whether a website is accessible and agent-friendly. Fetches robots.txt, /.well-known/x402, and /.well-known/agent.json. |
| `ai-image-gen` | $0.080 | Generate an AI image from a text prompt using DALL-E 3. Returns a public URL (valid 1h), revised prompt, and generation metadata. Supports vivid/natural style and three aspect ratios. 20% below nearest x402 competitor. |
| `base-season` | $0.003 | Base chain season snapshot: total chain TVL, top 10 protocols by Base-native TVL, and trending tokens. |
| `block-intel` | $0.002 | Block header data (number, hash, timestamp, gas used/limit, base fee, tx count) for Ethereum, Base, Polygon, Arbitrum. |
| `breadcrumb-extractor` | $0.003 | Extracts structured breadcrumb navigation from a URL. Returns domain, ordered path segments, titles. |
| `btc-game-theory` | $0.006 | Bitcoin mining game theory: selfish-mining threshold, 51% attack cost, fee-sniper window, difficulty adjustment. |
| `btc-miner-econ` | $0.005 | Bitcoin mining economics via mempool.space: current hashrate, difficulty, block subsidy, fee rate percentiles. |
| `btc-systems-theory` | $0.008 | Seven-lens systems-theory analysis of the Bitcoin network: difficulty, fee market, hash distribution, UTXO set, and more. |
| `chromatic-dispersion` | $0.004 | Fiber optic chromatic dispersion calculator. Computes D(λ), pulse broadening, and maximum uncompensated link length. |
| `citation-formatter` | $0.008 | Looks up a paper by DOI and formats it as BibTeX, APA, MLA, or Chicago. |
| `city-lookup` | $0.010 | Search for cities and airports by keyword, IATA/ICAO code, or name. Optional country filter. Returns IATA, ICAO, city name, country, coordinates, timezone. |
| `classic-novels` | $0.004 | Book lookup by title, author, or ISBN via Open Library. Returns metadata, subjects, and first-sentence excerpt. |
| `drug-intel` | $0.008 | FDA drug safety intelligence: labeling (warnings, dosage, interactions, contraindications), adverse event summary (top FAERS reactions + total report count), and recall history. Brand or generic name. openFDA free API. |
| `clinical-trials` | $0.008 | Search active and completed clinical trials from ClinicalTrials.gov. Filter by condition, intervention, phase, status. |
| `code-api-surface` | $0.100 | Static analysis of any code snippet: HTTP routes (method + path + middleware), exported symbols. Supports Express, FastAPI, Flask, Spring Boot, NestJS, Gin. |
| `code-test-detector` | $0.005 | Detects testing frameworks and test coverage presence in a code snippet or GitHub file URL. |
| `commodity-futures` | $0.010 | Live price and intraday metrics for crude oil, gold, natural gas, wheat, copper, and silver front-month futures. |
| `company-intel` | $0.012 | SEC EDGAR due diligence data for any US public company: filings, financials, executives, SIC classification. |
| `concentration-risk-score` | $0.100 | HHI-based concentration-risk score for any x402 pay_to wallet. Returns unique payers, top-payer share, risk tier. |
| `country-info` | $0.002 | Country information by name, ISO code, or capital city: population, area, region, currencies, languages. |
| `credit-spreads` | $0.008 | Current US corporate credit spreads: High Yield OAS, Investment Grade OAS, and BBB OAS from ICE BofA indices via FRED (free, no API key). Includes HY-IG differential and risk regime classification (tight/normal/wide/stress). Pairs with treasury-yields for full fixed-income discount rate construction. |
| `crypto-fiat-price` | $0.015 | Cryptocurrency price in any fiat currency — JPY, EUR, CNY, GBP, KRW, INR, AUD, BRL, or 80+ more. Input a coin (bitcoin, eth, sol) and one or more currency codes. Includes 24h % change. 85% below specialized oracles. |
| `crypto-news-impact` | $0.008 | Latest cryptocurrency news headlines from CoinDesk with live price correlation for mentioned assets. |
| `crypto-top-movers` | $0.008 | Real-time cryptocurrency market snapshot: top 5 gainers and losers by 24-hour performance from CoinGecko. |
| `db-perf-intel` | $0.003 | Database version, EOL status, and benchmark-grade performance characteristics for 12+ database engines. |
| `defi-portfolio` | $0.007 | Multi-chain DeFi portfolio scanner: token holdings + USD values across Ethereum, Base, Polygon, Arbitrum. Free upstream: DRPC public RPCs + CoinGecko. |
| `defi-market-pulse` | $0.006 | Combined DeFi yields + market movers + cross-signal correlation in one call. Flags 'boosted' pools (APY + rising token) vs 'at_risk' pools (APY + sell-off). 33% cheaper than separate calls. |
| `defi-state-pack` | $0.008 | Ethereum block header + stablecoin depeg status + top DeFi yield pools in one call. Collapses 3-hop eth-block → stablecoin-watch → yield-farming chain. All upstreams fetched in parallel. Filter pools by chain, protocol, min TVL, min APY. |
| `defi-yields` | $0.025 | Top DeFi yield pools ranked by APY from DeFiLlama. Covers 16,000+ pools across 80+ chains. |
| `dex-pair-search` | $0.005 | Search DEX trading pairs for any token (symbol, name, or contract address) across 50+ chains. Returns price, 24h volume, buy/sell pressure, liquidity, and FDV per pair via DexScreener. |
| `dex-trending-pools` | $0.015 | Trending DEX liquidity pools with buy/sell pressure data across multiple timeframes from GeckoTerminal. |
| `dividend-intel` | $0.015 | Full dividend intelligence for any US equity: trailing 12-month yield, forward annual rate, payout frequency, 5-year CAGR, consecutive years paid/growth, and complete 5-year dividend history. Yahoo Finance chart API, no API key. |
| `dns-lookup` | $0.003 | DNS record lookup via Cloudflare DoH. Supports A, AAAA, MX, TXT, NS, CNAME, SOA records. |
| `document-qa-prep` | $0.005 | Prepares a document for RAG pipelines. Chunks input text, extracts entities, returns semantic summary. |
| `domain-whois` | $0.006 | Domain WHOIS/RDAP lookup: registration date, expiration, registrar, name servers, status codes. |
| `earnings-calendar` | $0.005 | Upcoming US stock earnings — report date, EPS estimate, pre/post-market timing. Filter by ticker or look N days ahead (1–90). Covers 6,500+ companies. |
| `fact-check` | $0.500 | AI-powered claim verification. Searches DuckDuckGo, Wikipedia, Hacker News, and arXiv in parallel, then returns a structured verdict: confirmed / contradicted / uncertain, with confidence score (0–1), supporting and contradicting evidence excerpts with source URLs, and step-by-step reasoning. Use before an agent acts on a factual assertion. |
| `fda-recall-watch` | $0.008 | FDA recall and enforcement search across drugs, food/cosmetics, and medical devices (85,000+ actions). Returns classification (Class I/II/III), recall reason, product description, status, and distribution pattern. Seam: fills the product-safety layer missing from drug-intel + company-due-diligence chains. No API key required. |
| `federal-contract-intel` | $0.008 | US federal contract and grant intelligence via USASpending.gov. Returns top awards (award ID, amount, agency, description), agency breakdown, and total obligated amount for any company. Covers $10T+ in federal spending since 2007. Useful for procurement research, vendor due diligence, and competitive intelligence. No API key. |
| `email-verify` | $0.006 | Email validation and quality scoring: RFC-5322 syntax, disposable detection, MX record check. |
| `equity-brief` | $0.350 | AI-synthesized equity situation brief for any US stock. Gathers price/52w range, RSI-14 + SMA20/50/200 trend regime, insider buy/sell activity (SEC EDGAR Form 4, 60 days), options IV30 + P/C ratio (CBOE), and next earnings date + EPS estimate — then GPT-4o-mini synthesizes a structured brief: regime label, bull/bear case, dominant risk, agent implication, 160-word narrative. Replaces a 4-call chain at $0.350. |
| `equity-technicals` | $0.490 | Complete technical analysis package for any US stock: RSI(14), MACD, Bollinger Bands, support/resistance, volume trend. |
| `eth-block` | $0.002 | Ethereum block header + transaction hashes by block number, hex, or tag (latest/pending/earliest/safe/finalized). |
| `evm-log-events` | $0.004 | EVM contract event log query via eth_getLogs. Filter by contract address, event topic (Transfer/Approval/Swap/custom), and block range. Returns up to 50 decoded log entries with topics, data, tx hash, block number. Supports Ethereum/Base/Polygon/Arbitrum via free DRPC. 20% below market rate. |
| `evm-nonce` | $0.002 | EVM address nonce lookup — confirmed and pending transaction count. Supports Ethereum, Base, Polygon, Arbitrum, Optimism. Use pending nonce when building new transactions. 33% below market rate. |
| `evm-token-security` | $0.007 | Honeypot, rug-pull, and scam detection for any EVM token. Returns 0–100 risk score with individual factor breakdown. |
| `flight-tracker` | $0.008 | Departures or arrivals at any major airport via OpenSky Network. Returns flight number, status, delay data. |
| `forex-rates` | $0.005 | Real-time fiat foreign exchange rates for 160+ currencies. Base defaults to USD. |
| `funding-rates` | $0.020 | Current perpetual funding rates for 200+ assets on Hyperliquid DEX, sorted by 8h rate. |
| `gas-prices` | $0.005 | Current gas prices and EIP-1559 fee recommendations across Ethereum, Base, Polygon, Arbitrum, BSC, Avalanche. |
| `generate-meme` | $0.005 | Generates a meme image from 211 built-in templates. Returns a direct PNG URL. |
| `meme-generator` | $0.005 | Generate a meme image with topic-based template auto-selection. Provide text_top/text_bottom and a topic keyword; returns image URL. 211 templates, optional style variants. |
| `geocode` | $0.003 | Forward and reverse geocoding via OpenStreetMap Nominatim. Returns coordinates, address components, bounding box. |
| `github-repo-intel` | $0.010 | GitHub repository intelligence: stars, forks, open issues, language, license, last commit date. |
| `gov-votes` | $0.004 | US Congressional vote records from GovTrack (113th Congress onward). Search by congress, chamber, category. |
| `hn-search` | $0.010 | Hacker News story and comment search via Algolia. Returns titles, scores, comments, URLs. |
| `http-headers` | $0.003 | HTTP response headers inspector and security grader for any public URL. |
| `image-detect` | $0.040 | Detects the true image format of any URL via magic byte inspection — works even when the extension or Content-Type lies. Returns format (png/jpeg/gif/webp/avif/bmp/tiff/svg/ico), MIME type, content-type match flag, file size, and pixel dimensions for PNG/JPEG. 20% below x402node. |
| `intel-pack` | $0.15 | Three-source intelligence pack in one x402 call: equity market snapshot (SPY/QQQ/IWM/VIX/risk signal) + top DeFi yield pools by APY + top prediction markets by volume. Replaces three separate calls; $0.175 purchased individually. |
| `ip-intel` | $0.003 | Geolocation and network intelligence for IP addresses: country, city, ISP, ASN, timezone. |
| `json-extract` | $0.004 | Extracts and parses JSON from mixed-content text, including LLM output with markdown code fences. |
| `kimchi-premium` | $0.001 | Real-time Kimchi Premium for any Upbit-listed token: KRW price vs global USD spot (Kraken/OKX), FX-adjusted. Returns premium_percent and premium_direction. |
| `korean-market-movers` | $0.010 | Real-time movers and volume-spike leaders across all KRW-denominated markets on Upbit. |
| `labor-market` | $0.008 | US labor market leading indicators from FRED: initial jobless claims (weekly), continued claims, JOLTS job openings, nonfarm payrolls, labor force participation rate, average hourly earnings with YoY wage growth, and the Beveridge curve openings-per-unemployed ratio. No API key. |
| `lbo-model` | $4.50 | Full leveraged buyout model: sources & uses, year-by-year operating model, debt schedule with cash sweep, IRR + MOIC, and 3×3 entry/exit multiple sensitivity tables. Pure computation — no API dependency. |
| `legal-search` | $0.008 | Searches 5M+ US court opinions (SCOTUS, federal circuits, district courts, state courts) via CourtListener. |
| `limitless-markets` | $0.006 | Active prediction markets from Limitless Exchange with current Yes/No prices and open interest. |
| `macro-brief` | $0.350 | AI-synthesized US macroeconomic situation briefing. Gathers HY/IG credit spreads, yield curve, jobless claims, JOLTS, core PCE, and Fed Funds rate from FRED then uses GPT-4o-mini to synthesize a structured briefing: regime label, dominant risk, agent implication, and 200-word narrative. Replaces a 5+ step data + LLM chain. |
| `macro-indicators` | $0.008 | Current US macroeconomic indicators: Fed Funds Rate, CPI, GDP growth, unemployment, yield curve from FRED. |
| `market-intelligence` | $0.500 | Settlement-verified x402 endpoint intelligence: which endpoints have genuine organic payer breadth. |
| `market-movers` | $0.004 | Today's top market movers — equity gainers, losers, most-active, and crypto gainers in one call. |
| `market-overview` | $0.100 | Single-call market snapshot: SPY, QQQ, IWM, DIA price + intraday % change, VIX, BTC/ETH. |
| `market-sentiment` | $0.015 | Combined crypto market sentiment: Crypto Fear & Greed Index + BTC dominance + altcoin season score. |
| `news-sentiment` | $0.004 | Global news coverage and sentiment for any company, ticker, or topic (GDELT 250M+ articles + Google News fallback). Returns article count, avg tone score (−100 to +100), top headlines, and leading domains. 3-day default lookback (1–30 days). |
| `hf-model-search` | $0.002 | Search HuggingFace Hub for ML models by keyword and task filter. Returns top results by downloads or likes with model ID, author, pipeline task, library, download count, and tags. 1M+ models indexed. |
| `npm-lookup` | $0.007 | Node.js package metadata from npm: latest version, description, downloads, dependencies, repository. |
| `options-snapshot` | $0.015 | Options intelligence snapshot for any US equity — IV30, put/call volume ratio, top calls and puts by volume, and unusual-volume flags (volume ≥ 2× open interest). Free CBOE delayed data (15-min delay), no API key. Complements us-stock-price and equity-technicals with the options-layer sentiment agents need for complete trade context. |
| `page-intel` | $0.004 | Structured content extraction from any public URL: title, meta description, H1-H3 headings, links, text preview. |
| `page-links` | $0.004 | Extracts all hyperlinks from any public webpage with internal/external classification. Filter by link type (all/external/internal), returns {href, text, is_external, domain}. 20% below orbisapi web-scrape-links. |
| `ping` | $0.001 | Liveness + echo probe. Verifies the x402 payment rail end-to-end. |
| `place-details` | $0.020 | Enriched place and business details by name (OSM Nominatim): website, phone, hours, address, coordinates. |
| `policy-impact-mapper` | $0.007 | Analyzes regulatory and policy text to map impact across industry sectors. Returns affected sectors with justification. |
| `polymarket-accuracy-score` | $0.004 | Historical Polymarket crowd accuracy score and Brier calibration by category (crypto, politics, sports, macro). |
| `polymarket-sentiment-shift` | $0.008 | Polymarket prediction markets with the biggest recent probability shifts. |
| `portfolio-rebalance` | $0.005 | Pure-math portfolio rebalancing calculator. Given holdings and target allocations, returns trade instructions. |
| `prediction-markets` | $0.050 | Top active Polymarket prediction markets sorted by trading volume with crowd probabilities. |
| `prediction-stock-pulse` | $0.016 | One call: Limitless prediction markets + live equity price for a specified ticker. Collapses the prediction-market → stock-price agent chain (33% cheaper than buying both separately). |
| `pypi-lookup` | $0.007 | Python package metadata from PyPI: latest version, summary, author, license, dependencies. |
| `reddit-intel` | $0.012 | Reddit post and comment search by keyword. Returns top results with scores, subreddit, timestamps. |
| `regex-tester` | $0.003 | Safe regex testing and extraction. Validates pattern, finds all matches with capture groups. |
| `research-paper-search` | $0.003 | Academic paper search across 250M+ works via OpenAlex. Returns title, authors, year, DOI, open-access status. |
| `research-synthesis` | $0.200 | AI-synthesized intelligence report from multiple sources — Hacker News, academic papers, Reddit, arXiv, and more. Returns executive summary, key findings, sentiment, trends, and recommendations. 20% below nearest competitor. |
| `readable-content` | $0.004 | Extracts full readable text from any public URL as clean Markdown, stripped of navigation, ads, and boilerplate. Returns title, published date, and complete article body ready for LLM ingestion. |
| `roast` | $0.040 | AI-generated witty roast of any target — person, company, product, code snippet, or concept. 3-5 sentences of sharp, clever humor. Style: dry (default), savage, sarcastic, or gentle. 75% below anchor-x402.com. |
| `rss-reader` | $0.004 | Fetches and parses any public RSS 2.0 or Atom 1.0 feed. Returns feed metadata and recent items. |
| `solana-token-risk` | $0.350 | Rug-pull and risk scanner for Solana SPL tokens via RugCheck. Returns mint risk score, top holders, freeze authority. |
| `sports-prediction` | $0.005 | Today's sports games with team win-loss records, venue, broadcast info, and moneyline odds where available. |
| `sports-scores` | $0.004 | Live and recent sports scores for NBA, NFL, MLB, NHL, MLS, EPL, La Liga, Bundesliga, Champions League, and more. |
| `sec-filing-intel` | $0.015 | Real-time SEC EDGAR filing lookup by ticker or CIK. Returns company profile + recent filings (8-K, 10-K, 10-Q, Form 4, etc.) with EDGAR URLs. No API key. |
| `short-volume-intel` | $0.012 | Daily FINRA consolidated short-sale volume for any US equity: short volume, total volume, short ratio, and trend over the last N trading days. Free FINRA CDN, no API key. |
| `solar-intel` | $0.020 | Solar irradiance and 7-day forecast for any location: GHI, DNI, DHI, peak sun hours, panel yield estimate (1 kW system), sunrise/sunset, cloud cover, and solar rating. Free via Open-Meteo. Undercuts stableenrich.dev/solar by 31%. |
| `ssl-cert` | $0.004 | TLS/SSL certificate inspection for any HTTPS host: validity window, issuer, SANs, days until expiry. |
| `stablecoin-watch` | $0.050 | Real-time depeg monitor for top USD stablecoins (USDT, USDC, DAI, USDS, and others). |
| `stock-brief` | $0.015 | US equity snapshot + Limitless prediction market sentiment in one call. |
| `stock-price-multi` | $0.018 | Batch US equity price lookup — up to 5 tickers in one call via Yahoo Finance. 83% cheaper than sequential single-ticker calls. |
| `strategy-signal` | $0.006 | Technical analysis signal for US equities, ETFs, and crypto: RSI(14), MACD, Bollinger Bands, directional posture. |
| `timezone` | $0.002 | Timezone intelligence using the IANA database (418 zones): current time, UTC offset, DST status. |
| `tx-intel` | $0.006 | Decode and explain any EVM transaction: type (swap/transfer/approval/contract call), human-readable summary, token transfers from logs, gas cost, block context. Base/ETH/Arb/Optimism/Polygon/Avalanche/BSC. 40% below tx-explainer. |
| `tx-explainer` | $0.014 | Decoded EVM transaction breakdown: sender, recipient, value, gas, method name, event logs. |
| `unit-converter` | $0.002 | Converts between 100+ units across 12 categories: length, weight, temperature, volume, speed, and more. |
| `us-stock-price` | $0.018 | Current US equity price and intraday metrics for any NYSE/NASDAQ ticker via Yahoo Finance. 22% below blockrun.ai. |
| `stock-ohlcv` | $0.010 | Historical OHLCV candlestick data for any stock, ETF, or index. Intervals from 1-minute to monthly; ranges from 1-day to max history. Returns candles array, period high/low, and % change. Yahoo Finance, no API key. |
| `wallet-balance` | $0.002 | Native EVM token balance and USD value for any wallet across 6 chains (ETH, Base, Polygon, Arbitrum, Optimism, BSC). Free via DRPC + CoinGecko. |
| `wallet-credit-score` | $0.020 | Composite EVM wallet trust score 0–100 with tier classification (PRIME/ESTABLISHED/ACTIVE/SPARSE/DORMANT). Age, tx volume, token diversity, DeFi exposure. |
| `wallet-screener` | $0.010 | Risk screening for EVM wallet addresses: 0–100 risk score, individual factor breakdown (age, tx count, exposure). |
| `weather` | $0.010 | Current conditions and 7-day forecast for any location worldwide via Open-Meteo. |
| `whale-radar` | $0.003 | Polymarket whale intelligence for any proxy wallet — recent trades, open positions, inferred tier (whale/shark/dolphin/minnow), and P&L summary. Collapses seerium.xyz + hugen.tokyo seam (451 settlements/wk). |
| `web-change-monitor` | $0.005 | Content-change signals for any public URL: ETag, Last-Modified, Content-Length, response time. |
| `web-scrape-links` | $0.004 | Extracts all hyperlinks from any public webpage. Returns absolute URLs with link text. Optional same-domain filter, deduplication, anchor inclusion. |
| `web-company-intel` | $0.003 | Structured company intelligence from any public website: OpenGraph, schema.org, meta tags, social links. |
| `world-bank-data` | $0.003 | World Bank open data — 1600+ development indicators for 200+ countries. GDP, poverty, health, education. |
| `yield-farming-active` | $0.005 | Active DeFi yield farming pools sorted by 30-day average APY from DeFiLlama. |
| `nft-metadata` | $0.002 | NFT metadata, traits, image URL, and collection floor price for any ERC-721/ERC-1155 token. Supports Ethereum, Polygon, Base, Arbitrum. Collapses OneSource Media-category seam. |
| `address-security` | $0.007 | Wallet/address security and reputation check. Detects phishing, sanctions, cybercrime, money laundering, dark-web activity, and blacklisted wallets using GoPlus Labs + SlowMist + BlockSec data. |
| `chain-pulse` | $0.006 | Returns an Ethereum block header + current stablecoin depeg status in one call. Collapses the eth-block → stablecoin-watch agent chain. All upstreams fetched in parallel. |
| `company-due-diligence` | $0.007 | AI-agent due diligence on any company. Queries SEC EDGAR for public company data (CIK, ticker, SIC, address, filing history) with structured output. |
| `crypto-pulse` | $0.007 | Crypto market pulse — latest Ethereum (or Base) block context plus top crypto gainers and losers by 24h change, in a single x402 call. |
| `dex-swap-quote` | $0.012 | Best-route DEX swap quote across 20+ chains via Li.Fi aggregator. Returns expected output, exchange rate, gas cost, price impact, and route steps. |
| `ens-lookup` | $0.004 | ENS name ↔ Ethereum address resolution. Forward: pass a .eth name to get the address, avatar, and social profile records. Reverse: pass a 0x address to get its primary ENS name. |
| `erc20-snapshot` | $0.007 | Complete ERC20 token state in one call: name, symbol, decimals, total supply (raw + formatted), wallet balance, and allowances. Supports Ethereum, Base, Polygon, Arbitrum. |
| `gas-estimate` | $0.003 | Multi-chain gas price oracle: fast/standard/slow Gwei + USD cost for a transfer. Chains: ethereum, base, polygon, arbitrum, bsc. |
| `insider-trades` | $0.012 | Recent SEC Form 4 insider trading activity for any US public company. Returns who bought or sold (director, officer, 10%+ holder), transaction type, shares, and price. |
| `social-intel` | $0.004 | Returns public profile data for any social platform account. Pass a profile URL (platform auto-detected) or platform + username. Covers GitHub, HackerNews, Reddit, npm, Twitter/X, and Open Graph fallback. |

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
    defi-portfolio.js        multi-chain wallet scanner (ETH/Base/Polygon/Arb)
    ... 78 more capability modules (see /catalog)
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
- [x] **134 capabilities LIVE** at `https://the-stall.intuitek.ai` (Base mainnet, v3.93.0)
- [x] A2A Agent Card at `/.well-known/agent.json`
- [x] x402 discovery document at `/.well-known/x402`
- [x] Payment logging (JSONL) — every settled call recorded
- [x] First settled call → x402 Bazaar seeded (block 46944973, Base mainnet, 2026-06-05)
- [x] PROSPECTOR scout wired to heartbeat cadence (v0.4, 3.7M+ settlements archived)

---

*Built by [IntuiTek¹](https://intuitek.ai) — autonomous infrastructure for the agentic economy.*
