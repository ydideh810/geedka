// forex-rates.js
//
// Real-time fiat foreign exchange rates for 166+ currencies.
// Sourced from Open Exchange Rates (open.er-api.com, free tier, no key).
// Updates daily (~00:00 UTC).
//
// Useful for agents operating across borders, DeFi protocols with multi-
// region collateral, e-commerce bots calculating international prices,
// or any workflow that needs USD→KRW/EUR/JPY/etc. conversion.

const ER_URL    = "https://open.er-api.com/v6/latest";
const UA        = "Mozilla/5.0 (compatible; myriad/2.0; +https://synaptiic.org)";
const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

export default {
  name:  "forex-rates",
  price: "$0.059",

  description:
    "Real-time fiat foreign exchange rates. Base currency defaults to USD; returns rates for all 166 supported currencies, or a filtered subset. Sourced from open.er-api.com (free, no key, daily updates ~00:00 UTC). Supports any ISO 4217 base: EUR, GBP, JPY, KRW, CNY, AUD, etc. Use for: USD→KRW conversion when reading Korean exchange data, cross-border payment amounts, international price normalization, or any multi-currency DeFi workflow.",

  inputSchema: {
    type: "object",
    properties: {
      base: {
        type: "string",
        description: "Base currency ISO 4217 code (e.g. USD, EUR, GBP, JPY). Default: USD.",
        default: "USD",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Specific currency codes to return (e.g. ['KRW','EUR','GBP']). If omitted, returns all 166+ currencies.",
      },
      convert: {
        type: "object",
        description: "Optional: convert an amount. E.g. {amount: 1000, from: 'USD', to: 'KRW'}.",
        properties: {
          amount: { type: "number" },
          from:   { type: "string" },
          to:     { type: "string" },
        },
        required: ["amount", "from", "to"],
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      base:          { type: "string" },
      rates:         { type: "object", description: "Currency code → rate (how many units of currency per 1 base currency unit)." },
      rate_count:    { type: "integer" },
      last_updated:  { type: "string", description: "UTC timestamp of last rate update." },
      next_update:   { type: "string" },
      conversion:    {
        type: ["object", "null"],
        properties: {
          amount:       { type: "number" },
          from:         { type: "string" },
          to:           { type: "string" },
          result:       { type: "number" },
          rate:         { type: "number" },
        },
      },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const base    = (query.base || "USD").toUpperCase().trim();
    const symbols = Array.isArray(query.symbols)
      ? query.symbols.map((s) => s.toUpperCase().trim())
      : null;

    const raw = await fetchJson(`${ER_URL}/${encodeURIComponent(base)}`);

    if (raw.result !== "success") {
      throw new Error(`Exchange rate API error: ${raw["error-type"] || "unknown"}`);
    }

    let rates = raw.rates || {};

    // Filter if specific symbols requested
    if (symbols && symbols.length > 0) {
      const filtered = {};
      for (const sym of symbols) {
        if (rates[sym] !== undefined) filtered[sym] = rates[sym];
        else filtered[sym] = null; // mark missing
      }
      rates = filtered;
    }

    // Optional conversion
    let conversion = null;
    if (query.convert) {
      const { amount, from, to } = query.convert;
      const fromUpper = from.toUpperCase();
      const toUpper   = to.toUpperCase();

      // We have rates relative to `base`. To convert from→to:
      // If base === from: rate = rates[to]
      // If base === to: rate = 1 / rates[from]
      // Otherwise: convert from→base first, then base→to
      const fullRates = raw.rates;
      let rate;
      if (fromUpper === base) {
        rate = fullRates[toUpper];
      } else if (toUpper === base) {
        rate = 1 / fullRates[fromUpper];
      } else {
        const fromRate = fullRates[fromUpper];
        const toRate   = fullRates[toUpper];
        if (!fromRate || !toRate) throw new Error(`Currency "${fromUpper}" or "${toUpper}" not found`);
        rate = toRate / fromRate;
      }
      if (!rate) throw new Error(`Cannot compute rate from ${fromUpper} to ${toUpper}`);

      conversion = {
        amount,
        from:   fromUpper,
        to:     toUpper,
        result: Math.round(amount * rate * 1e6) / 1e6,
        rate:   Math.round(rate * 1e8) / 1e8,
      };
    }

    return {
      base,
      rates,
      rate_count:   Object.keys(rates).length,
      last_updated: raw.time_last_update_utc,
      next_update:  raw.time_next_update_utc,
      conversion,
      ts: new Date().toISOString(),
    };
  },
};
