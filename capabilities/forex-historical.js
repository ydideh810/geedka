// forex-historical.js
//
// Historical ECB exchange rates — single date or date-range time series.
// Sourced from api.frankfurter.app (free, no key, ECB data back to 1999-01-04).
// 30 currencies: all majors + key regional. Complement to forex-rates (real-time).
//
// Growth signal: "Search" category, +8.5 endpoints/day (signal-intel 2026-06-09).
// Use case: tax reporting, expense reconciliation, financial analysis, accounting.

const BASE_URL = "https://api.frankfurter.app";
const UA       = "Mozilla/5.0 (compatible; the-stall/2.0; +https://intuitek.ai)";
const TIMEOUT  = 10_000;

const SUPPORTED = new Set([
  "AUD","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD",
  "HUF","IDR","ILS","INR","ISK","JPY","KRW","MXN","MYR","NOK",
  "NZD","PHP","PLN","RON","SEK","SGD","THB","TRY","USD","ZAR",
]);

async function apiFetch(path) {
  const url = `${BASE_URL}${path}`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Frankfurter HTTP ${r.status}: ${url}`);
  return r.json();
}

function filterRates(rates, symbols) {
  if (!symbols || symbols.length === 0) return rates;
  const out = {};
  for (const s of symbols) {
    if (rates[s] !== undefined) out[s] = rates[s];
  }
  return out;
}

export default {
  name:  "forex-historical",
  price: "$0.015",

  description:
    "Historical ECB exchange rates — single date lookup or time-series range. Returns rates for up to 30 major currencies (EUR, GBP, JPY, CAD, CHF, CNY, AUD, KRW, etc.) from 1999-01-04 to present. Free, no key, sourced from Frankfurter/ECB. Use for: tax-date FX rates, historical expense reconciliation, multi-year trend analysis, point-in-time currency conversion. Weekends and holidays return the nearest prior business day. Complements forex-rates (real-time) with retrospective data.",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (e.g. '2023-03-15'). Use 'latest' for today's ECB rate. Historical data available from 1999-01-04.",
      },
      end_date: {
        type: "string",
        description: "Optional end date YYYY-MM-DD for a time-series range. Max recommended range: 365 days. Returns rates keyed by date.",
      },
      base: {
        type: "string",
        description: "Base currency ISO 4217 (e.g. USD, EUR, GBP). Default: USD.",
        default: "USD",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Specific currencies to return (e.g. ['EUR','GBP','JPY']). Omit for all 30 supported currencies.",
      },
      convert: {
        type: "object",
        description: "Optional point-in-time conversion. E.g. {amount: 1000, from: 'USD', to: 'EUR'} at the requested date.",
        properties: {
          amount: { type: "number" },
          from:   { type: "string" },
          to:     { type: "string" },
        },
        required: [],
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      mode:       { type: "string", enum: ["single", "series"] },
      date:       { type: "string", description: "Actual date returned (nearest business day)." },
      start_date: { type: "string" },
      end_date:   { type: "string" },
      base:       { type: "string" },
      rates:      { type: "object", description: "Single mode: {currency → rate}. Series mode: {date → {currency → rate}}." },
      rate_count: { type: "integer" },
      series_days: { type: ["integer","null"] },
      conversion: {
        type: ["object","null"],
        properties: {
          amount: { type: "number" },
          from:   { type: "string" },
          to:     { type: "string" },
          result: { type: "number" },
          rate:   { type: "number" },
          date:   { type: "string" },
        },
      },
      note:  { type: ["string","null"] },
      ts:    { type: "string" },
    },
  },

  async handler(query) {
    const dateInput = (query.date || "latest").trim();
    const endDate   = query.end_date ? query.end_date.trim() : null;
    const base      = (query.base || "USD").toUpperCase().trim();
    const symbols   = Array.isArray(query.symbols)
      ? query.symbols.map(s => s.toUpperCase().trim()).filter(s => SUPPORTED.has(s))
      : [];

    if (!SUPPORTED.has(base)) {
      throw new Error(`Base currency '${base}' not supported. Supported: ${[...SUPPORTED].join(", ")}`);
    }

    let path;
    let isSeries = false;

    if (endDate) {
      isSeries = true;
      path = `/${encodeURIComponent(dateInput)}..${encodeURIComponent(endDate)}`;
    } else {
      path = `/${encodeURIComponent(dateInput)}`;
    }

    path += `?from=${base}`;
    if (symbols.length > 0) {
      path += `&to=${symbols.join(",")}`;
    }

    const raw = await apiFetch(path);

    // Conversion (single-date mode only)
    let conversion = null;
    if (query.convert && !isSeries) {
      const { amount, from, to } = query.convert;
      const fromUpper = from.toUpperCase();
      const toUpper   = to.toUpperCase();
      const allRates  = raw.rates || {};

      let rate;
      if (fromUpper === base) {
        rate = allRates[toUpper];
      } else if (toUpper === base) {
        rate = 1 / allRates[fromUpper];
      } else {
        const rF = allRates[fromUpper];
        const rT = allRates[toUpper];
        if (!rF || !rT) throw new Error(`Currency '${fromUpper}' or '${toUpper}' not in Frankfurter set`);
        rate = rT / rF;
      }
      if (!rate) throw new Error(`Cannot compute ${fromUpper}→${toUpper} rate`);

      conversion = {
        amount,
        from:   fromUpper,
        to:     toUpper,
        result: Math.round(amount * rate * 1e6) / 1e6,
        rate:   Math.round(rate * 1e8) / 1e8,
        date:   raw.date,
      };
    }

    const note = isSeries
      ? "Weekends and ECB holidays are skipped; only business days appear in series."
      : (raw.date !== dateInput && dateInput !== "latest"
          ? `No trading on ${dateInput}; nearest business day returned: ${raw.date}.`
          : null);

    if (isSeries) {
      const seriesRates = raw.rates || {};
      const filteredSeries = {};
      for (const [day, dayRates] of Object.entries(seriesRates)) {
        filteredSeries[day] = filterRates(dayRates, symbols);
      }
      return {
        mode:        "series",
        start_date:  raw.start_date,
        end_date:    raw.end_date,
        base:        raw.base,
        rates:       filteredSeries,
        rate_count:  symbols.length || SUPPORTED.size - 1,
        series_days: Object.keys(filteredSeries).length,
        conversion:  null,
        note,
        ts: new Date().toISOString(),
      };
    }

    return {
      mode:        "single",
      date:        raw.date,
      base:        raw.base,
      rates:       filterRates(raw.rates || {}, symbols),
      rate_count:  Object.keys(filterRates(raw.rates || {}, symbols)).length,
      series_days: null,
      conversion,
      note,
      ts: new Date().toISOString(),
    };
  },
};
