// polymarket-whale-entries.js
//
// Polymarket whale-entry detector — returns recent large-position trades from
// prediction markets, filtered by minimum USDC value.
//
// Seam origin: proxy.suverse.io/v1/data/polymarket-whale-entries
// 14 unique wallets, 151 calls/6d, ~$0.039/call avg.
// Agents building copy-trade strategies, smart-money confirmation, or
// contrarian signals need to identify when skilled traders take large positions.
// Distinct from polymarket-intel (market-level data) — this is trade-level.
//
// Free upstream: data-api.polymarket.com/trades — public, no auth required.
// Returns trade history across all markets with wallet, side, size, and price.
// USDC value computed as size * price (position tokens × entry price).
// [REDACTED]5, 2026-06-10.

const DATA_API = "https://data-api.polymarket.com/trades";
const UA       = "Mozilla/5.0 (compatible; the-stall/4.55; +https://intuitek.ai)";
const TIMEOUT  = 15_000;
const POOL     = 500; // trades to fetch before filtering

export default {
  name:  "polymarket-whale-entries",
  price: "$0.136",

  description:
    "Scans Polymarket for recent large-position trades. Returns whale entries filtered by minimum USDC value (size × entry price). Includes trader wallet, YES/NO side, USDC amount, entry price, market name, and on-chain tx hash. Use for smart-money signals, copy-trade detection, or market sentiment confirmation. Free upstream; no API keys.",

  inputSchema: {
    type:       "object",
    properties: {
      min_usdc: {
        type:        "number",
        minimum:     10,
        maximum:     100000,
        description: "Minimum USDC value per trade (size × price). Default: 500.",
      },
      limit: {
        type:        "integer",
        minimum:     1,
        maximum:     50,
        description: "Maximum whale trades to return (1–50). Default: 10.",
      },
      side: {
        type:        "string",
        enum:        ["BUY", "SELL"],
        description: "Filter by trade direction: BUY (taking YES/NO position) or SELL (closing/shorting). Omit for both.",
      },
      market: {
        type:        "string",
        description: "Keyword filter on market title (case-insensitive). E.g. 'bitcoin', 'election', 'fed rate'.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type:       "object",
    properties: {
      trades: {
        type:  "array",
        items: {
          type:       "object",
          properties: {
            wallet:       { type: "string",  description: "Trader's Polymarket proxy wallet address." },
            pseudonym:    { type: ["string", "null"], description: "Trader's display name if set." },
            side:         { type: "string",  description: "BUY (entering position) or SELL (exiting/shorting)." },
            outcome:      { type: "string",  description: "YES or NO outcome being traded." },
            usdc_value:   { type: "number",  description: "Approx USDC spent/received (size × price). BUY = cost, SELL = proceeds." },
            size:         { type: "number",  description: "Position size in outcome tokens." },
            price:        { type: "number",  description: "Entry price (0–1 range, where 1.0 = 100% probability)." },
            market_title: { type: "string",  description: "Full market question." },
            market_url:   { type: "string",  description: "Polymarket URL for the market." },
            tx_hash:      { type: ["string", "null"], description: "On-chain transaction hash (Base/Polygon)." },
            ts:           { type: "string",  description: "Trade timestamp ISO-8601." },
          },
        },
      },
      total_found:        { type: "integer", description: "Total whale trades found before limit applied." },
      min_usdc_threshold: { type: "number",  description: "Minimum USDC threshold used." },
      pool_scanned:       { type: "integer", description: "Number of recent trades scanned." },
      fetched_at:         { type: "string" },
    },
  },

  async handler(query) {
    const minUsdc  = Math.max(10, parseFloat(query.min_usdc ?? "500"));
    const limit    = Math.min(Math.max(parseInt(query.limit  ?? "10", 10), 1), 50);
    const sideFilter = (query.side ?? "").toUpperCase() || null;
    const keyword    = (query.market ?? "").toLowerCase().trim();

    // Fetch a pool of recent trades
    const url = `${DATA_API}?limit=${POOL}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`Polymarket data API HTTP ${resp.status}`);

    const raw = await resp.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected response format from Polymarket data API");

    // Filter and score
    let whales = raw.filter(t => {
      const usdc = (t.size ?? 0) * (t.price ?? 0);
      if (usdc < minUsdc) return false;
      if (sideFilter && t.side !== sideFilter) return false;
      if (keyword && !(t.title ?? "").toLowerCase().includes(keyword)) return false;
      return true;
    });

    // Sort by USDC value descending (largest first)
    whales.sort((a, b) => (b.size * b.price) - (a.size * a.price));

    const totalFound = whales.length;
    whales = whales.slice(0, limit);

    const trades = whales.map(t => ({
      wallet:       t.proxyWallet ?? null,
      pseudonym:    t.pseudonym   || null,
      side:         t.side        ?? null,
      outcome:      t.outcome     ?? null,
      usdc_value:   Math.round((t.size * t.price) * 100) / 100,
      size:         Math.round(t.size * 1000) / 1000,
      price:        Math.round(t.price * 10000) / 10000,
      market_title: t.title       ?? null,
      market_url:   t.slug
        ? `https://polymarket.com/event/${t.eventSlug ?? t.slug}`
        : null,
      tx_hash:      t.transactionHash || null,
      ts:           t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null,
    }));

    return {
      trades,
      total_found:        totalFound,
      min_usdc_threshold: minUsdc,
      pool_scanned:       raw.length,
      fetched_at:         new Date().toISOString(),
    };
  },
};
