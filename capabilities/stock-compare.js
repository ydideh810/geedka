// stock-compare.js
//
// Compare a primary US equity against up to 4 peers in one call.
// Returns full quote data for each ticker, ranked by day performance.
//
// Seam: 6x co-call pattern — agents calling us-stock-price + stock-price-multi
// in the same session to compare a focus stock against a basket. This cap serves
// both in one payment at $0.139 (vs $0.118 for two calls) and adds comparative
// ranking on top.
//
// Upstream: Yahoo Finance v8/finance/chart (public, no auth, no crumb).

const YF_BASE = "https://query2.finance.yahoo.com/v8/finance/chart";
const UA      = "Mozilla/5.0 (compatible; myriad/4.91; +https://synaptiic.org)";

async function fetchTicker(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid ticker symbol" };
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const errCode = data?.chart?.error?.code || "not_found";
      return { ticker: sym, error: `no data (${errCode})` };
    }
    const meta  = result.meta;
    const prev  = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const price = meta.regularMarketPrice;
    const diff  = price - prev;
    const pct   = prev !== 0 ? (diff / prev) * 100 : 0;
    return {
      ticker:       meta.symbol,
      name:         meta.longName || meta.shortName || null,
      price_usd:    Math.round(price * 10000) / 10000,
      change_pct:   Math.round(pct   * 10000) / 10000,
      change_usd:   Math.round(diff  * 10000) / 10000,
      volume:       meta.regularMarketVolume ?? null,
      day_high:     meta.regularMarketDayHigh ?? null,
      day_low:      meta.regularMarketDayLow  ?? null,
      week_52_high: meta.fiftyTwoWeekHigh     ?? null,
      week_52_low:  meta.fiftyTwoWeekLow      ?? null,
      exchange:     meta.fullExchangeName     ?? meta.exchangeName ?? null,
      currency:     meta.currency             ?? "USD",
      market_time:  meta.regularMarketTime
                      ? new Date(meta.regularMarketTime * 1000).toISOString()
                      : null,
      error: null,
    };
  } catch (err) {
    return { ticker: sym, error: `fetch failed: ${err.message}` };
  }
}

export default {
  name: "stock-compare",
  price: "$0.139",

  description:
    "Compare a primary US equity against up to 4 peers in a single call. Returns live price, change %, volume, and day/52-week range for each ticker, plus a performance ranking showing leader (highest gain%), laggard (lowest gain%), and the primary stock's relative rank among the group. Replaces separate us-stock-price + stock-price-multi calls.",

  inputSchema: {
    type: "object",
    properties: {
      primary: {
        type: "string",
        description: "The main stock to focus on (e.g. 'NVDA'). Case-insensitive.",
      },
      compare: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 4,
        description: "Up to 4 peer tickers to compare against (e.g. ['AMD','INTC','QCOM']). Case-insensitive.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      primary: {
        type: "object",
        description: "Full quote data for the primary ticker.",
      },
      peers: {
        type: "array",
        description: "Full quote data for each comparison ticker.",
      },
      ranking: {
        type: "array",
        description: "All tickers ranked by day change % (highest first). Each entry includes ticker, change_pct, and rank.",
      },
      leader: {
        type: "object",
        description: "Ticker with the highest day change % in the group.",
        properties: {
          ticker:     { type: "string" },
          change_pct: { type: "number" },
        },
      },
      laggard: {
        type: "object",
        description: "Ticker with the lowest day change % in the group.",
        properties: {
          ticker:     { type: "string" },
          change_pct: { type: "number" },
        },
      },
      primary_rank: {
        type: "integer",
        description: "Rank of the primary ticker (1 = best performer, higher = worse).",
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const primaryRaw  = (query.primary || "AAPL").trim();
    const compareRaw  = query.compare ?? ["MSFT", "GOOGL", "AMZN"];
    const allTickers  = [primaryRaw, ...compareRaw.slice(0, 4)];

    const results = await Promise.all(allTickers.map(fetchTicker));

    const primaryData = results[0];
    const peersData   = results.slice(1);

    // Build ranking from successful quotes only
    const ranked = results
      .filter(r => r.error == null)
      .sort((a, b) => b.change_pct - a.change_pct)
      .map((r, i) => ({ ticker: r.ticker, change_pct: r.change_pct, rank: i + 1 }));

    const leader  = ranked[0] ?? null;
    const laggard = ranked[ranked.length - 1] ?? null;
    const primaryRank = ranked.findIndex(r => r.ticker === primaryData.ticker) + 1 || null;

    return {
      primary:      primaryData,
      peers:        peersData,
      ranking:      ranked,
      leader,
      laggard,
      primary_rank: primaryRank,
      ts:           new Date().toISOString(),
    };
  },
};
