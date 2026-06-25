// defi-market-pulse.js
//
// Combined DeFi yield intelligence + market momentum in one call.
// Collapses the observed seam: yield-farming-active → market-movers
// (6 distinct wallets, 4-day persistence, signal-intel signal_id 57542, strength 70%).
// Priced at $0.012.
//
// Adds cross-signal layer: matches yield pool tokens to market movers to surface
// "boosted" (APY + momentum), "at_risk" (APY + sell-off), and "neutral" pools.
//
// Upstream: DeFiLlama (free) + CoinGecko (free) + Yahoo Finance (free)

const YIELDS_URL = "https://yields.llama.fi/pools";
const CG_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const YF_BASE    = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const UA         = "Mozilla/5.0 (compatible; the-stall/0.7; +https://intuitek.ai)";
const TIMEOUT    = 20_000;

async function fetchYields({ chain, protocol, minTvl, minApy, stablecoinOnly, limit }) {
  const resp = await fetch(YIELDS_URL, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`DeFiLlama HTTP ${resp.status}`);
  const { data } = await resp.json();
  if (!Array.isArray(data)) throw new Error("Unexpected DeFiLlama shape");

  let pools = data.filter(p => {
    if (!p || typeof p.apy !== "number") return false;
    const tvl   = p.tvlUsd ?? 0;
    const apy30 = p.apyMean30d ?? p.apy;
    if (tvl < minTvl)    return false;
    if (apy30 < minApy)  return false;
    if (stablecoinOnly && !p.stablecoin) return false;
    if (chain    && (p.chain    || "").toLowerCase() !== chain.toLowerCase())       return false;
    if (protocol && !(p.project || "").toLowerCase().includes(protocol.toLowerCase())) return false;
    return true;
  });

  pools.sort((a, b) => ((b.apyMean30d ?? b.apy ?? 0) - (a.apyMean30d ?? a.apy ?? 0)));

  return pools.slice(0, limit).map((p, i) => ({
    rank:         i + 1,
    protocol:     p.project  ?? "unknown",
    chain:        p.chain    ?? "unknown",
    symbol:       p.symbol   ?? "unknown",
    tvl_usd:      Math.round(p.tvlUsd ?? 0),
    apy_current:  Number((p.apy ?? 0).toFixed(4)),
    apy_30d_mean: Number((p.apyMean30d ?? p.apy ?? 0).toFixed(4)),
    il_risk:      p.ilRisk   ?? "unknown",
    stablecoin:   Boolean(p.stablecoin),
    exposure:     p.exposure ?? "unknown",
  }));
}

async function fetchCryptoMovers(limit) {
  const [gainersResp, losersResp] = await Promise.all([
    fetch(`${CG_MARKETS}?vs_currency=usd&order=percent_change_24h_desc&per_page=${limit}&page=1&sparkline=false`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT),
    }),
    fetch(`${CG_MARKETS}?vs_currency=usd&order=percent_change_24h_asc&per_page=${limit}&page=1&sparkline=false`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT),
    }),
  ]);
  const toMover = d => ({
    symbol:     (d.symbol ?? "").toUpperCase(),
    name:       d.name ?? d.symbol,
    price:      d.current_price ?? null,
    change_pct: Number((d.price_change_percentage_24h ?? 0).toFixed(4)),
    volume:     d.total_volume ?? null,
    market_cap: d.market_cap ?? null,
  });
  const gainers = gainersResp.ok ? (await gainersResp.json()).map(toMover) : [];
  const losers  = losersResp.ok  ? (await losersResp.json()).map(toMover)  : [];
  return { gainers, losers };
}

