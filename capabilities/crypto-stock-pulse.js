// crypto-stock-pulse.js
//
// Focused cross-asset analysis: top crypto movers + single equity deep dive,
// synthesized to answer "how does the current crypto regime affect this stock?"
//
// Seam signal (cy_hb_3319, 2026-07-06): 11 wallets co-calling crypto-top-movers
// + us-stock-price together over 30 days. Distinct from crypto-equity-brief
// (which uses stock-price-multi for basket/portfolio analysis). This cap
// targets investors tracking a specific company against the crypto macro backdrop
// — e.g., NVDA vs AI-token momentum, COIN vs BTC dominance, MSTR vs BTC regime.
//
// Upstream: CoinGecko public API (free) + Yahoo Finance v8 chart API (free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.
//
// Price: $1.25

const CG_BASE    = "https://api.coingecko.com/api/v3";
const YF_BASE    = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.86; +https://intuitek.ai)";
const SRC_TIMEOUT = 12_000;
const SYN_TIMEOUT = 25_000;
const MAX_CRYPTO  = 12;

const STABLECOINS = new Set([
  "usdt","usdc","dai","busd","tusd","usdp","usdd","gusd","frax","lusd",
  "susd","cusd","fei","ust","alusd","musd","usds","pyusd","usde","usdx",
  "eurc","eur","eurt","jeur","steur",
]);

// ── crypto fetcher ────────────────────────────────────────────────────────────

async function fetchTopCrypto(limit) {
  const [coinsResp, globalResp] = await Promise.all([
    fetch(`${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&price_change_percentage=24h`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(SRC_TIMEOUT),
    }),
    fetch(`${CG_BASE}/global`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(SRC_TIMEOUT),
    }),
  ]);

  const coins  = await coinsResp.json();
  const global = await globalResp.json();

  const filtered = coins.filter(c => {
    if (STABLECOINS.has(c.symbol.toLowerCase())) return false;
    const chg = Math.abs(c.price_change_percentage_24h ?? 0);
    const px  = c.current_price ?? 0;
    if (px >= 0.95 && px <= 1.05 && chg < 0.5) return false;
    return true;
  });

  const fmt = c => ({
    symbol:     c.symbol.toUpperCase(),
    name:       c.name,
    price_usd:  c.current_price,
    change_24h: Math.round((c.price_change_percentage_24h ?? 0) * 100) / 100,
    volume_24h_m: c.total_volume != null ? Math.round(c.total_volume / 1e5) / 10 : null,
    rank:       c.market_cap_rank,
  });

  const sorted   = [...filtered].sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0));
  const gainers  = sorted.slice(0, limit).map(fmt);
  const losers   = sorted.slice(-limit).reverse().map(fmt);

  const gd = global.data ?? {};
  return {
    gainers,
    losers,
    global: {
      total_market_cap_b:     gd.total_market_cap?.usd != null ? Math.round(gd.total_market_cap.usd / 1e9) : null,
      btc_dominance:          gd.market_cap_percentage?.btc != null ? Math.round(gd.market_cap_percentage.btc * 100) / 100 : null,
      market_cap_change_24h:  gd.market_cap_change_percentage_24h_usd != null
                                ? Math.round(gd.market_cap_change_percentage_24h_usd * 100) / 100
                                : null,
    },
  };
}

// ── single-stock fetcher ──────────────────────────────────────────────────────

