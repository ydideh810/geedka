// crypto-news-impact.js
//
// Latest cryptocurrency news headlines from CoinDesk with asset price correlation.
// Extracts coin mentions, fetches live prices via CoinGecko, and derives impact
// signals from title keywords and article categories.
//
// Seam: orbisapi.com/proxy/crypto-news-impact-api
//       2,482 settlements/week, 74 payers — highest unique-payer count in the bazaar.
//       Wide payer base signals agent demand across portfolio, trading, and research tasks.
//
// Upstream:
//   - CoinDesk RSS (free, no key, TTL 5 min)
//   - CoinGecko simple/price (free, no key, 30 req/min)

const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";
const CG_PRICE     = "https://api.coingecko.com/api/v3/simple/price";
const UA           = "Mozilla/5.0 (compatible; the-stall/2.9; +https://intuitek.ai)";
const TIMEOUT_MS   = 15000;

// keyword (lowercase) → CoinGecko id
const COIN_MAP = {
  bitcoin: "bitcoin", btc: "bitcoin",
  ethereum: "ethereum", eth: "ethereum", ether: "ethereum",
  solana: "solana", sol: "solana",
  xrp: "ripple", ripple: "ripple",
  dogecoin: "dogecoin", doge: "dogecoin",
  cardano: "cardano", ada: "cardano",
  polkadot: "polkadot", dot: "polkadot",
  avalanche: "avalanche-2", avax: "avalanche-2",
  chainlink: "chainlink", link: "chainlink",
  polygon: "matic-network", matic: "matic-network",
  uniswap: "uniswap", uni: "uniswap",
  "shiba inu": "shiba-inu", shib: "shiba-inu",
  litecoin: "litecoin", ltc: "litecoin",
  stellar: "stellar", xlm: "stellar",
  monero: "monero", xmr: "monero",
  tron: "tron", trx: "tron",
  cosmos: "cosmos", atom: "cosmos",
  near: "near", "near protocol": "near",
  filecoin: "filecoin", fil: "filecoin",
  hedera: "hedera-hashgraph", hbar: "hedera-hashgraph",
  aptos: "aptos", apt: "aptos",
  sui: "sui",
  injective: "injective-protocol", inj: "injective-protocol",
  arbitrum: "arbitrum", arb: "arbitrum",
  optimism: "optimism",
  "binance coin": "binancecoin", bnb: "binancecoin",
  toncoin: "the-open-network", ton: "the-open-network",
  pepe: "pepe",
};

const BEARISH_WORDS = [
  "crash","drop","fall","sell","hack","ban","reject","fraud","dump",
  "collapse","panic","fear","loss","fine","seized","suspend","liquidat",
  "bankrupt","warning","probe","lawsuit","exploit","vulnerability","flaw",
];
const BULLISH_WORDS = [
  "surge","rally","soar","rise","bull","approv","launch","adoption","record",
  "milestone","buy","upgrade","partnership","integrat","fund","invest","etf",
  "breakthrough","gain","ath","high","clear","hurdle","public","ipo",
];

function deriveSentiment(title, categories) {
  const text = (title + " " + categories.join(" ")).toLowerCase();
  let score = 0;
  for (const w of BEARISH_WORDS) if (text.includes(w)) score -= 1;
  for (const w of BULLISH_WORDS) if (text.includes(w)) score += 1;
  if (score > 0) return "bullish";
  if (score < 0) return "bearish";
  return "neutral";
}

function extractCoins(title, categories) {
  const text = (title + " " + categories.join(" ")).toLowerCase();
  const found = new Set();
  // Multi-word keys first (longer matches take priority)
  const keys = Object.keys(COIN_MAP).sort((a, b) => b.length - a.length);
  for (const kw of keys) {
    if (text.includes(kw)) found.add(COIN_MAP[kw]);
    if (found.size >= 5) break;
  }
  return [...found];
}

function parseIso(rfc822) {
  try { return new Date(rfc822).toISOString(); } catch { return null; }
}

function parseRss(xml) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const chunk = m[1];
    const get = (tag) => {
      const r = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`
      );
      const rm = r.exec(chunk);
      return rm ? (rm[1] ?? rm[2] ?? "").trim() : "";
    };
    const cats = [
      ...chunk.matchAll(/<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/category>/g),
    ].map((r) => r[1].trim());
    items.push({ title: get("title"), link: get("link"), pubDate: get("pubDate"), cats });
  }
  return items;
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from CoinDesk RSS`);
  return resp.text();
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from CoinGecko`);
  return resp.json();
}

export default {
  name: "crypto-news-impact",
  price: "$0.059",

  description:
    "Latest cryptocurrency news headlines from CoinDesk with live price correlation for mentioned assets. Returns up to 10 recent articles — each with title, URL, published timestamp, primary category, and a keyword-derived sentiment signal (bullish/bearish/neutral). For each article, identified crypto assets (BTC, ETH, SOL, etc.) are enriched with current USD price and 24h price change. Use before any crypto research, portfolio review, or market sentiment task to understand what news is driving the market right now. Data: CoinDesk RSS (TTL 5 min) + CoinGecko prices.",

  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Number of headlines to return (1–20). Default: 10.",
        default: 10,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      headlines: {
        type: "array",
        description: "Recent crypto news articles enriched with price data.",
        items: {
          type: "object",
          properties: {
            title:        { type: "string",  description: "Article headline." },
            url:          { type: "string",  description: "Full article URL." },
            published_at: { type: ["string","null"], description: "ISO-8601 publish timestamp." },
            category:     { type: ["string","null"], description: "Primary article category (Markets, Tech, Policy, Finance, …)." },
            sentiment:    { type: "string",  enum: ["bullish","bearish","neutral"], description: "Keyword-derived impact signal from headline and category text." },
            coins: {
              type: "array",
              description: "Crypto assets mentioned in the headline, with live prices.",
              items: {
                type: "object",
                properties: {
                  id:         { type: "string",          description: "CoinGecko asset ID (e.g. bitcoin, ethereum)." },
                  price_usd:  { type: ["number","null"], description: "Current USD price." },
                  change_24h: { type: ["number","null"], description: "24-hour price change %." },
                },
              },
            },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const limit = Math.min(Math.max(parseInt(query?.limit ?? 10, 10) || 10, 1), 20);

    const xml = await fetchText(COINDESK_RSS);
    const rawItems = parseRss(xml).slice(0, limit);

    const allCoinIds = new Set();
    const parsed = rawItems.map((item) => {
      const coinIds = extractCoins(item.title, item.cats);
      coinIds.forEach((id) => allCoinIds.add(id));
      return { ...item, coinIds };
    });

    // Batch price fetch — one CoinGecko call for all mentioned coins
    let prices = {};
    if (allCoinIds.size > 0) {
      try {
        const ids = [...allCoinIds].join(",");
        prices = await fetchJson(
          `${CG_PRICE}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
        );
      } catch {
        // Price fetch failure → headlines return without price data; never crash
      }
    }

    const headlines = parsed.map((item) => ({
      title:        item.title,
      url:          item.link,
      published_at: parseIso(item.pubDate),
      category:     item.cats[0] ?? null,
      sentiment:    deriveSentiment(item.title, item.cats),
      coins: item.coinIds.map((id) => ({
        id,
        price_usd:  prices[id]?.usd ?? null,
        change_24h: prices[id]?.usd_24h_change != null
          ? Math.round(prices[id].usd_24h_change * 100) / 100
          : null,
      })),
    }));

    return { headlines, ts: new Date().toISOString() };
  },
};
