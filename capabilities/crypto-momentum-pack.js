// crypto-momentum-pack.js
//
// Collapses seam: printmoneylab/market-movers → x402.ottoai.services/yield-farming-active
// 5 wallets, 7-day persistence, strength 0.95 (signal-intel 2026-06-09, signal 85399 + 85401)
//
// Delivers in one call: Korean exchange volume leaders + global 24h movers + optional DeFi yields
// Price: $0.007 (vs $0.015+ chain cost)
//
// Data sources (free, no auth):
//   Korean volume: Upbit public REST API
//   Global movers: CoinGecko /v3/coins/markets (free tier)
//   DeFi yields: DeFiLlama yields.llama.fi (when include_yields=true)

const UPBIT_MARKETS_URL = "https://api.upbit.com/v1/market/all?isDetails=false";
const UPBIT_TICKER_URL  = "https://api.upbit.com/v1/ticker";
const CG_URL            = "https://api.coingecko.com/api/v3/coins/markets";
const YIELDS_URL        = "https://yields.llama.fi/pools";
const UA                = "Mozilla/5.0 (compatible; the-stall/4.39; +https://intuitek.ai)";
const TIMEOUT           = 12000;

async function fetchJSON(url, headers = {}) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url.slice(0, 80)}`);
  return resp.json();
}

async function getKoreanLeaders(mode, limit) {
  const allMarkets = await fetchJSON(UPBIT_MARKETS_URL);
  const krwMarkets = allMarkets
    .filter(m => m.market.startsWith("KRW-"))
    .map(m => m.market);

  // Batch in groups of 100 (Upbit limit)
  const batches = [];
  for (let i = 0; i < krwMarkets.length; i += 100) {
    batches.push(krwMarkets.slice(i, i + 100));
  }
  const tickers = [];
  for (const batch of batches) {
    const url = `${UPBIT_TICKER_URL}?markets=${batch.join(",")}`;
    const data = await fetchJSON(url);
    tickers.push(...data);
  }

  // Sort based on mode
  if (mode === "volume") {
    tickers.sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h);
  } else if (mode === "losers") {
    tickers.sort((a, b) => a.signed_change_rate - b.signed_change_rate);
  } else {
    // gainers (default)
    tickers.sort((a, b) => b.signed_change_rate - a.signed_change_rate);
  }

  return tickers.slice(0, limit).map(t => {
    const symbol = t.market.replace("KRW-", "");
    const chgPct = +(t.signed_change_rate * 100).toFixed(2);
    const vol24hUSD = +(t.acc_trade_price_24h / 1350).toFixed(0); // KRW → USD approx
    return {
      symbol,
      exchange: "Upbit (Korean)",
      price_krw: t.trade_price,
      change_24h_pct: chgPct,
      volume_24h_usd_approx: vol24hUSD,
      high_24h_krw: t.high_price,
      low_24h_krw: t.low_price,
      trade_status: t.market_state,
    };
  });
}

async function getGlobalMovers(mode, limit) {
  const order =
    mode === "losers" ? "price_change_percentage_24h_asc" :
    mode === "volume" ? "volume_desc" :
    "price_change_percentage_24h_desc";
  const url = `${CG_URL}?vs_currency=usd&order=${order}&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const data = await fetchJSON(url);
  return data.map(c => ({
    symbol:          c.symbol.toUpperCase(),
    name:            c.name,
    price_usd:       c.current_price,
    change_24h_pct:  +(c.price_change_percentage_24h || 0).toFixed(2),
    volume_24h_usd:  Math.round(c.total_volume || 0),
    market_cap_usd:  Math.round(c.market_cap || 0),
    rank:            c.market_cap_rank,
  }));
}

async function getTopYields(symbols, limit) {
  const resp = await fetchJSON(YIELDS_URL);
  const pools = resp.data ?? [];

  // Match pools where the symbol appears in the pool's symbol string
  const symbolSet = new Set(symbols.map(s => s.toLowerCase()));
  // Split pool symbol on common delimiters and match exact token names
  const matched = pools.filter(p => {
    const parts = (p.symbol || "").toLowerCase().split(/[-_/.+]/);
    const hasSymbol = parts.some(part => symbolSet.has(part));
    return hasSymbol && (p.tvlUsd || 0) >= 1_000_000;
  });

  matched.sort((a, b) => (b.apyMean30d || 0) - (a.apyMean30d || 0));
  return matched.slice(0, limit).map(p => ({
    pool_symbol:    p.symbol,
    protocol:       p.project,
    chain:          p.chain,
    tvl_usd:        Math.round(p.tvlUsd || 0),
    apy_current:    +((p.apy || 0).toFixed(2)),
    apy_30d_mean:   +((p.apyMean30d || 0).toFixed(2)),
    stablecoin:     p.stablecoin || false,
    il_risk:        p.ilRisk || "unknown",
  }));
}