async function fetchEquityMovers(limit) {
  const urls = {
    gainers: `${YF_BASE}?formatted=false&scrIds=day_gainers&count=${limit}&start=0`,
    losers:  `${YF_BASE}?formatted=false&scrIds=day_losers&count=${limit}&start=0`,
    active:  `${YF_BASE}?formatted=false&scrIds=most_actives&count=${limit}&start=0`,
  };
  const results = await Promise.allSettled(
    Object.entries(urls).map(([k, url]) =>
      fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) })
        .then(r => r.ok ? r.json() : null)
        .then(d => [k, (d?.finance?.result?.[0]?.quotes ?? []).map(q => ({
          symbol:     q.symbol,
          name:       q.shortName ?? q.symbol,
          price:      q.regularMarketPrice ?? null,
          change_pct: Number((q.regularMarketChangePercent ?? 0).toFixed(4)),
          volume:     q.regularMarketVolume ?? null,
          market_cap: q.marketCap ?? null,
        }))])
    )
  );
  return Object.fromEntries(
    results.filter(r => r.status === "fulfilled").map(r => r.value)
  );
}

function buildCrossSignals(pools, cryptoGainers, cryptoLosers) {
  const gainerSyms = new Map(cryptoGainers.map(m => [m.symbol, m.change_pct]));
  const loserSyms  = new Map(cryptoLosers.map(m => [m.symbol, m.change_pct]));

  return pools.map(pool => {
    // Extract base token symbols from pool symbol (e.g. "USDC-ETH" → ["USDC","ETH"])
    const tokens = (pool.symbol || "").split(/[-/+]/).map(t => t.trim().toUpperCase());
    let signal = "neutral";
    let matched_symbol = null;
    let market_change_pct = null;

    for (const tok of tokens) {
      if (gainerSyms.has(tok)) {
        signal = "boosted";
        matched_symbol   = tok;
        market_change_pct = gainerSyms.get(tok);
        break;
      }
      if (loserSyms.has(tok)) {
        signal = "at_risk";
        matched_symbol   = tok;
        market_change_pct = loserSyms.get(tok);
        break;
      }
    }

    return {
      rank:             pool.rank,
      pool_symbol:      pool.symbol,
      protocol:         pool.protocol,
      chain:            pool.chain,
      apy_30d_mean:     pool.apy_30d_mean,
      signal,
      matched_symbol,
      market_change_pct,
      interpretation:
        signal === "boosted"
          ? `Protocol token ${matched_symbol} +${market_change_pct?.toFixed(2)}% — yield + momentum aligned`
          : signal === "at_risk"
            ? `Protocol token ${matched_symbol} ${market_change_pct?.toFixed(2)}% — APY may be unsustainable under sell pressure`
            : "No market signal — yield driven by fundamentals only",
    };
  });
}

