// crypto-brief.js
//
// AI-synthesized cryptocurrency market intelligence brief.
//
// Assembles 12 signals: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, UNI,
// MATIC, and ATOM — price, 24h change, market cap, and 24h volume from
// CoinGecko (free tier, no auth). Also fetches the Alternative.me Crypto Fear
// & Greed Index. Synthesizes all signals with gpt-4o-mini into a ~200-word
// crypto market brief with regime classification.
//
// Seam: agents running DeFi analysis, crypto research pipelines, or portfolio
// monitoring need a single synthesized crypto market signal. crypto-top-movers
// (24 organic wallets) shows strong demand; this brief is the synthesis layer
// on top of that raw data.
//
// Price: $0.35 — brief-family pattern.
// Upstreams: CoinGecko free API + Alternative.me FGI (free) + gpt-4o-mini.

const CG_URL     = "https://api.coingecko.com/api/v3/simple/price";
const FGI_URL    = "https://api.alternative.me/fng/?limit=1";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; myriad/4.65; +https://synaptiic.org)";
const CG_TMO     = 12_000;
const GPT_TMO    = 38_000;

const COINS = [
  { id: "bitcoin",          symbol: "BTC" },
  { id: "ethereum",         symbol: "ETH" },
  { id: "solana",           symbol: "SOL" },
  { id: "binancecoin",      symbol: "BNB" },
  { id: "ripple",           symbol: "XRP" },
  { id: "dogecoin",         symbol: "DOGE" },
  { id: "cardano",          symbol: "ADA" },
  { id: "avalanche-2",      symbol: "AVAX" },
  { id: "chainlink",        symbol: "LINK" },
  { id: "uniswap",          symbol: "UNI" },
  { id: "matic-network",    symbol: "MATIC" },
  { id: "cosmos",           symbol: "ATOM" },
];

const r2 = n => Math.round(n * 100) / 100;

async function fetchCoinGecko() {
  const ids  = COINS.map(c => c.id).join(",");
  const url  = `${CG_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(CG_TMO),
  });
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
  const data = await resp.json();

  return COINS.map(c => {
    const d = data[c.id] || {};
    return {
      symbol:         c.symbol,
      coin_id:        c.id,
      price_usd:      d.usd != null      ? r2(d.usd)              : null,
      change_24h_pct: d.usd_24h_change   ? r2(d.usd_24h_change)   : null,
      market_cap_usd: d.usd_market_cap   ? Math.round(d.usd_market_cap) : null,
      volume_24h_usd: d.usd_24h_vol      ? Math.round(d.usd_24h_vol)    : null,
    };
  });
}

async function fetchFearGreed() {
  try {
    const resp = await fetch(FGI_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const d    = data?.data?.[0];
    if (!d) return null;
    return {
      value:             parseInt(d.value, 10),
      value_classification: d.value_classification ?? null,
      timestamp:         d.timestamp ?? null,
    };
  } catch {
    return null;
  }
}

function classifyRegime(btcChange, fearGreedValue) {
  if (fearGreedValue == null) {
    return btcChange > 3  ? "risk_on" :
           btcChange < -3 ? "risk_off" : "neutral";
  }
  return fearGreedValue >= 75 ? "extreme_greed" :
         fearGreedValue >= 55 ? "greed"         :
         fearGreedValue >= 45 ? "neutral"        :
         fearGreedValue >= 25 ? "fear"           : "extreme_fear";
}

async function synthesize(coins, fgi, regime, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const btc = coins.find(c => c.symbol === "BTC");
  const eth = coins.find(c => c.symbol === "ETH");
  const sol = coins.find(c => c.symbol === "SOL");

  const block = [
    `Fear & Greed Index: ${fgi ? `${fgi.value} (${fgi.value_classification})` : "unavailable"} — regime: ${regime}`,
    `BTC: $${btc?.price_usd ?? "N/A"} (${btc?.change_24h_pct ?? "N/A"}% 24h)`,
    `ETH: $${eth?.price_usd ?? "N/A"} (${eth?.change_24h_pct ?? "N/A"}% 24h)`,
    `SOL: $${sol?.price_usd ?? "N/A"} (${sol?.change_24h_pct ?? "N/A"}% 24h)`,
    ...coins.filter(c => !["BTC","ETH","SOL"].includes(c.symbol))
      .map(c => `${c.symbol}: $${c.price_usd ?? "N/A"} (${c.change_24h_pct ?? "N/A"}% 24h)`)
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior crypto market analyst writing a daily situation briefing for AI agents running financial and DeFi research pipelines.

CURRENT CRYPTO MARKET DATA (CoinGecko real-time):
${block}

${toneClause} Cover: (1) the overall crypto market regime and what is driving it, (2) the single most important signal from BTC/ETH/altcoin dynamics, (3) one concrete implication for agents relying on crypto market assumptions.

Plain professional prose. No bullet points. Do not repeat all raw numbers. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core crypto market regime in plain language",
  "dominant_signal": "one sentence: the single most important signal from the data",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "crypto_regime": "extreme_greed" | "greed" | "neutral" | "fear" | "extreme_fear" | "risk_on" | "risk_off",
  "btc_dominance_signal": "leading" | "lagging" | "neutral" | "unknown",
  "confidence": 0.0 to 1.0
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:       MODEL,
      max_tokens:  600,
      temperature: 0.2,
      messages:    [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 120)}`);
  }

  const data  = await resp.json();
  const raw   = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name:  "crypto-brief",
  price: "$0.35",

  description:
    "AI-synthesized cryptocurrency market intelligence brief. Assembles 12 real-time signals from CoinGecko (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, UNI, MATIC, ATOM — price, 24h change, market cap, volume) plus the Alternative.me Fear & Greed Index. Returns crypto regime classification and a 200-word GPT-4o-mini narrative covering market sentiment, dominant signal, and agent decision implications.",

  inputSchema: {
    type: "object",
    properties: {
      style: {
        type:        "string",
        enum:        ["standard", "concise"],
        description: "'standard' = 200-word narrative (default). 'concise' = 100-word summary.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      crypto_regime:         { type: "string", description: "extreme_greed | greed | neutral | fear | extreme_fear | risk_on | risk_off" },
      situation:             { type: "string", description: "One-sentence crypto market summary." },
      dominant_signal:       { type: "string", description: "Most important signal from the data." },
      agent_implication:     { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:             { type: "string", description: "Full ~200-word briefing narrative." },
      btc_dominance_signal:  { type: "string", description: "Whether BTC is leading or lagging altcoins." },
      confidence:            { type: "number", description: "Synthesis confidence 0–1." },
      fear_greed_index: {
        type:        "object",
        description: "Alternative.me Fear & Greed Index.",
        properties: {
          value:                { type: "integer" },
          value_classification: { type: "string"  },
        },
      },
      coins: {
        type:  "array",
        items: { type: "object" },
        description: "Raw coin data: symbol, price_usd, change_24h_pct, market_cap_usd, volume_24h_usd.",
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const [coins, fgi] = await Promise.all([fetchCoinGecko(), fetchFearGreed()]);

    const btcChange = coins.find(c => c.symbol === "BTC")?.change_24h_pct ?? 0;
    const regime    = classifyRegime(btcChange, fgi?.value);
    const synth     = await synthesize(coins, fgi, regime, style);

    return {
      ...synth,
      fear_greed_index: fgi ?? null,
      coins,
      generated_at: new Date().toISOString(),
    };
  },
};
