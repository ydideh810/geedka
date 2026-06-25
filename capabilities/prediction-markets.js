// prediction-markets.js
//
// Returns active prediction markets from Polymarket sorted by volume.
// For each market: question, outcome names + probabilities, trading volume,
// liquidity, and resolution date. Useful before decisions that depend on
// crowd-sourced probability estimates across politics, crypto, sports, or
// world events.
//
// Free upstream: gamma-api.polymarket.com — no API key required.
// Collapses the blockrun.ai/pm/limitless seam observed in x402 archive:
//   6 wallets chaining prediction-market lookups with stock price checks.

export default {
  name: "prediction-markets",
  price: "$0.07",

  description:
    "Returns top active Polymarket prediction markets sorted by trading volume. Includes crowd-sourced outcome probabilities (0–1), USDC volume, liquidity, and resolution date. Filter by keyword. Use this to gauge market consensus on events before making decisions. $0.05/call — free upstream, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional keyword filter. Returns only markets whose question contains this string (case-insensitive). E.g. 'bitcoin', 'election', 'fed rate'.",
      },
      min_volume: {
        type: "number",
        description:
          "Minimum USDC trading volume to include (default 1000). Higher = more liquid and reliable signal.",
        default: 1000,
      },
      limit: {
        type: "integer",
        description: "Max markets to return (1–25, default 10).",
        default: 10,
        minimum: 1,
        maximum: 25,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      markets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question:     { type: "string", description: "The prediction market question." },
            outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name:        { type: "string" },
                  probability: { type: "number", description: "Implied probability 0–1 from last trade price." },
                },
              },
            },
            volume_usdc:  { type: "number", description: "Total USDC trading volume." },
            liquidity_usdc: { type: "number", description: "Current USDC liquidity in the pool." },
            end_date:     { type: "string", description: "ISO-8601 resolution date." },
            active:       { type: "boolean" },
          },
        },
      },
      total_returned: { type: "integer" },
      filters_applied: { type: "object" },
      generated_at:   { type: "string" },
    },
  },

  async handler(query) {
    const keyword    = (query.query  || "").trim().toLowerCase();
    const minVolume  = Number(query.min_volume  ?? 1000);
    const limit      = Math.min(Math.max(parseInt(query.limit || "10", 10), 1), 25);

    const url =
      "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=100";

    const resp = await fetch(url, {
      headers: { "User-Agent": "the-stall/1.4.0 (x402 capability chassis)" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`Polymarket API error: HTTP ${resp.status}`);
    }

    const raw = await resp.json();
    if (!Array.isArray(raw)) {
      throw new Error("Unexpected Polymarket API response shape");
    }

    let filtered = raw.filter((m) => {
      const vol = Number(m.volume || 0);
      if (vol < minVolume) return false;
      if (keyword && !String(m.question || "").toLowerCase().includes(keyword)) return false;
      return true;
    });

    // Sort by volume descending — highest trading activity first
    filtered.sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));
    filtered = filtered.slice(0, limit);

    const markets = filtered.map((m) => {
      const outcomes     = JSON.parse(m.outcomes     || "[]");
      const priceStrings = JSON.parse(m.outcomePrices || "[]");

      return {
        question: m.question || "",
        outcomes: outcomes.map((name, i) => ({
          name,
          probability: parseFloat(priceStrings[i] || "0"),
        })),
        volume_usdc:    Number(m.volume    || 0),
        liquidity_usdc: Number(m.liquidity || 0),
        end_date:       m.endDate || null,
        active:         !!m.active,
      };
    });

    return {
      markets,
      total_returned: markets.length,
      filters_applied: {
        keyword:    keyword || null,
        min_volume: minVolume,
        limit,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
