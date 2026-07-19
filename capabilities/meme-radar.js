// meme-radar.js
//
// Solana meme coin quality-volume radar via DexScreener free API.
//
// Seam origin: api.seerium.xyz/v1/meme-radar/quality-volume — 6 distinct wallets,
// confirmed organic demand. STALL had no Solana meme coverage; seerium charges
// x402 per call. This cap sources the same data tier via DexScreener (free, no key).
//
// Returns trending Solana tokens ranked by a quality score that rewards organic
// volume (high buy-ratio), consistent activity, and real liquidity depth.
// [REDACTED]5, 2026-06-11.

const DEXSCREENER_BOOST   = "https://api.dexscreener.com/token-boosts/top/v1";
const DEXSCREENER_TOKENS  = "https://api.dexscreener.com/latest/dex/tokens";
const UA                  = "Mozilla/5.0 (compatible; myriad/4.63; +https://synaptiic.org)";
const TIMEOUT             = 20_000;

// Quality score: rewards buy pressure, liquidity depth, volume consistency.
function qualityScore(pair) {
  const h24Buys  = pair.txns?.h24?.buys  ?? 0;
  const h24Sells = pair.txns?.h24?.sells ?? 1;
  const buyRatio = h24Buys / (h24Buys + h24Sells);                  // 0→1, higher = more buyers

  const volH24   = pair.volume?.h24  ?? 0;
  const volH6    = pair.volume?.h6   ?? 0;
  const volH1    = pair.volume?.h1   ?? 0;
  const consistency = volH24 > 0
    ? Math.min(1, (volH6 / (volH24 / 4)) * 0.5 + (volH1 / (volH24 / 24)) * 0.5)
    : 0;                                                             // recent vol vs expected

  const liq      = pair.liquidity?.usd ?? 0;
  const mcap     = pair.marketCap ?? pair.fdv ?? 1;
  const liqRatio = Math.min(1, liq / mcap);                         // deeper liq = more credible

  return (buyRatio * 0.45) + (consistency * 0.35) + (liqRatio * 0.20);
}

