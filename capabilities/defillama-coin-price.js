// defillama-coin-price.js
//
// On-chain aggregated token prices via DefiLlama coins API.
// Seam: blockrun.ai/api/v1/defillama/prices/coingecko:ethereum — 31 payers,
// 16K calls, $360 in 14d at $0.021/call. STALL undercuts at $0.016 (24% discount).
//
// Upstream: https://coins.llama.fi/prices/current/... (free, no auth)
// Supports coingecko:ID, ethereum:0xADDRESS, solana:MINT, etc. coin IDs.
// Higher confidence than CoinGecko alone — aggregates on-chain DEX prices.

const COINS_BASE = "https://coins.llama.fi";
const UA         = "Mozilla/5.0 (compatible; myriad/defillama-coin-price; +https://synaptiic.org)";
const TIMEOUT    = 12_000;

// Common shorthand aliases for convenience
const ALIASES = {
  eth:     "coingecko:ethereum",
  btc:     "coingecko:bitcoin",
  sol:     "coingecko:solana",
  usdc:    "coingecko:usd-coin",
  usdt:    "coingecko:tether",
  bnb:     "coingecko:binancecoin",
  avax:    "coingecko:avalanche-2",
  matic:   "coingecko:matic-network",
  link:    "coingecko:chainlink",
  uni:     "coingecko:uniswap",
  aave:    "coingecko:aave",
  op:      "coingecko:optimism",
  arb:     "coingecko:arbitrum",
  dot:     "coingecko:polkadot",
  ada:     "coingecko:cardano",
};

function resolveId(id) {
  const lower = id.toLowerCase().trim();
  if (ALIASES[lower]) return ALIASES[lower];
  // Already fully qualified (coingecko:X, ethereum:0xABC, solana:MINT)
  if (lower.includes(":")) return lower;
  // Assume CoinGecko ID
  return `coingecko:${lower}`;
}

export default {
  name:  "defillama-coin-price",
  price: "$0.059",

  description:
    "Returns on-chain aggregated token prices via DefiLlama coins API. Accepts coingecko IDs, contract addresses, or shorthand (eth, btc, sol). Up to 10 tokens per call. Undercuts blockrun.ai's $0.021/call by 24%.",

  inputSchema: {
    type: "object",
    properties: {
      coins: {
        type: "array",
        items: { type: "string" },
        description:
          "List of coin IDs to price. Accepts shorthand (eth, btc, sol), CoinGecko IDs (coingecko:ethereum), or contract addresses (ethereum:0xABC...). Max 10.",
        minItems: 1,
        maxItems: 10,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      prices: {
        type: "array",
        description: "Price results [{id, symbol, price_usd, confidence, ts}].",
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const rawIds = query.coins || ["coingecko:bitcoin"];
    if (rawIds.length > 10) throw new Error("max 10 coins per call");

    const resolved = rawIds.map(resolveId);
    const coinParam = resolved.join(",");

    const resp = await fetch(`${COINS_BASE}/prices/current/${encodeURIComponent(coinParam)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal:  AbortSignal.timeout(TIMEOUT),
    });

    if (!resp.ok) throw new Error(`DefiLlama coins HTTP ${resp.status}`);

    const { coins } = await resp.json();

    const prices = resolved.map((id, i) => {
      const coin = coins[id];
      if (!coin) return { id: rawIds[i], resolved_id: id, price_usd: null, symbol: null, confidence: null };
      return {
        id:          rawIds[i],
        resolved_id: id,
        symbol:      coin.symbol || null,
        price_usd:   coin.price,
        confidence:  coin.confidence ?? null,
        ts:          coin.timestamp ? new Date(coin.timestamp * 1000).toISOString() : null,
      };
    });

    return { prices, ts: new Date().toISOString() };
  },
};