export default {
  name:  "crypto-momentum-pack",
  price: "$0.039",

  description:
    "Korean exchange volume leaders + global 24h movers + optional DeFi yield cross-reference in one call. Collapses the printmoneylab/market-movers → ottoai/yield-farming-active agent chain at 53% of the chain cost. Returns top gaining/losing/volume-leading tokens on Upbit (Korea's #1 exchange), global CoinGecko movers, and matching DeFi yield pools when include_yields is true. Korean volume often leads global crypto moves — use for pre-trade momentum confirmation, cross-exchange alpha identification, and DeFi capital allocation.",

  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["gainers", "losers", "volume"],
        description: "Ranking mode: 'gainers' (top 24h % up), 'losers' (top 24h % down), 'volume' (highest 24h USD volume). Default: gainers.",
        default: "gainers",
      },
      limit: {
        type: "integer",
        description: "Number of tokens to return per source (1–20). Default 10.",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      include_yields: {
        type: "boolean",
        description: "If true, cross-reference results with DeFiLlama yield farming pools for the identified tokens. Adds ~1s latency. Default false.",
        default: false,
      },
      korean_only: {
        type: "boolean",
        description: "If true, returns only the Korean Upbit data (faster, omits CoinGecko global movers). Default false.",
        default: false,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      mode:            { type: "string" },
      sourced_at:      { type: "string", description: "ISO-8601 timestamp" },
      korean_leaders: {
        type: "array",
        description: "Top movers on Upbit (Korea). Volume in USD is approximate (KRW/1350).",
        items: {
          type: "object",
          properties: {
            symbol:                 { type: "string" },
            exchange:               { type: "string" },
            price_krw:              { type: "number" },
            change_24h_pct:         { type: "number" },
            volume_24h_usd_approx:  { type: "number" },
            high_24h_krw:           { type: "number" },
            low_24h_krw:            { type: "number" },
            trade_status:           { type: "string" },
          },
        },
      },
      global_movers: {
        type: "array",
        description: "Global movers from CoinGecko. Omitted when korean_only=true.",
        items: {
          type: "object",
          properties: {
            symbol:         { type: "string" },
            name:           { type: "string" },
            price_usd:      { type: "number" },
            change_24h_pct: { type: "number" },
            volume_24h_usd: { type: "number" },
            market_cap_usd: { type: "number" },
            rank:           { type: "integer" },
          },
        },
      },
      yield_pools: {
        type: "array",
        description: "DeFiLlama yield pools matching identified tokens. Only present when include_yields=true.",
        items: {
          type: "object",
          properties: {
            pool_symbol:  { type: "string" },
            protocol:     { type: "string" },
            chain:        { type: "string" },
            tvl_usd:      { type: "number" },
            apy_current:  { type: "number" },
            apy_30d_mean: { type: "number" },
            stablecoin:   { type: "boolean" },
            il_risk:      { type: "string" },
          },
        },
      },
      summary: { type: "string", description: "Plain-English momentum summary." },
    },
  },

  async handler({ mode = "gainers", limit = 10, include_yields = false, korean_only = false }) {
    const now = new Date().toISOString();

    const [koreanLeaders, globalMovers] = await Promise.all([
      getKoreanLeaders(mode, limit),
      korean_only ? [] : getGlobalMovers(mode, limit),
    ]);

    const allSymbols = [
      ...koreanLeaders.map(t => t.symbol),
      ...globalMovers.map(t => t.symbol),
    ];

    let yieldPools = [];
    if (include_yields && allSymbols.length > 0) {
      yieldPools = await getTopYields(allSymbols, 15);
    }

    // Build plain-English summary
    const topKorean = koreanLeaders[0];
    const topGlobal = globalMovers[0];
    const koreanNote = topKorean
      ? `Korean leader: ${topKorean.symbol} ${topKorean.change_24h_pct > 0 ? "+" : ""}${topKorean.change_24h_pct}% (~$${topKorean.volume_24h_usd_approx.toLocaleString()} vol).`
      : "No Korean data.";
    const globalNote = topGlobal
      ? ` Global ${mode}: ${topGlobal.symbol} ${topGlobal.change_24h_pct > 0 ? "+" : ""}${topGlobal.change_24h_pct}% (rank #${topGlobal.rank}).`
      : "";
    const yieldNote = yieldPools.length > 0
      ? ` Best yield match: ${yieldPools[0].pool_symbol} on ${yieldPools[0].protocol} (${yieldPools[0].chain}) @ ${yieldPools[0].apy_30d_mean}% APY 30d.`
      : "";

    const result = {
      mode,
      sourced_at: now,
      korean_leaders: koreanLeaders,
      global_movers: globalMovers,
      summary: koreanNote + globalNote + yieldNote,
    };

    if (include_yields) result.yield_pools = yieldPools;

    return result;
  },
};