export default {
  name:  "meme-radar",
  price: "$0.039",

  description:
    "Solana meme coin quality-volume radar. Returns trending tokens ranked by a quality score that rewards organic buy pressure, liquidity depth, and volume consistency. Filters out low-liquidity rugs. Use for meme coin discovery, social-momentum confirmation, or pump detection. Data: DexScreener free API; no API key required.",

  inputSchema: {
    type:       "object",
    properties: {
      limit: {
        type:        "integer",
        minimum:     1,
        maximum:     30,
        description: "Max tokens to return (1–30). Default: 10.",
      },
      min_liquidity_usd: {
        type:        "number",
        minimum:     0,
        description: "Minimum pool liquidity in USD. Default: 1000 (filters micro-rugs).",
      },
      min_volume_h24: {
        type:        "number",
        minimum:     0,
        description: "Minimum 24h trading volume in USD. Default: 5000.",
      },
      sort_by: {
        type:        "string",
        enum:        ["quality", "volume_h24", "price_change_h24", "market_cap"],
        description: "Ranking field. Default: quality (composite buy-pressure + consistency + liquidity score).",
      },
    },
    required:             [],
    additionalProperties: false,
  },

  outputSchema: {
    type:       "object",
    properties: {
      tokens: {
        type:  "array",
        items: {
          type:       "object",
          properties: {
            name:             { type: "string",           description: "Token name." },
            symbol:           { type: "string",           description: "Token ticker symbol." },
            address:          { type: "string",           description: "Solana token mint address." },
            price_usd:        { type: ["number","null"],  description: "Current price in USD." },
            market_cap_usd:   { type: ["number","null"],  description: "Market cap in USD." },
            liquidity_usd:    { type: ["number","null"],  description: "Pool liquidity in USD." },
            volume_h24:       { type: ["number","null"],  description: "24h trading volume USD." },
            volume_h1:        { type: ["number","null"],  description: "1h trading volume USD." },
            price_change_h24: { type: ["number","null"],  description: "24h price change %." },
            price_change_h1:  { type: ["number","null"],  description: "1h price change %." },
            buys_h24:         { type: ["integer","null"], description: "Buy-side transactions last 24h." },
            sells_h24:        { type: ["integer","null"], description: "Sell-side transactions last 24h." },
            buy_ratio:        { type: ["number","null"],  description: "Buys / (buys + sells). >0.6 = buyer demand." },
            quality_score:    { type: "number",           description: "Composite quality score (0–1). Higher = more organic, liquid, consistent." },
            dex:              { type: "string",           description: "Primary DEX (e.g. pumpswap, raydium)." },
            pair_url:         { type: "string",           description: "DexScreener pair URL." },
            twitter_url:      { type: ["string","null"],  description: "Twitter/X link if available." },
            website:          { type: ["string","null"],  description: "Project website if available." },
          },
        },
      },
      total_candidates: { type: "integer", description: "Tokens evaluated before filters applied." },
      filters_applied:  { type: "object",  description: "Active filter values used." },
      sort_by:          { type: "string",  description: "Sort field used." },
      fetched_at:       { type: "string" },
    },
  },

  async handler(query) {
    const limit      = Math.min(Math.max(parseInt(query.limit ?? "10", 10), 1), 30);
    const minLiq     = parseFloat(query.min_liquidity_usd ?? "1000");
    const minVol     = parseFloat(query.min_volume_h24    ?? "5000");
    const sortBy     = query.sort_by ?? "quality";

    // 1. Get top boosted tokens from DexScreener
    const boostResp = await fetch(DEXSCREENER_BOOST, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!boostResp.ok) throw new Error(`DexScreener boost API HTTP ${boostResp.status}`);
    const boosted = await boostResp.json();

    // Filter to Solana
    const solana = (Array.isArray(boosted) ? boosted : []).filter(t => t.chainId === "solana");
    if (solana.length === 0) throw new Error("No Solana tokens in DexScreener boost feed");

    // 2. Batch-fetch pair data (up to 30 tokens, DexScreener allows comma-separated)
    const addresses = solana.map(t => t.tokenAddress).join(",");
    const pairResp  = await fetch(`${DEXSCREENER_TOKENS}/${addresses}`, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!pairResp.ok) throw new Error(`DexScreener tokens API HTTP ${pairResp.status}`);
    const pairData = await pairResp.json();

    // Build map: tokenAddress → best pair (highest liquidity)
    const pairMap = new Map();
    for (const pair of (pairData.pairs ?? [])) {
      const addr = pair.baseToken?.address ?? "";
      const existing = pairMap.get(addr);
      if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
        pairMap.set(addr, pair);
      }
    }

    // 3. Merge boost metadata + pair data, apply filters, score
    const candidates = [];
    for (const t of solana) {
      const pair = pairMap.get(t.tokenAddress);
      if (!pair) continue;

      const liq  = pair.liquidity?.usd ?? 0;
      const vol  = pair.volume?.h24    ?? 0;
      if (liq < minLiq || vol < minVol) continue;

      const h24Buys  = pair.txns?.h24?.buys  ?? 0;
      const h24Sells = pair.txns?.h24?.sells ?? 0;
      const total    = h24Buys + h24Sells;
      const buyRatio = total > 0 ? h24Buys / total : null;
      const score    = qualityScore(pair);

      const twitter = (t.links ?? []).find(l => l.type === "twitter")?.url ?? null;
      const website = (t.links ?? []).find(l => !l.type && l.url)?.url ?? null;

      candidates.push({
        name:             pair.baseToken?.name   ?? t.description?.split(" ")[0] ?? "?",
        symbol:           pair.baseToken?.symbol ?? "?",
        address:          t.tokenAddress,
        price_usd:        parseFloat(pair.priceUsd) || null,
        market_cap_usd:   pair.marketCap ?? pair.fdv ?? null,
        liquidity_usd:    Math.round(liq),
        volume_h24:       Math.round(vol),
        volume_h1:        Math.round(pair.volume?.h1 ?? 0),
        price_change_h24: pair.priceChange?.h24  ?? null,
        price_change_h1:  pair.priceChange?.h1   ?? null,
        buys_h24:         h24Buys  || null,
        sells_h24:        h24Sells || null,
        buy_ratio:        buyRatio !== null ? Math.round(buyRatio * 1000) / 1000 : null,
        quality_score:    Math.round(score * 1000) / 1000,
        dex:              pair.dexId ?? "unknown",
        pair_url:         pair.url   ?? `https://dexscreener.com/solana/${t.tokenAddress}`,
        twitter_url:      twitter,
        website:          website,
      });
    }

    // 4. Sort
    const sortFn = {
      quality:          (a, b) => b.quality_score    - a.quality_score,
      volume_h24:       (a, b) => (b.volume_h24 ?? 0)   - (a.volume_h24 ?? 0),
      price_change_h24: (a, b) => (b.price_change_h24 ?? 0) - (a.price_change_h24 ?? 0),
      market_cap:       (a, b) => (b.market_cap_usd ?? 0)   - (a.market_cap_usd ?? 0),
    };
    candidates.sort(sortFn[sortBy] ?? sortFn.quality);

    return {
      tokens:           candidates.slice(0, limit),
      total_candidates: candidates.length,
      filters_applied:  { min_liquidity_usd: minLiq, min_volume_h24: minVol, chain: "solana" },
      sort_by:          sortBy,
      fetched_at:       new Date().toISOString(),
    };
  },
};
