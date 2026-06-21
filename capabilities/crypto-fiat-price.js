// crypto-fiat-price.js
//
// Cryptocurrency price in any fiat currency — via CoinGecko public API (free, no key).
// Supports 80+ fiat currencies (JPY, EUR, CNY, GBP, KRW, INR, AUD, BRL, etc.)
// and 10,000+ cryptocurrencies by CoinGecko ID or common ticker.
//
// Seam: api.myceliasignal.com/oracle/price/btc/jpy — $0.098/call for BTC/JPY only.
// We return any coin in any fiat at $0.015 (85% undercut, universal coverage).

const CG_URL    = "https://api.coingecko.com/api/v3/simple/price";
const UA        = "Mozilla/5.0 (compatible; the-stall/3.5; +https://intuitek.ai)";
const TIMEOUT_MS = 10000;

// Common ticker aliases → CoinGecko IDs
const ALIASES = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", bnb: "binancecoin",
  xrp: "ripple", ada: "cardano", doge: "dogecoin", avax: "avalanche-2",
  dot: "polkadot", link: "chainlink", matic: "matic-network",
  uni: "uniswap", ltc: "litecoin", atom: "cosmos", near: "near",
  arb: "arbitrum", op: "optimism", usdc: "usd-coin", usdt: "tether",
};

function resolveId(coin) {
  const lower = coin.toLowerCase().trim();
  return ALIASES[lower] || lower;
}

export default {
  name:  "crypto-fiat-price",
  price: "$0.039",

  description:
    "Cryptocurrency price in any fiat currency — JPY, EUR, CNY, GBP, KRW, INR, AUD, BRL, or 80+ more. Input a coin name or CoinGecko ID (bitcoin, ethereum, solana, btc, eth, sol, etc.) and one or more currency codes. Returns current price, 24h percent change per currency, and last updated timestamp. Free upstream: CoinGecko public API (no key). 85% below specialized fiat oracles. Useful for Asian/European market agents, cross-border DeFi pricing, and multi-currency portfolio valuation.",

  inputSchema: {
    type: "object",
    properties: {
      coin: {
        type: "string",
        description: "Cryptocurrency ID or common ticker (e.g. bitcoin, ethereum, solana, btc, eth, sol, bnb, xrp). CoinGecko IDs also accepted.",
      },
      currencies: {
        type: "string",
        description: "Comma-separated fiat codes to return (e.g. jpy,eur,cny or usd,gbp,krw,inr). Default: usd,jpy,eur.",
        default: "usd,jpy,eur",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      coin:         { type: "string", description: "CoinGecko ID used" },
      prices:       { type: "object", description: "Price per fiat code (e.g. {usd: 60000, jpy: 9600000})" },
      changes_24h:  { type: "object", description: "24h % change per fiat code" },
      last_updated: { type: "string", description: "ISO-8601 timestamp of last price update" },
    },
  },

  async handler(query) {
    const coinInput = (query.coin || "bitcoin").trim();

    const coinId = resolveId(coinInput);
    const currencyList = (query.currencies || "usd,jpy,eur")
      .split(",").map(c => c.trim().toLowerCase()).filter(Boolean).join(",");

    const url = `${CG_URL}?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(currencyList)}&include_24hr_change=true&include_last_updated_at=true`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`CoinGecko API error: HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data[coinId]) {
      throw new Error(`Coin "${coinInput}" (ID: "${coinId}") not found on CoinGecko. Try using the full CoinGecko ID (e.g. "bitcoin" not "BTC").`);
    }

    const raw = data[coinId];
    const prices = {};
    const changes = {};
    const currencies = currencyList.split(",");

    for (const c of currencies) {
      if (raw[c] !== undefined) {
        prices[c] = raw[c];
      }
      if (raw[`${c}_24h_change`] !== undefined) {
        changes[c] = parseFloat(raw[`${c}_24h_change`].toFixed(4));
      }
    }

    const lastUpdated = raw.last_updated_at
      ? new Date(raw.last_updated_at * 1000).toISOString()
      : null;

    return {
      coin: coinId,
      prices,
      changes_24h: changes,
      last_updated: lastUpdated,
    };
  },
};
