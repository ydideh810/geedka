// kimchi-premium.js
//
// Real-time Kimchi Premium: Upbit (Korean exchange, KRW) vs global spot (Kraken/OKX,
// USD), FX-adjusted. Positive premium = Korean price above global; negative = discount.
//
// Seam origin: api.printmoneylab.com/api/v1/kimchi-premium — x402 v2, $0.001/call,
// active on Base + Polygon + Solana. Covers BTC, ETH, XRP and others traded on Upbit.
//
// Free upstreams (all no-key, no-auth):
//   Upbit REST API   — https://api.upbit.com/v1/ticker?markets=KRW-{SYMBOL}
//   Kraken REST API  — https://api.kraken.com/0/public/Ticker?pair={SYMBOL}USD
//   OKX REST API     — https://www.okx.com/api/v5/market/ticker?instId={SYMBOL}-USDT (fallback)
//   open.er-api.com  — https://open.er-api.com/v6/latest/USD (USD/KRW FX, free tier)

const UA          = "Mozilla/5.0 (compatible; myriad/3.85; +https://synaptiic.org)";
const TIMEOUT_MS  = 10000;

// Kraken uses non-standard pair names for major assets
const KRAKEN_PAIR = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  XBT: "XBTUSD",
};

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}: ${url}`);
  return resp.json();
}

async function getUpbitPrice(symbol) {
  const market = `KRW-${symbol.toUpperCase()}`;
  const data = await fetchJson(
    `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`
  );
  if (!data || !data[0] || data[0].error) {
    throw new Error(`Upbit: symbol ${symbol} not found or error`);
  }
  return data[0].trade_price; // KRW
}

async function getGlobalUsdPrice(symbol) {
  const sym = symbol.toUpperCase();

  // 1. Try Kraken first (reliable, US-accessible)
  try {
    const krakenPair = KRAKEN_PAIR[sym] || `${sym}USD`;
    const data = await fetchJson(
      `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`
    );
    if (!data.error?.length) {
      const result = Object.values(data.result || {})[0];
      if (result?.c?.[0]) return parseFloat(result.c[0]);
    }
  } catch (_) { /* fall through to OKX */ }

  // 2. Fallback: OKX (global, no geo-restriction)
  const okxData = await fetchJson(
    `https://www.okx.com/api/v5/market/ticker?instId=${sym}-USDT`
  );
  if (okxData.code === "0" && okxData.data?.[0]?.last) {
    return parseFloat(okxData.data[0].last);
  }

  throw new Error(`No global price found for ${sym} (tried Kraken + OKX)`);
}

async function getUsdKrwRate() {
  const data = await fetchJson("https://open.er-api.com/v6/latest/USD");
  if (data.result !== "success") throw new Error("FX rate fetch failed");
  const rate = data.rates?.KRW;
  if (!rate) throw new Error("USD/KRW not in FX response");
  return rate;
}

export default {
  name: "kimchi-premium",
  price: "$0.034",

  description:
    "Real-time Kimchi Premium for any Upbit-listed token: KRW price on Upbit vs USD price on global exchange (Kraken/OKX), FX-adjusted. Returns premium_percent and premium_direction. Matches printmoneylab endpoint at 1/1 price.",

  inputSchema: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Crypto symbol to check, e.g. BTC, ETH, XRP, SOL, DOGE",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      symbol:          { type: "string" },
      upbit_krw:       { type: "number", description: "Upbit last trade price in KRW" },
      global_usd:      { type: "number", description: "Global spot price in USD (Kraken or OKX)" },
      fx_rate:         { type: "number", description: "USD/KRW exchange rate used" },
      upbit_usd_equiv: { type: "number", description: "Upbit KRW price converted to USD" },
      premium_percent: { type: "number", description: "Premium as %; positive = Korean premium over global" },
      premium_direction: { type: "string", enum: ["positive", "negative", "neutral"] },
      global_source:   { type: "string", description: "Source used for global price (kraken or okx)" },
      timestamp:       { type: "string" },
    },
  },

  async handler(query) {
    const symbol = (query.symbol || "BTC").toUpperCase().trim();
    if (!symbol) throw new Error("symbol is required");
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("invalid symbol format");

    const [upbitKrw, globalUsd, fxRate] = await Promise.all([
      getUpbitPrice(symbol),
      getGlobalUsdPrice(symbol),
      getUsdKrwRate(),
    ]);

    const upbitUsdEquiv  = upbitKrw / fxRate;
    const premiumPct     = ((upbitUsdEquiv - globalUsd) / globalUsd) * 100;
    const premiumRounded = Math.round(premiumPct * 100) / 100;

    const direction =
      premiumRounded > 0.05 ? "positive"
      : premiumRounded < -0.05 ? "negative"
      : "neutral";

    return {
      symbol,
      upbit_krw:         upbitKrw,
      global_usd:        globalUsd,
      fx_rate:           Math.round(fxRate * 1000) / 1000,
      upbit_usd_equiv:   Math.round(upbitUsdEquiv * 100) / 100,
      premium_percent:   premiumRounded,
      premium_direction: direction,
      global_source:     "kraken_or_okx",
      timestamp:         new Date().toISOString(),
    };
  },
};
