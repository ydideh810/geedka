// funding-rates.js
//
// Returns current perpetual funding rates for 200+ assets on Hyperliquid DEX,
// sorted by absolute funding magnitude. Annualized rates let DeFi agents factor
// funding cost/income into strategy decisions before entering or adjusting
// perpetual positions.
//
// Priced at $0.020/call — undercutting otto.ai's /funding-rates endpoint.
// Free upstream: Hyperliquid public /info API, no key required, near-real-time.
//
// Data source: https://api.hyperliquid.xyz/info (type=metaAndAssetCtxs)

const HL_API = "https://api.hyperliquid.xyz/info";
const UA     = "Mozilla/5.0 (compatible; myriad/1.1; +https://synaptiic.org)";

export default {
  name: "funding-rates",
  price: "$0.059",

  description:
    "Returns current perpetual funding rates for 200+ assets on Hyperliquid DEX, sorted by absolute funding magnitude. Includes 8-hour and annualized rates, open interest, mark price, and directional signal (longs-pay or shorts-pay). Use before entering a perpetual position to factor funding cost/income into strategy ROI, or to scan for high-rate short-bias opportunities in delta-neutral strategies.",

  inputSchema: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Filter to a specific asset symbol (e.g. BTC, ETH, SOL). Case-insensitive. Omit for all assets.",
      },
      direction: {
        type: "string",
        enum: ["positive", "negative", "all"],
        description: "Filter by funding direction. 'positive' = longs pay shorts (bullish funding). 'negative' = shorts pay longs (bearish funding). Default: 'all'.",
      },
      min_oi_usd: {
        type: "number",
        description: "Minimum open interest in USD to filter out illiquid markets (e.g. 500000 for $500K). Default: 0.",
      },
      sort_by: {
        type: "string",
        enum: ["abs_funding", "funding", "open_interest"],
        description: "Sort order. 'abs_funding' (default) = highest absolute rate first. 'funding' = most positive first. 'open_interest' = largest OI first.",
      },
      limit: {
        type: "integer",
        description: "Max results to return (default 25, max 100).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      rates: {
        type: "array",
        description: "Perpetual funding rates matching filters, sorted as requested.",
        items: {
          type: "object",
          properties: {
            symbol:                  { type: "string",  description: "Asset symbol (e.g. BTC, ETH)." },
            exchange:                { type: "string",  description: "Exchange name. Currently always 'Hyperliquid'." },
            funding_rate_8h:         { type: "number",  description: "8-hour funding rate as a decimal (e.g. 0.0001 = 0.01% per 8h)." },
            funding_rate_annualized_pct: { type: "number", description: "Annualized funding rate in percent (e.g. 10.95 = 10.95% p.a.). Multiply funding_rate_8h × 3 × 365." },
            direction:               { type: "string",  enum: ["longs-pay-shorts", "shorts-pay-longs", "neutral"], description: "Who pays whom. Positive rate = longs pay shorts. Negative = shorts pay longs." },
            open_interest_usd:       { type: "number",  description: "Current open interest in USD." },
            mark_price:              { type: "number",  description: "Current mark price in USD." },
          },
        },
      },
      total_matched:  { type: "integer", description: "Assets matching the given filters before limit was applied." },
      exchange:       { type: "string",  description: "Data source exchange." },
      ts:             { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const symbolFilter = (query.symbol || "").trim().toUpperCase() || null;
    const direction    = query.direction || "all";
    const minOI        = Number(query.min_oi_usd ?? 0);
    const sortBy       = query.sort_by || "abs_funding";
    const limit        = Math.min(Math.max(1, parseInt(query.limit) || 25), 100);

    let raw;
    try {
      const resp = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) throw new Error(`Hyperliquid returned ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      throw new Error(`upstream fetch failed: ${err.message}`);
    }

    if (!Array.isArray(raw) || raw.length < 2) {
      throw new Error("unexpected Hyperliquid response shape");
    }

    const [meta, ctxs] = raw;
    const assets = meta?.universe;
    if (!Array.isArray(assets) || !Array.isArray(ctxs)) {
      throw new Error("missing universe or context arrays");
    }

    const round = (v, dp = 8) => {
      if (v == null) return null;
      const f = parseFloat(v);
      return isNaN(f) ? null : Math.round(f * Math.pow(10, dp)) / Math.pow(10, dp);
    };

    const items = [];
    for (let i = 0; i < assets.length && i < ctxs.length; i++) {
      const name = assets[i]?.name;
      const ctx  = ctxs[i];
      if (!name || !ctx) continue;

      const hourlyRate = parseFloat(ctx.funding ?? 0);
      const rate8h     = hourlyRate * 8;
      const annPct     = round(rate8h * 3 * 365 * 100, 4);  // 3 funding periods/day × 365
      const oi         = parseFloat(ctx.openInterest ?? 0);
      const markPx     = parseFloat(ctx.markPx ?? 0);
      const oiUSD      = round(oi * markPx, 0);

      const dir = rate8h > 0.0000001
        ? "longs-pay-shorts"
        : rate8h < -0.0000001
        ? "shorts-pay-longs"
        : "neutral";

      // Apply filters
      if (symbolFilter && name.toUpperCase() !== symbolFilter) continue;
      if (direction === "positive" && rate8h <= 0) continue;
      if (direction === "negative" && rate8h >= 0) continue;
      if (oiUSD < minOI) continue;

      items.push({
        symbol:                     name,
        exchange:                   "Hyperliquid",
        funding_rate_8h:            round(rate8h, 8),
        funding_rate_annualized_pct: annPct,
        direction:                  dir,
        open_interest_usd:          oiUSD,
        mark_price:                 round(markPx, 4),
      });
    }

    // Sort
    if (sortBy === "funding") {
      items.sort((a, b) => (b.funding_rate_8h ?? 0) - (a.funding_rate_8h ?? 0));
    } else if (sortBy === "open_interest") {
      items.sort((a, b) => (b.open_interest_usd ?? 0) - (a.open_interest_usd ?? 0));
    } else {
      // abs_funding (default)
      items.sort((a, b) => Math.abs(b.funding_rate_8h ?? 0) - Math.abs(a.funding_rate_8h ?? 0));
    }

    return {
      rates: items.slice(0, limit),
      total_matched: items.length,
      exchange: "Hyperliquid",
      ts: new Date().toISOString(),
    };
  },
};
