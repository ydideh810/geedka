// crypto-equity-brief.js
//
// AI-synthesized cross-market intelligence brief: top crypto movers + equity
// performance combined in one call.
//
// Seam signal (cy_hb_3315, 2026-07-06): 14 wallets co-calling crypto-top-movers
// + stock-price-multi together over 30 days — the strongest co-call pair in the
// corpus. 8 of 14 wallets use ONLY those two caps (no synthesis). This cap
// replaces two round trips with one synthesized output.
//
// Upstream: CoinGecko public API (free) + Yahoo Finance v8 chart API (free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.
//
// Price: $2.00

const CG_BASE     = "https://api.coingecko.com/api/v3";
const YF_BASE     = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; myriad/4.84; +https://synaptiic.org)";
const SRC_TIMEOUT = 12_000;
const SYN_TIMEOUT = 25_000;
const MAX_CRYPTO  = 15;
const MAX_EQUITY  = 8;

const DEFAULT_EQUITY = ["SPY", "QQQ", "IWM", "BTC-USD"];

const STABLECOINS = new Set([
  "usdt","usdc","dai","busd","tusd","usdp","usdd","gusd","frax","lusd",
  "susd","cusd","fei","ust","alusd","musd","usds","pyusd","usde","usdx",
  "eurc","eur","eurt","jeur","steur",
]);

// ── crypto fetcher (mirrors crypto-top-movers) ──────────────────────────────

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
    market_cap_b: c.market_cap != null ? Math.round(c.market_cap / 1e7) / 100 : null,
    volume_24h_m: c.total_volume != null ? Math.round(c.total_volume / 1e5) / 10 : null,
    rank:       c.market_cap_rank,
  });

  const sorted = [...filtered].sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0));
  const gainers = sorted.slice(0, limit).map(fmt);
  const losers  = sorted.slice(-limit).reverse().map(fmt);

  const gd = global.data ?? {};
  return {
    gainers,
    losers,
    global: {
      total_market_cap_b: gd.total_market_cap?.usd != null ? Math.round(gd.total_market_cap.usd / 1e9) : null,
      btc_dominance: gd.market_cap_percentage?.btc != null ? Math.round(gd.market_cap_percentage.btc * 100) / 100 : null,
      market_cap_change_24h: gd.market_cap_change_percentage_24h_usd != null
        ? Math.round(gd.market_cap_change_percentage_24h_usd * 100) / 100
        : null,
    },
  };
}

// ── equity fetcher (mirrors portfolio-synthesis) ─────────────────────────────

