// token-top-holders.js
//
// Returns top holders for any Ethereum ERC-20 token with concentration analysis.
// Seams against x402.ottoai.services /token-top-holders ($0.020) — 25% discount.
// Also seams against dataendpoints-production.up.railway.app /token-top-holders.
// Free upstream: Ethplorer API (freekey tier, no registration required).
// Priced at $0.015/call.

const ETHPLORER  = "https://api.ethplorer.io";
const FREE_KEY   = "freekey";
const UA         = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";
const TIMEOUT    = 15_000;

async function ethplorerFetch(path) {
  const url = `${ETHPLORER}${path}${path.includes("?") ? "&" : "?"}apiKey=${FREE_KEY}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`Ethplorer HTTP ${resp.status} at ${path}`);
  return resp.json();
}

export default {
  name: "token-top-holders",
  price: "$0.015",

  description:
    "Returns top holders for any Ethereum ERC-20 token (by contract address), with concentration metrics. Includes each holder's share%, human-readable balance (with decimal conversion), and whale analysis. Reports: top-10 concentration, whale count (>1% holders), Herfindahl-Hirschman Index for concentration risk. Use to assess token distribution health, identify institutional-grade holders, or screen for rug-pull risk before entering a position.",

  inputSchema: {
    type: "object",
    required: ["token_address"],
    properties: {
      token_address: {
        type: "string",
        description: "Ethereum ERC-20 contract address (0x-prefixed). Example: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' for USDC.",
      },
      limit: {
        type: "integer",
        description: "Number of top holders to return. Default 50, max 100.",
        default: 50,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      token: {
        type: "object",
        properties: {
          address:       { type: "string" },
          symbol:        { type: "string" },
          name:          { type: "string" },
          decimals:      { type: "integer" },
          total_supply:  { type: "number" },
          holders_count: { type: "integer" },
          price_usd:     { type: "number" },
          market_cap_usd:{ type: "number" },
        },
      },
      concentration: {
        type: "object",
        properties: {
          top1_pct:       { type: "number" },
          top5_pct:       { type: "number" },
          top10_pct:      { type: "number" },
          whale_count:    { type: "integer" },
          hhi:            { type: "number" },
          risk_label:     { type: "string" },
        },
      },
      holders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank:           { type: "integer" },
            address:        { type: "string" },
            share_pct:      { type: "number" },
            balance:        { type: "number" },
            balance_raw:    { type: "string" },
          },
        },
      },
      timestamp: { type: "string" },
    },
  },

  async handler(query) {
    const raw     = (query.token_address ?? "").trim().toLowerCase();
    if (!raw.startsWith("0x") || raw.length !== 42)
      throw new Error("token_address must be a 42-character 0x Ethereum address");

    const limit = Math.min(parseInt(query.limit ?? 50, 10) || 50, 100);

    // Fetch token info + top holders in parallel
    const [info, holdersResp] = await Promise.all([
      ethplorerFetch(`/getTokenInfo/${raw}`),
      ethplorerFetch(`/getTopTokenHolders/${raw}?limit=${limit}`),
    ]);

    const decimals = parseInt(info.decimals ?? "18", 10) || 18;
    const divisor  = Math.pow(10, decimals);
    const totalSupply = (info.totalSupply ?? "0") / divisor;

    const rawHolders = holdersResp.holders ?? [];
    const holders = rawHolders.map((h, i) => ({
      rank:        i + 1,
      address:     h.address ?? "",
      share_pct:   typeof h.share === "number" ? +h.share.toFixed(4) : 0,
      balance:     +((parseFloat(h.rawBalance ?? h.balance ?? 0) / divisor).toFixed(6)),
      balance_raw: String(h.rawBalance ?? h.balance ?? "0"),
    }));

    // Concentration metrics
    const top1  = holders.slice(0, 1).reduce((s, h) => s + h.share_pct, 0);
    const top5  = holders.slice(0, 5).reduce((s, h) => s + h.share_pct, 0);
    const top10 = holders.slice(0, 10).reduce((s, h) => s + h.share_pct, 0);
    const whaleCount = holders.filter(h => h.share_pct >= 1).length;
    // HHI: sum of squared market shares (0–10000 scale)
    const hhi = +holders.reduce((s, h) => s + Math.pow(h.share_pct, 2), 0).toFixed(2);
    const risk_label =
      hhi > 2500 ? "HIGH_CONCENTRATION" :
      hhi > 1000 ? "MODERATE_CONCENTRATION" :
      "DISPERSED";

    const priceInfo = info.price ?? {};

    return {
      token: {
        address:        raw,
        symbol:         info.symbol ?? "",
        name:           info.name ?? "",
        decimals,
        total_supply:   +totalSupply.toFixed(2),
        holders_count:  parseInt(info.holdersCount ?? 0, 10) || 0,
        price_usd:      typeof priceInfo.rate === "number" ? +priceInfo.rate.toFixed(6) : null,
        market_cap_usd: typeof priceInfo.marketCapUsd === "number" ? +priceInfo.marketCapUsd.toFixed(0) : null,
      },
      concentration: {
        top1_pct:    +top1.toFixed(2),
        top5_pct:    +top5.toFixed(2),
        top10_pct:   +top10.toFixed(2),
        whale_count: whaleCount,
        hhi,
        risk_label,
      },
      holders,
      timestamp: new Date().toISOString(),
    };
  },
};