export default {
  name: "defi-market-pulse",

  price: "$0.059",

  description:
    "Combined DeFi yield intelligence and market momentum in one call — 33% cheaper than separate " +
    "yield-farming-active + market-movers calls ($0.009). Returns top yield pools from DeFiLlama, " +
    "crypto and equity market movers, and a cross-signal layer that flags 'boosted' pools (high APY + " +
    "rising token) vs 'at_risk' pools (high APY + falling token). Use for capital allocation decisions, " +
    "pre-trade DeFi context, and portfolio rebalancing signals.",

  inputSchema: {
    type: "object",
    properties: {
      chain: {
        type: "string",
        description: "Filter yield pools by blockchain (e.g. 'Ethereum', 'Base', 'Arbitrum'). Case-insensitive. Omit for all chains.",
      },
      protocol: {
        type: "string",
        description: "Filter yield pools by protocol name (e.g. 'aave-v3', 'uniswap-v3'). Substring match.",
      },
      min_tvl_usd: {
        type: "number",
        description: "Minimum TVL in USD for yield pools. Default $1M.",
        default: 1000000,
        minimum: 0,
      },
      min_apy: {
        type: "number",
        description: "Minimum 30-day mean APY percentage. Default 5%.",
        default: 5,
        minimum: 0,
      },
      stablecoin_only: {
        type: "boolean",
        description: "Return only stablecoin yield pools (no impermanent loss). Default false.",
      },
      yield_limit: {
        type: "integer",
        description: "Number of yield pools to return (1–30, default 15).",
        default: 15,
        minimum: 1,
        maximum: 30,
      },
      market_limit: {
        type: "integer",
        description: "Number of market movers per category (1–20, default 10).",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      include_equity: {
        type: "boolean",
        description: "Include equity market movers (US stocks). Default false — crypto only for speed.",
        default: false,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      yield_pools: {
        type: "array",
        description: "Top DeFi yield pools sorted by 30-day mean APY.",
        items: { type: "object" },
      },
      market: {
        type: "object",
        description: "Market movers snapshot.",
        properties: {
          crypto_gainers: { type: "array", items: { type: "object" } },
          crypto_losers:  { type: "array", items: { type: "object" } },
          equity_gainers: { type: "array", items: { type: "object" } },
          equity_losers:  { type: "array", items: { type: "object" } },
          equity_active:  { type: "array", items: { type: "object" } },
        },
      },
      cross_signals: {
        type: "array",
        description: "Per-pool cross-signal: 'boosted' (yield + price momentum), 'at_risk' (yield + sell-off), or 'neutral'.",
        items: {
          type: "object",
          properties: {
            rank:             { type: "integer" },
            pool_symbol:      { type: "string" },
            protocol:         { type: "string" },
            chain:            { type: "string" },
            apy_30d_mean:     { type: "number" },
            signal:           { type: "string", enum: ["boosted", "at_risk", "neutral"] },
            matched_symbol:   { type: ["string", "null"] },
            market_change_pct: { type: ["number", "null"] },
            interpretation:   { type: "string" },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          total_yield_pools:  { type: "integer" },
          boosted_pools:      { type: "integer" },
          at_risk_pools:      { type: "integer" },
          top_apy:            { type: "number" },
          top_crypto_gainer:  { type: "string" },
          top_crypto_loser:   { type: "string" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const yieldLimit   = Math.min(Math.max(parseInt(input.yield_limit  ?? "15", 10), 1), 30);
    const marketLimit  = Math.min(Math.max(parseInt(input.market_limit ?? "10", 10), 1), 20);
    const includeEquity = Boolean(input.include_equity);

    const [pools, cryptoMovers, equityMovers] = await Promise.all([
      fetchYields({
        chain:         input.chain    || null,
        protocol:      input.protocol || null,
        minTvl:        Number(input.min_tvl_usd ?? 1_000_000),
        minApy:        Number(input.min_apy ?? 5),
        stablecoinOnly: Boolean(input.stablecoin_only),
        limit:         yieldLimit,
      }),
      fetchCryptoMovers(marketLimit),
      includeEquity ? fetchEquityMovers(marketLimit) : Promise.resolve({}),
    ]);

    const crossSignals = buildCrossSignals(pools, cryptoMovers.gainers, cryptoMovers.losers);

    const boosted  = crossSignals.filter(s => s.signal === "boosted").length;
    const atRisk   = crossSignals.filter(s => s.signal === "at_risk").length;
    const topGainer = cryptoMovers.gainers?.[0]?.symbol ?? null;
    const topLoser  = cryptoMovers.losers?.[0]?.symbol  ?? null;

    return {
      yield_pools: pools,
      market: {
        crypto_gainers: cryptoMovers.gainers ?? [],
        crypto_losers:  cryptoMovers.losers  ?? [],
        ...(includeEquity ? {
          equity_gainers: equityMovers.gainers ?? [],
          equity_losers:  equityMovers.losers  ?? [],
          equity_active:  equityMovers.active  ?? [],
        } : {}),
      },
      cross_signals: crossSignals,
      summary: {
        total_yield_pools: pools.length,
        boosted_pools:     boosted,
        at_risk_pools:     atRisk,
        top_apy:           pools[0]?.apy_30d_mean ?? 0,
        top_crypto_gainer: topGainer ? `${topGainer} ${(cryptoMovers.gainers[0].change_pct ?? 0) >= 0 ? "+" : ""}${cryptoMovers.gainers[0].change_pct?.toFixed(2)}%` : null,
        top_crypto_loser:  topLoser  ? `${topLoser} ${cryptoMovers.losers[0].change_pct?.toFixed(2)}%`   : null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