async function fetchEquity(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid ticker" };
  try {
    const resp = await fetch(`${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(SRC_TIMEOUT),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker: sym, error: `no data (${data?.chart?.error?.code || "not_found"})` };
    const meta = result.meta;
    const prev = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const price = meta.regularMarketPrice;
    const diff  = price - prev;
    const pct   = prev !== 0 ? (diff / prev) * 100 : 0;
    return {
      ticker:     meta.symbol,
      name:       meta.longName || meta.shortName || null,
      price:      Math.round(price * 100) / 100,
      change_pct: Math.round(pct  * 100) / 100,
      change_abs: Math.round(diff * 100) / 100,
      volume:     meta.regularMarketVolume ?? null,
      currency:   meta.currency ?? "USD",
      error: null,
    };
  } catch (err) {
    return { ticker: sym, error: `fetch failed: ${err.message}` };
  }
}

// ── synthesis ─────────────────────────────────────────────────────────────────

async function synthesize(cryptoData, equityData, focus) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const topGainers = cryptoData.gainers.slice(0, 5)
    .map(c => `${c.symbol} +${c.change_24h}% @ $${c.price_usd}`).join(", ");
  const topLosers = cryptoData.losers.slice(0, 3)
    .map(c => `${c.symbol} ${c.change_24h}% @ $${c.price_usd}`).join(", ");
  const globalInfo = `Total market cap: $${cryptoData.global.total_market_cap_b}B | BTC dominance: ${cryptoData.global.btc_dominance}% | 24h change: ${cryptoData.global.market_cap_change_24h}%`;

  const equityBlock = equityData
    .filter(e => !e.error)
    .map(e => `${e.ticker}${e.name ? ` (${e.name})` : ""}: $${e.price} (${e.change_pct > 0 ? "+" : ""}${e.change_pct}%)`)
    .join("\n");

  const focusClause = focus ? ` Focus particularly on: ${focus}.` : "";
  const prompt = `You are a cross-market intelligence analyst. Synthesize a brief covering both crypto and equity market conditions right now.${focusClause}

CRYPTO MARKET:
Global: ${globalInfo}
Top Gainers: ${topGainers}
Top Losers: ${topLosers}

EQUITY MARKETS:
${equityBlock}

Respond ONLY with a JSON object:
{
  "cross_market_summary": "2-3 sentence synthesis of the relationship between crypto and equity market moves today",
  "market_regime": "risk-on | risk-off | diverging | correlated | mixed",
  "crypto_signal": "one-sentence interpretation of crypto momentum",
  "equity_signal": "one-sentence interpretation of equity moves",
  "key_themes": ["theme 1", "theme 2", "theme 3"],
  "risk_signals": ["signal 1", "signal 2"],
  "standout_crypto": "symbol with one-sentence reason",
  "standout_equity": "ticker with one-sentence reason",
  "tactical_note": "brief actionable takeaway for an agent or analyst monitoring both markets"
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 800,
      messages: [
        { role: "system", content: "You are a cross-market intelligence analyst. Respond with valid JSON only." },
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
  name:  "crypto-equity-brief",
  price: "$2.00",

  description:
    "AI-synthesized cross-market brief combining top crypto movers and equity performance — identifies how crypto and stock markets are moving together or diverging. Returns top crypto gainers/losers, equity prices, global crypto market stats, and a synthesized cross-market intelligence brief: market regime, key themes, risk signals, and standout assets in both markets. One call replaces separate crypto-top-movers + stock-price-multi lookups. Useful for agents doing portfolio monitoring, regime detection, or pre-trade context across crypto and traditional markets.",

  inputSchema: {
    type: "object",
    properties: {
      equity_tickers: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_EQUITY,
        description: `Up to ${MAX_EQUITY} equity or ETF tickers to include (e.g. ["SPY","NVDA","BTC-USD"]). Defaults to SPY, QQQ, IWM, BTC-USD if omitted.`,
      },
      crypto_limit: {
        type: "integer",
        minimum: 3,
        maximum: MAX_CRYPTO,
        description: `Number of top crypto gainers and losers to include in the analysis (default 5, max ${MAX_CRYPTO}).`,
      },
      focus: {
        type: "string",
        description: "Optional analytical focus (e.g. 'AI token momentum', 'macro risk-off signals', 'BTC dominance shift'). Narrows the synthesis lens.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      crypto: {
        type: "object",
        description: "Top crypto gainers, losers, and global market stats.",
      },
      equity: {
        type: "array",
        description: "Live equity/ETF price data per ticker.",
      },
      cross_market_summary: { type: "string" },
      market_regime:        { type: "string", description: "risk-on | risk-off | diverging | correlated | mixed" },
      crypto_signal:        { type: "string" },
      equity_signal:        { type: "string" },
      key_themes:           { type: "array",  items: { type: "string" } },
      risk_signals:         { type: "array",  items: { type: "string" } },
      standout_crypto:      { type: "string" },
      standout_equity:      { type: "string" },
      tactical_note:        { type: "string" },
      focus:                { type: "string" },
      ts:                   { type: "string" },
    },
  },

  async handler(query) {
    const cryptoLimit   = Math.min(MAX_CRYPTO, Math.max(3, parseInt(query.crypto_limit ?? 5, 10)));
    const equityRaw     = query.equity_tickers || DEFAULT_EQUITY;
    const equityTickers = equityRaw.slice(0, MAX_EQUITY).map(t => t.trim()).filter(Boolean);
    const focus         = query.focus ? query.focus.trim().slice(0, 120) : null;

    const [cryptoData, equityResults] = await Promise.all([
      fetchTopCrypto(cryptoLimit),
      Promise.all(equityTickers.map(fetchEquity)),
    ]);

    let synthesis = null;
    let synthError = null;
    try {
      synthesis = await synthesize(cryptoData, equityResults, focus);
    } catch (err) {
      synthError = err.message;
    }

    return {
      crypto:               cryptoData,
      equity:               equityResults,
      cross_market_summary: synthesis?.cross_market_summary  || null,
      market_regime:        synthesis?.market_regime         || null,
      crypto_signal:        synthesis?.crypto_signal         || null,
      equity_signal:        synthesis?.equity_signal         || null,
      key_themes:           synthesis?.key_themes            || [],
      risk_signals:         synthesis?.risk_signals          || [],
      standout_crypto:      synthesis?.standout_crypto       || null,
      standout_equity:      synthesis?.standout_equity       || null,
      tactical_note:        synthesis?.tactical_note         || null,
      focus,
      synthesis_error:      synthError || undefined,
      ts:                   new Date().toISOString(),
    };
  },
};
