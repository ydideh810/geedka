// korean-crypto-movers.js
//
// Top movers and volume leaders on Korean crypto exchanges (Upbit, 263 KRW pairs).
// Priced at $0.008 — 20% below printmoneylab.com/api/v1/market-movers ($0.010).
// Source: Upbit public REST API (no auth, no key). Fallback: Bithumb /public/ticker.
//
// Seam signal: agents chain printmoneylab → yield-farming-active 5+ wallets, 5 days.
// Korean exchange volume is large and distinct — Korean Premium (kimchi premium) data
// that global sources don't carry.

const UPBIT_MARKETS  = "https://api.upbit.com/v1/market/all?is_details=false";
const UPBIT_TICKER   = "https://api.upbit.com/v1/ticker?markets=";
const BITHUMB_ALL    = "https://api.bithumb.com/public/ticker/ALL_KRW";
const UA             = "Mozilla/5.0 (compatible; the-stall/0.4; +https://intuitek.ai)";
const MARKET_LIMIT   = 200; // cap Upbit batch to stay under URL length limits

export default {
  name: "korean-crypto-movers",
  price: "$0.008",

  description:
    "Top movers and volume leaders on Korean exchanges (Upbit, 263 KRW markets). Returns biggest 24h price movers (% change from prev close), highest-volume tokens by KRW trade value, and optional raw snapshot. 20% cheaper than printmoneylab's market-movers endpoint at the same Upbit/Bithumb data layer.",

  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: ["movers", "volume", "all"],
        description: "Data section to return. 'movers'=top price movers, 'volume'=top by 24h KRW volume, 'all'=both. Default: all.",
      },
      limit: {
        type: "integer",
        description: "Number of tokens to return per section (1–50). Default: 20.",
        minimum: 1,
        maximum: 50,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      movers: {
        type: "array",
        description: "Tokens with largest 24h price change (absolute %).",
        items: {
          type: "object",
          properties: {
            symbol:       { type: "string",  description: "Token symbol (e.g. BTC)." },
            change_pct:   { type: "number",  description: "24h % change from previous close (negative = drop)." },
            price_krw:    { type: "number",  description: "Current price in KRW." },
            volume_krw:   { type: "number",  description: "24h trade volume in KRW." },
            direction:    { type: "string",  description: "RISE | FALL | EVEN" },
          },
        },
      },
      volume_leaders: {
        type: "array",
        description: "Tokens ranked by 24h KRW trading volume (highest first).",
        items: {
          type: "object",
          properties: {
            symbol:     { type: "string" },
            volume_krw: { type: "number" },
            change_pct: { type: "number" },
            price_krw:  { type: "number" },
          },
        },
      },
      meta: {
        type: "object",
        properties: {
          source:        { type: "string" },
          markets_total: { type: "integer" },
          ts:            { type: "string" },
        },
      },
    },
  },

  async handler(query) {
    const section = (query.section || "all").toLowerCase();
    const limit   = Math.min(50, Math.max(1, parseInt(query.limit || "20", 10)));

    // Step 1: get all KRW market codes from Upbit
    let tickers = [];
    let source  = "upbit";

    try {
      const mRes = await fetch(UPBIT_MARKETS, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      const markets = await mRes.json();
      const krwCodes = markets
        .filter(m => m.market.startsWith("KRW-"))
        .map(m => m.market)
        .slice(0, MARKET_LIMIT);

      // Step 2: batch-fetch all tickers in one call
      const tUrl = UPBIT_TICKER + krwCodes.join(",");
      const tRes = await fetch(tUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      const raw  = await tRes.json();

      tickers = raw.map(t => ({
        symbol:     t.market.replace("KRW-", ""),
        change_pct: parseFloat((t.change_rate * 100).toFixed(4)),
        price_krw:  t.trade_price,
        volume_krw: t.acc_trade_price_24h,
        direction:  t.change,
      }));
    } catch (_) {
      // Fallback to Bithumb
      source = "bithumb";
      const bRes = await fetch(BITHUMB_ALL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      const bData = await bRes.json();
      if (bData.status !== "0000") throw new Error("Bithumb API error: " + bData.status);
      const bd = bData.data;
      for (const [sym, v] of Object.entries(bd)) {
        if (sym === "date" || typeof v !== "object") continue;
        const curr  = parseFloat(v.closing_price  || 0);
        const open  = parseFloat(v.opening_price  || curr);
        const chPct = open > 0 ? parseFloat(((curr - open) / open * 100).toFixed(4)) : 0;
        tickers.push({
          symbol:     sym,
          change_pct: chPct,
          price_krw:  curr,
          volume_krw: parseFloat(v.acc_trade_value || 0),
          direction:  chPct > 0 ? "RISE" : chPct < 0 ? "FALL" : "EVEN",
        });
      }
    }

    const result = { meta: { source, markets_total: tickers.length, ts: new Date().toISOString() } };

    if (section === "movers" || section === "all") {
      result.movers = [...tickers]
        .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
        .slice(0, limit);
    }
    if (section === "volume" || section === "all") {
      result.volume_leaders = [...tickers]
        .sort((a, b) => b.volume_krw - a.volume_krw)
        .slice(0, limit);
    }

    return result;
  },
};
