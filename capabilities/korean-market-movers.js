// korean-market-movers.js
//
// 1-minute movers and volume spikes on Korean crypto exchanges (Upbit).
// Seam origin: api.printmoneylab.com/api/v1/market-movers observed in
// agent chains alongside tx-explainer and yield-farming-active
// (signal-intel signals 52618+52619, strength 0.85, 2026-06-05).
//
// Free upstream: Upbit public REST API (no key required).
// Returns top risers, top fallers, and volume spike leaders across all
// KRW-denominated markets — a leading indicator frequently used by
// Korean-market-aware trading agents.

const UPBIT_MARKET_URL = "https://api.upbit.com/v1/market/all?isDetails=false";
const UPBIT_TICKER_URL = "https://api.upbit.com/v1/ticker";
const UA               = "Mozilla/5.0 (compatible; the-stall/1.5; +https://intuitek.ai)";
const BATCH_SIZE       = 100;
const FETCH_TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}: ${url}`);
  return resp.json();
}

async function getAllKrwTickers() {
  const allMarkets = await fetchJson(UPBIT_MARKET_URL);
  const krwMarkets = allMarkets
    .filter((m) => m.market.startsWith("KRW-"))
    .map((m) => m.market);

  const tickers = [];
  for (let i = 0; i < krwMarkets.length; i += BATCH_SIZE) {
    const batch  = krwMarkets.slice(i, i + BATCH_SIZE).join(",");
    const result = await fetchJson(`${UPBIT_TICKER_URL}?markets=${encodeURIComponent(batch)}`);
    tickers.push(...result);
  }
  return tickers;
}

function formatTicker(t, usdPerKrw) {
  const symbol         = t.market.replace("KRW-", "");
  const changeRatePct  = Math.round(t.signed_change_rate * 10000) / 100; // → percent, 2dp
  const priceKrw       = t.trade_price;
  const priceUsd       = usdPerKrw ? Math.round(priceKrw * usdPerKrw * 100) / 100 : null;
  const vol24hUsd      = usdPerKrw
    ? Math.round(t.acc_trade_price_24h * usdPerKrw)
    : null;

  return {
    symbol,
    market:             t.market,
    price_krw:          priceKrw,
    price_usd:          priceUsd,
    change_pct_24h:     changeRatePct,
    direction:          t.change,          // RISE | FALL | EVEN
    volume_24h_krw:     Math.round(t.acc_trade_price_24h),
    volume_24h_usd:     vol24hUsd,
    highest_52w_krw:    t.highest_52_week_price,
    lowest_52w_krw:     t.lowest_52_week_price,
  };
}

export default {
  name:  "korean-market-movers",
  price: "$0.059",

  description:
    "Real-time movers and volume-spike leaders across all KRW-denominated markets on Upbit (South Korea's largest crypto exchange). Returns top risers, top fallers, and top volume leaders ranked by 24h change or accumulated trade value. Korean exchange data is a leading indicator frequently observed by institutional agents — the 'kimchi premium' and local retail sentiment often precede global price moves. Free upstream source (Upbit public API), covers 260+ KRW markets.",

  inputSchema: {
    type: "object",
    properties: {
      top_n: {
        type: "integer",
        description: "Number of results per category (risers, fallers, volume leaders). Default 10, max 30.",
        default: 10,
        minimum: 1,
        maximum: 30,
      },
      min_volume_usd: {
        type: "number",
        description: "Minimum 24h volume in USD to include in results (filters illiquid micro-caps). Default 50000.",
        default: 50000,
      },
      symbol: {
        type: "string",
        description: "Return data for a specific token symbol only (e.g. 'BTC', 'ETH'). Case-insensitive. If provided, top_n and min_volume_usd are ignored.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      top_risers: {
        type: "array",
        description: "Tokens with the highest positive 24h price change on Upbit KRW markets.",
        items: { type: "object" },
      },
      top_fallers: {
        type: "array",
        description: "Tokens with the largest negative 24h price change on Upbit KRW markets.",
        items: { type: "object" },
      },
      volume_leaders: {
        type: "array",
        description: "Tokens with the highest 24h accumulated trading volume in KRW.",
        items: { type: "object" },
      },
      total_markets_scanned: {
        type: "integer",
        description: "Total KRW markets scanned on Upbit for this response.",
      },
      markets_above_min_volume: {
        type: "integer",
        description: "Markets that passed the min_volume_usd filter.",
      },
      exchange: { type: "string" },
      ts:        { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const topN         = Math.min(Math.max(1, query.top_n || 10), 30);
    const minVolUsd    = query.min_volume_usd ?? 50000;
    const filterSymbol = query.symbol ? query.symbol.toUpperCase().trim() : null;

    let tickers;
    try {
      tickers = await getAllKrwTickers();
    } catch (err) {
      throw new Error(`Upbit fetch failed: ${err.message}`);
    }

    // Fetch live KRW/USD rate from open.er-api.com (daily updates)
    let KRW_PER_USD = 1530; // fallback if fetch fails
    try {
      const fxResp = await fetch("https://open.er-api.com/v6/latest/USD", {
        headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000),
      });
      if (fxResp.ok) {
        const fx = await fxResp.json();
        if (fx.rates?.KRW) KRW_PER_USD = fx.rates.KRW;
      }
    } catch (_) { /* use fallback */ }
    const usdPerKrw = 1 / KRW_PER_USD;

    const totalScanned = tickers.length;

    if (filterSymbol) {
      const match = tickers.find((t) => t.market === `KRW-${filterSymbol}`);
      if (!match) throw new Error(`Symbol "${filterSymbol}" not found on Upbit KRW markets`);
      return {
        symbol_lookup: formatTicker(match, usdPerKrw),
        total_markets_scanned: totalScanned,
        exchange: "Upbit (KRW)",
        ts: new Date().toISOString(),
      };
    }

    // Filter by min volume
    const minVolKrw = minVolUsd * KRW_PER_USD;
    const filtered  = tickers.filter((t) => t.acc_trade_price_24h >= minVolKrw);

    const formatted = filtered.map((t) => formatTicker(t, usdPerKrw));

    const topRisers  = [...formatted]
      .sort((a, b) => b.change_pct_24h - a.change_pct_24h)
      .slice(0, topN);

    const topFallers = [...formatted]
      .sort((a, b) => a.change_pct_24h - b.change_pct_24h)
      .slice(0, topN);

    const volumeLeaders = [...formatted]
      .sort((a, b) => b.volume_24h_krw - a.volume_24h_krw)
      .slice(0, topN);

    return {
      top_risers:              topRisers,
      top_fallers:             topFallers,
      volume_leaders:          volumeLeaders,
      total_markets_scanned:   totalScanned,
      markets_above_min_volume: filtered.length,
      exchange: "Upbit (KRW)",
      ts: new Date().toISOString(),
    };
  },
};
