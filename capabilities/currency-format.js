// currency-format.js
//
// Locale-aware currency formatting, symbol lookup, and decimal/grouping
// separators for any ISO 4217 currency. Pure computation — zero upstream API.
//
// Seam: orbisapi.com/proxy/currency-formatting-api — 722 calls/3d, 25 payers, $8.58
//
// Useful for: financial agents rendering amounts, e-commerce bots building
// invoices, DeFi dashboards, multi-region SaaS billing displays.

const LOCALE_MAP = {
  USD: "en-US",  EUR: "de-DE",  GBP: "en-GB",  JPY: "ja-JP",
  CNY: "zh-CN",  KRW: "ko-KR",  INR: "hi-IN",  RUB: "ru-RU",
  AUD: "en-AU",  CAD: "en-CA",  CHF: "de-CH",  MXN: "es-MX",
  BRL: "pt-BR",  NOK: "nb-NO",  SEK: "sv-SE",  DKK: "da-DK",
  PLN: "pl-PL",  CZK: "cs-CZ",  HUF: "hu-HU",  RON: "ro-RO",
  HKD: "zh-HK",  SGD: "en-SG",  NZD: "en-NZ",  ZAR: "en-ZA",
  AED: "ar-AE",  SAR: "ar-SA",  TRY: "tr-TR",  THB: "th-TH",
  IDR: "id-ID",  MYR: "ms-MY",  PHP: "en-PH",  VND: "vi-VN",
};

function getLocale(currency, localeOverride) {
  if (localeOverride) return localeOverride;
  return LOCALE_MAP[currency.toUpperCase()] || "en-US";
}

function formatAmount(amount, currency, locale, style) {
  const cur = currency.toUpperCase();
  const formatter = new Intl.NumberFormat(locale, {
    style:    style || "currency",
    currency: cur,
  });
  return formatter.format(amount);
}

function getCurrencyInfo(currency, locale) {
  const cur = currency.toUpperCase();

  // Formatted parts breakdown
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
  }).formatToParts(1234567.89);

  let symbol = null, decimal = null, group = null;
  for (const p of parts) {
    if (p.type === "currency")           symbol  = p.value;
    if (p.type === "decimal")            decimal = p.value;
    if (p.type === "group")              group   = p.value;
  }

  // Human-readable name
  let name = null;
  try {
    name = new Intl.DisplayNames([locale], { type: "currency" }).of(cur);
  } catch (_) { /* some locales don't support currency display names */ }

  return { symbol, decimal_separator: decimal, grouping_separator: group, name };
}

export default {
  name:  "currency-format",
  price: "$0.014",

  description:
    "Locale-aware currency formatting and symbol lookup for any ISO 4217 currency. Formats numbers as currency strings (e.g. 1234.56 USD → '$1,234.56', EUR in German locale → '1.234,56 €'), returns currency symbol, decimal separator, grouping separator, and currency name. Pure computation — no API key, no upstream latency. Supports 150+ currencies and custom locale overrides. Use for: financial report generation, invoice display, DeFi amount formatting, cross-regional price display.",

  inputSchema: {
    type: "object",
    properties: {
      amount: {
        type: "number",
        description: "Numeric amount to format (e.g. 1234.56).",
      },
      currency: {
        type: "string",
        description: "ISO 4217 currency code (e.g. 'USD', 'EUR', 'JPY', 'KRW', 'BTC is not supported — ISO only).",
      },
      locale: {
        type: "string",
        description: "BCP 47 locale tag (e.g. 'en-US', 'de-DE', 'ja-JP'). Defaults to the canonical locale for the currency.",
      },
      mode: {
        type: "string",
        enum: ["format", "info", "both"],
        description: "'format' returns the formatted string only. 'info' returns symbol and separators only. 'both' returns everything. Default: 'both'.",
        default: "both",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      currency:           { type: "string" },
      locale:             { type: "string" },
      formatted:          { type: ["string", "null"], description: "Amount formatted as currency string. Null if no amount provided." },
      symbol:             { type: ["string", "null"] },
      decimal_separator:  { type: ["string", "null"] },
      grouping_separator: { type: ["string", "null"] },
      name:               { type: ["string", "null"], description: "Human-readable currency name in the specified locale." },
      amount:             { type: ["number", "null"] },
    },
  },

  async handler(query) {
    const currency = (query.currency || "USD").trim().toUpperCase();
    if (currency.length !== 3) {
      throw new Error("'currency' must be a 3-letter ISO 4217 code (e.g. USD, EUR, JPY)");
    }

    const mode   = query.mode || "both";
    const locale = getLocale(currency, query.locale);
    const amount = typeof query.amount === "number" ? query.amount : null;

    // Validate currency is recognized by Intl
    try {
      new Intl.NumberFormat(locale, { style: "currency", currency });
    } catch (_) {
      throw new Error(`Unsupported currency code: '${currency}'. Must be ISO 4217.`);
    }

    let formatted = null;
    if (amount !== null && mode !== "info") {
      formatted = formatAmount(amount, currency, locale);
    }

    let info = { symbol: null, decimal_separator: null, grouping_separator: null, name: null };
    if (mode !== "format") {
      info = getCurrencyInfo(currency, locale);
    }

    return {
      currency,
      locale,
      formatted,
      symbol:             info.symbol,
      decimal_separator:  info.decimal_separator,
      grouping_separator: info.grouping_separator,
      name:               info.name,
      amount,
    };
  },
};