async function fetchStock(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) throw new Error("Invalid ticker symbol");

  const resp = await fetch(
    `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) }
  );
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const errCode = data?.chart?.error?.code || "not_found";
    throw new Error(`No data for ${sym}: ${errCode}`);
  }

  const meta  = result.meta;
  const prev  = meta.chartPreviousClose ?? meta.regularMarketPrice;
  const price = meta.regularMarketPrice;
  const diff  = price - prev;
  const pct   = prev !== 0 ? (diff / prev) * 100 : 0;

  return {
    ticker:       meta.symbol,
    name:         meta.longName || meta.shortName || sym,
    price_usd:    Math.round(price * 100) / 100,
    change_pct:   Math.round(pct  * 100) / 100,
    change_usd:   Math.round(diff * 100) / 100,
    volume:       meta.regularMarketVolume ?? null,
    day_high:     meta.regularMarketDayHigh  ?? null,
    day_low:      meta.regularMarketDayLow   ?? null,
    week_52_high: meta.fiftyTwoWeekHigh ?? null,
    week_52_low:  meta.fiftyTwoWeekLow  ?? null,
    exchange:     meta.exchangeName    ?? null,
    currency:     meta.currency        ?? "USD",
    market_state: meta.marketState     ?? null,
  };
}

// ── synthesis ─────────────────────────────────────────────────────────────────

async function synthesize(cryptoData, stockData, focus) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const topGainers = cryptoData.gainers.slice(0, 5)
    .map(c => `${c.symbol} +${c.change_24h}% @ $${c.price_usd}`).join(", ");
  const topLosers = cryptoData.losers.slice(0, 3)
    .map(c => `${c.symbol} ${c.change_24h}% @ $${c.price_usd}`).join(", ");
  const globalInfo = `Market cap: $${cryptoData.global.total_market_cap_b}B | BTC dominance: ${cryptoData.global.btc_dominance}% | 24h change: ${cryptoData.global.market_cap_change_24h}%`;

  const stockInfo = `${stockData.ticker} (${stockData.name}): $${stockData.price_usd} (${stockData.change_pct > 0 ? "+" : ""}${stockData.change_pct}% today) | Vol: ${stockData.volume?.toLocaleString() ?? "N/A"} | 52w: $${stockData.week_52_low}–$${stockData.week_52_high}`;

  const focusClause = focus ? ` Focus particularly on: ${focus}.` : "";
  const prompt = `You are a cross-asset analyst specializing in the relationship between crypto markets and individual equities. Analyze whether the current crypto market conditions are likely correlated with, diverging from, or relevant to ${stockData.ticker} (${stockData.name}).${focusClause}

CRYPTO MARKET NOW:
${globalInfo}
Top Crypto Gainers: ${topGainers}
Top Crypto Losers: ${topLosers}

EQUITY:
${stockInfo}

Respond ONLY with a JSON object:
{
  "cross_asset_summary": "2-3 sentence synthesis: how do today's crypto moves relate to this stock's current action?",
  "correlation_regime": "correlated | diverging | crypto-leading | equity-leading | uncorrelated",
  "crypto_context": "one sentence on the dominant crypto market theme today",
  "stock_context": "one sentence on what the stock's move suggests",
  "key_driver": "the single most likely shared driver (or explain divergence)",
  "risk_signals": ["signal 1", "signal 2"],
  "opportunity_note": "brief note on what this cross-asset setup implies for positioning or monitoring",
  "watch_level": "a specific price or event to watch for this stock given the crypto backdrop"
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: "You are a cross-asset analyst. Respond with valid JSON only." },
        { role: "user",   content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status);
    throw new Error(`OpenAI API ${resp.status}: ${String(err).slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) return JSON.parse(m[0]);
    throw new Error("Synthesis did not return valid JSON");
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

export default {
  name:  "crypto-stock-pulse",
  price: "$1.25",

  description:
    "Focused cross-asset analysis: top crypto movers + single equity deep dive synthesized in one call. Answers 'how does the current crypto regime affect this specific stock?' Returns top crypto gainers/losers, global market stats, individual stock data (price, change, volume, 52-week range), and GPT-4o-mini synthesis covering correlation regime, key shared driver, risk signals, and a watch level. Ideal for monitoring a specific company (e.g. COIN, MSTR, NVDA) against the crypto macro backdrop. Replaces separate crypto-top-movers + us-stock-price lookups. $1.25/call.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker to analyze against the crypto backdrop (e.g. COIN, MSTR, NVDA, AAPL). Defaults to SPY if omitted.",
      },
      crypto_limit: {
        type: "integer",
        minimum: 3,
        maximum: MAX_CRYPTO,
        description: `Number of top crypto gainers and losers to include (default 5, max ${MAX_CRYPTO}).`,
      },
      focus: {
        type: "string",
        description: "Optional analytical focus (e.g. 'BTC dominance effect on MSTR', 'AI token rally vs NVDA', 'risk-off signal for fintech'). Narrows the synthesis.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      crypto:               { type: "object", description: "Top crypto gainers, losers, and global market stats." },
      stock:                { type: "object", description: "Live equity data for the requested ticker." },
      cross_asset_summary:  { type: "string" },
      correlation_regime:   { type: "string", description: "correlated | diverging | crypto-leading | equity-leading | uncorrelated" },
      crypto_context:       { type: "string" },
      stock_context:        { type: "string" },
      key_driver:           { type: "string" },
      risk_signals:         { type: "array", items: { type: "string" } },
      opportunity_note:     { type: "string" },
      watch_level:          { type: "string" },
      focus:                { type: "string" },
      ts:                   { type: "string" },
    },
  },

  async handler(query) {
    const ticker     = (query.ticker || "SPY").trim().toUpperCase();
    const cryptoLimit = Math.min(MAX_CRYPTO, Math.max(3, parseInt(query.crypto_limit ?? 5, 10)));
    const focus      = query.focus ? query.focus.trim().slice(0, 120) : null;

    const [cryptoData, stockData] = await Promise.all([
      fetchTopCrypto(cryptoLimit),
      fetchStock(ticker),
    ]);

    let synthesis  = null;
    let synthError = null;
    try {
      synthesis = await synthesize(cryptoData, stockData, focus);
    } catch (err) {
      synthError = err.message;
    }

    return {
      crypto:              cryptoData,
      stock:               stockData,
      cross_asset_summary: synthesis?.cross_asset_summary  || null,
      correlation_regime:  synthesis?.correlation_regime   || null,
      crypto_context:      synthesis?.crypto_context       || null,
      stock_context:       synthesis?.stock_context        || null,
      key_driver:          synthesis?.key_driver           || null,
      risk_signals:        synthesis?.risk_signals         || [],
      opportunity_note:    synthesis?.opportunity_note     || null,
      watch_level:         synthesis?.watch_level          || null,
      focus,
      synthesis_error:     synthError || undefined,
      ts:                  new Date().toISOString(),
    };
  },
};
