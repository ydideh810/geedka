// stablecoin-watch.js
//
// Depeg monitor for top USD stablecoins. Sourced from DeFiLlama public API
// (free, no key). Returns price, peg deviation, and depeg status per coin,
// plus a composite alert level.
//
// Priced at $0.05 — 70% of the observed dataendpoints→onesource.io
// multi-hop chain (14 wallets, signal strength 0.80, signal-intel 2026-06-05).

const LLAMA_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
const UA        = "Mozilla/5.0 (compatible; myriad/0.7; +https://synaptiic.org)";

function depegStatus(price) {
  const dev = Math.abs(price - 1.0);
  if (dev < 0.001) return "PARITY";
  if (dev < 0.005) return "MILD_DEPEG";
  if (dev < 0.01)  return "MODERATE_DEPEG";
  return "SEVERE_DEPEG";
}

function compositeAlert(coins) {
  if (coins.some(c => c.depeg_status === "SEVERE_DEPEG"))   return "RED";
  if (coins.some(c => c.depeg_status === "MODERATE_DEPEG")) return "ORANGE";
  if (coins.some(c => c.depeg_status === "MILD_DEPEG"))     return "YELLOW";
  return "GREEN";
}

export default {
  name:  "stablecoin-watch",
  price: "$0.07",

  description:
    "Real-time depeg monitor for top USD stablecoins (USDT, USDC, DAI, USDS, and others ranked by market cap). Returns current price, peg deviation %, depeg status (PARITY / MILD_DEPEG / MODERATE_DEPEG / SEVERE_DEPEG), supply trend, and a composite alert level (GREEN / YELLOW / ORANGE / RED). Sourced from DeFiLlama public API — no key required, updates every call. Useful for DeFi risk management, collateral health checks, and pre-trade regime detection.",

  inputSchema: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description:
          "Filter to a specific stablecoin symbol (e.g. USDT, USDC, DAI). Case-insensitive. If omitted, returns top coins by market cap.",
      },
      top_n: {
        type: "integer",
        description:
          "Number of top stablecoins to return, ranked by circulating supply. Default 20, max 50. Ignored if symbol is specified.",
        minimum: 1,
        maximum: 50,
      },
      alert_only: {
        type: "boolean",
        description:
          "If true, only return coins with MILD_DEPEG or worse. Useful for alert-driven workflows.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      alert_level: {
        type: "string",
        description:
          "Composite depeg signal across all returned coins: GREEN (all at PARITY), YELLOW (mild depeg present), ORANGE (moderate depeg present), RED (severe depeg present).",
      },
      coins: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol:         { type: "string",  description: "Stablecoin ticker symbol." },
            name:           { type: "string",  description: "Full stablecoin name." },
            price:          { type: "number",  description: "Current price in USD." },
            peg_deviation:  { type: "number",  description: "Absolute deviation from $1.00 (e.g. 0.0012 = 0.12% off peg)." },
            depeg_status:   { type: "string",  description: "PARITY | MILD_DEPEG | MODERATE_DEPEG | SEVERE_DEPEG" },
            peg_mechanism:  { type: ["string", "null"], description: "fiat-backed | crypto-backed | algorithmic | etc." },
            circulating_bn: { type: "number",  description: "Current circulating supply in billions USD." },
            supply_1d_pct:  { type: ["number", "null"], description: "Supply change vs prior day in percent (positive = expansion, negative = contraction)." },
          },
        },
      },
      count: { type: "integer", description: "Number of coins in this response." },
      ts:    { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const topN      = Math.min(Math.max(1, query.top_n || 20), 50);
    const filterSym = query.symbol ? String(query.symbol).toUpperCase().trim() : null;
    const alertOnly = !!query.alert_only;

    let raw;
    try {
      const resp = await fetch(LLAMA_URL, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      throw new Error(`DeFiLlama fetch failed: ${err.message}`);
    }

    let assets = (raw.peggedAssets || []).filter(
      a => a.pegType === "peggedUSD" && typeof a.price === "number"
    );

    // Sort by circulating supply descending (market cap proxy)
    assets.sort((a, b) => {
      const capA = a.circulating?.peggedUSD || 0;
      const capB = b.circulating?.peggedUSD || 0;
      return capB - capA;
    });

    if (filterSym) {
      assets = assets.filter(a => a.symbol.toUpperCase() === filterSym);
      if (!assets.length) {
        throw new Error(`stablecoin "${filterSym}" not found — check symbol or use top_n mode`);
      }
    } else {
      assets = assets.slice(0, topN);
    }

    let coins = assets.map(a => {
      const cap   = (a.circulating?.peggedUSD    || 0) / 1e9;
      const capPD = (a.circulatingPrevDay?.peggedUSD || 0) / 1e9;
      const s1d   = capPD > 0 ? ((cap - capPD) / capPD) * 100 : null;
      const dev   = Math.abs(a.price - 1.0);
      return {
        symbol:         a.symbol,
        name:           a.name,
        price:          Math.round(a.price  * 1e6) / 1e6,
        peg_deviation:  Math.round(dev       * 1e6) / 1e6,
        depeg_status:   depegStatus(a.price),
        peg_mechanism:  a.pegMechanism || null,
        circulating_bn: Math.round(cap  * 100) / 100,
        supply_1d_pct:  s1d !== null ? Math.round(s1d * 1000) / 1000 : null,
      };
    });

    if (alertOnly) {
      coins = coins.filter(c => c.depeg_status !== "PARITY");
    }

    return {
      alert_level: compositeAlert(coins),
      coins,
      count: coins.length,
      ts:    new Date().toISOString(),
    };
  },
};
