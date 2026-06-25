// polymarket-crypto-updown.js
//
// Crypto price direction prediction markets from Polymarket.
// Returns binary up/down markets for BTC, ETH, SOL and other crypto assets —
// what the market consensus says about near-term price direction.
//
// Seam: blockrun.ai crypto-updown endpoint has 4680 settlements from 124 wallets
// at $0.001/call. Agents polling for real-time crypto directional sentiment.
// Free upstream: Polymarket Gamma API, tag_slug=crypto, no API key required.
// Priced at $0.001 to match market rate for polling use cases.

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";
const UA               = "Mozilla/5.0 (compatible; the-stall/4.45; +https://intuitek.ai)";
const TIMEOUT          = 10_000;

const ASSET_KEYWORDS = {
  btc:      ["bitcoin", "btc"],
  eth:      ["ethereum", "eth"],
  sol:      ["solana", "sol"],
  xrp:      ["xrp", "ripple"],
  doge:     ["doge", "dogecoin"],
  bnb:      ["bnb", "binance"],
  ada:      ["ada", "cardano"],
  avax:     ["avax", "avalanche"],
  link:     ["link", "chainlink"],
  dot:      ["dot", "polkadot"],
};

export default {
  name:  "polymarket-crypto-updown",
  price: "$0.059",

  description:
    "Crypto price direction prediction markets from Polymarket. Returns binary up/down markets for BTC, ETH, SOL, XRP and other assets — current market consensus on near-term price direction. Filter by asset symbol or get all active crypto markets. Use for directional sentiment, agent decision context, or signal feeds.",

  inputSchema: {
    type:       "object",
    properties: {
      asset: {
        type:        "string",
        description: "Asset symbol to filter (btc, eth, sol, xrp, doge, bnb, ada, avax, link, dot). Omit for all active crypto markets.",
      },
      limit: {
        type:        "integer",
        minimum:     1,
        maximum:     50,
        description: "Max markets to return (1–50). Default: 20.",
      },
    },
    required: [],
  },

  outputSchema: {
    type:       "object",
    properties: {
      markets: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            question:        { type: "string" },
            yes_probability: { type: "number", description: "Current Yes price (0–1)" },
            no_probability:  { type: "number" },
            volume_24h:      { type: "number" },
            volume_total:    { type: "number" },
            liquidity:       { type: "number" },
            end_date:        { type: "string" },
            url:             { type: "string" },
          },
        },
      },
      fetched_at:       { type: "string" },
      total_volume_24h: { type: "number" },
    },
  },

  async handler(query) {
    const assetKey = (query.asset ?? "").toLowerCase().trim();
    const limit    = Math.min(Math.max(parseInt(query.limit ?? "20", 10), 1), 50);

    const url = `${GAMMA_EVENTS_URL}?closed=false&active=true&limit=200&tag_slug=crypto&order=volume24hr&ascending=false`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`Polymarket Gamma API HTTP ${res.status}`);
    const events = await res.json();
    if (!Array.isArray(events)) throw new Error("Unexpected response format");

    // Expand events to individual markets
    let markets = [];
    for (const e of events) {
      for (const m of (e.markets ?? [])) {
        markets.push({ ...m, _eventTitle: e.title });
      }
    }

    // Apply asset filter if specified
    if (assetKey && ASSET_KEYWORDS[assetKey]) {
      const terms = ASSET_KEYWORDS[assetKey];
      markets = markets.filter(m => {
        const text = (m.question ?? "").toLowerCase();
        return terms.some(t => text.includes(t));
      });
    }

    // Sort by 24h volume descending, take limit
    markets = markets
      .sort((a, b) => parseFloat(b.volume24hr ?? "0") - parseFloat(a.volume24hr ?? "0"))
      .slice(0, limit);

    const result = markets.map(m => {
      const rawPrices = m.outcomePrices ?? "[]";
      const prices    = typeof rawPrices === "string" ? JSON.parse(rawPrices) : rawPrices;
      const yesProb   = parseFloat(prices[0] ?? "0.5");
      const noProb    = parseFloat(prices[1] ?? (1 - yesProb).toFixed(4));

      return {
        question:        m.question ?? "",
        yes_probability: Math.round(yesProb * 10000) / 10000,
        no_probability:  Math.round(noProb  * 10000) / 10000,
        volume_24h:      Math.round(parseFloat(m.volume24hr ?? "0") * 100) / 100,
        volume_total:    Math.round(parseFloat(m.volumeNum ?? m.volume ?? "0") * 100) / 100,
        liquidity:       Math.round(parseFloat(m.liquidityNum ?? m.liquidity ?? "0") * 100) / 100,
        end_date:        m.endDateIso ?? m.endDate ?? null,
        url:             `https://polymarket.com/event/${m.slug ?? m.conditionId ?? ""}`,
      };
    });

    const totalVol24h = result.reduce((s, m) => s + (m.volume_24h ?? 0), 0);

    return {
      markets:          result,
      fetched_at:       new Date().toISOString(),
      total_volume_24h: Math.round(totalVol24h * 100) / 100,
    };
  },
};
