// polymarket-accuracy-score.js
//
// Historical crowd accuracy score on Polymarket: what % of the time did the
// crowd majority correctly predict resolved markets? Also computes Brier score
// (lower = better calibration). Breakdowns by inferred category (crypto,
// politics, sports, macro, equities, ai, other).
//
// Seam: orbisapi.com/proxy/polymarket-accuracy-score-api-27861e — 398 sett,
//   8 payers, $0.005/call (2-day snapshot, first_seen 2026-06-05).
// STALL prices at $0.004 (20% below). Upstream: Polymarket gamma API (free, no key).
//
// Brier score reference: 0.00 = perfect, 0.25 = random, 1.00 = systematically wrong.

const GAMMA_BASE = "https://gamma-api.polymarket.com/markets";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.84; +https://intuitek.ai)";
const TIMEOUT    = 15_000;
const PAGE_LIMIT = 200;
const MAX_PAGES  = 5;

function inferCategory(question, eventTitle) {
  const text = ((question || "") + " " + (eventTitle || "")).toLowerCase();
  if (/bitcoin|btc|ethereum|eth|crypto|solana|sol|xrp|dogecoin|doge|usd[ct]|stablecoin|defi|nft/.test(text)) return "crypto";
  if (/president|election|senate|congress|trump|biden|harris|democrat|republican|parliament|vote|poll/.test(text)) return "politics";
  if (/soccer|football|nfl|nba|mlb|nhl|tennis|golf|f1|formula|cricket|rugby|championship|world cup|league|match|game|score/.test(text)) return "sports";
  if (/openai|anthropic|gpt|claude|gemini|llm|ai model|artificial intelligence|chatgpt/.test(text)) return "ai";
  if (/fed|interest rate|inflation|cpi|pce|gdp|unemployment|recession|fomc|bond|treasury/.test(text)) return "macro";
  if (/nasdaq|nyse|s&p|dow|stock|ipo|earnings|sec|equity|shares|market cap/.test(text)) return "equities";
  return "other";
}

function parsePrices(outcomePricesStr) {
  try {
    const arr = JSON.parse(outcomePricesStr);
    return arr.map(v => parseFloat(v));
  } catch {
    return null;
  }
}

export default {
  name:  "polymarket-accuracy-score",
  price: "$0.014",

  description:
    "Historical Polymarket crowd accuracy score: % of markets where the final crowd majority correctly predicted the outcome, plus Brier score (calibration quality). Breakdowns by category — crypto, politics, sports, macro, equities, ai. Filter by category and lookback days. $0.004/call — 20% below closest x402 competitor. Source: Polymarket public API (no key required).",

  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["crypto", "politics", "sports", "macro", "equities", "ai", "other"],
        description: "Restrict analysis to one category. Omit for all categories.",
      },
      days_back: {
        type: "integer",
        description: "Lookback window in days for resolved markets (1–90, default 30).",
        minimum: 1,
        maximum: 90,
        default: 30,
      },
      min_volume: {
        type: "number",
        description: "Minimum market trading volume in USDC to include (default 0). Use 1000 to focus on liquid markets.",
        minimum: 0,
        default: 0,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      overall_accuracy_pct:  { type: "number", description: "% of markets where crowd majority prediction was correct." },
      brier_score:           { type: "number", description: "Mean Brier score. 0.00=perfect, 0.25=random, 1.00=systematically wrong." },
      interpretation:        { type: "string" },
      markets_analyzed:      { type: "integer" },
      period_days:           { type: "integer" },
      category_breakdown:    { type: "array" },
      sample_markets:        { type: "array" },
      data_source:           { type: "string" },
      generated_at:          { type: "string" },
    },
  },

  async handler(query) {
    const daysBack   = Math.min(Math.max(parseInt(query.days_back  ?? 30), 1), 90);
    const minVolume  = parseFloat(query.min_volume ?? 0);
    const catFilter  = query.category ? query.category.toLowerCase() : null;

    const since = new Date(Date.now() - daysBack * 86_400_000);

    let allMarkets = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${GAMMA_BASE}?closed=true&order=closedTime&ascending=false&limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}`;
      const r = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!r.ok) throw new Error(`Polymarket API HTTP ${r.status}`);
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;

      // stop if oldest market in batch is before our window
      const oldestClose = new Date(batch[batch.length - 1].closedTime || batch[batch.length - 1].endDate || "");
      allMarkets = allMarkets.concat(batch);
      if (oldestClose < since) break;
    }

    // process markets
    const categoryStats = {};
    const sampleMarkets = [];
    let correct = 0, total = 0, brierSum = 0;

    for (const m of allMarkets) {
      // skip markets outside window
      const closeTs = new Date(m.closedTime || m.endDate || "");
      if (closeTs < since) continue;

      // need lastTradePrice for accuracy calc
      if (m.lastTradePrice === null || m.lastTradePrice === undefined) continue;

      // volume filter
      const vol = parseFloat(m.volumeNum || m.volume || 0);
      if (vol < minVolume) continue;

      const prices = parsePrices(m.outcomePrices);
      if (!prices || prices.length < 2) continue;

      const ltp       = parseFloat(m.lastTradePrice);
      const yesActual = prices[0]; // 1 if YES/first-outcome won, 0 otherwise

      // only process binary-like resolution (close to 0 or 1)
      if (yesActual !== 0 && yesActual !== 1) continue;

      const cat = inferCategory(m.question, m.events?.[0]?.title || "");

      // skip if category filter and mismatch
      if (catFilter && cat !== catFilter) continue;

      const crowdPickedYes = ltp >= 0.5;
      const yesWon         = yesActual === 1;
      const isCorrect      = crowdPickedYes === yesWon;
      const brier          = Math.pow(ltp - yesActual, 2);

      if (isCorrect) correct++;
      total++;
      brierSum += brier;

      if (!categoryStats[cat]) categoryStats[cat] = { correct: 0, total: 0, brierSum: 0 };
      if (isCorrect) categoryStats[cat].correct++;
      categoryStats[cat].total++;
      categoryStats[cat].brierSum += brier;

      if (sampleMarkets.length < 6 && Math.abs(ltp - 0.5) > 0.1) {
        sampleMarkets.push({
          question:   m.question.slice(0, 80),
          crowd_prob: Math.round(ltp * 1000) / 1000,
          outcome:    yesWon ? m.outcomes ? JSON.parse(m.outcomes)[0] : "YES" : m.outcomes ? JSON.parse(m.outcomes)[1] : "NO",
          correct:    isCorrect,
          category:   cat,
          volume_usd: Math.round(vol),
        });
      }
    }

    if (total === 0) {
      return {
        overall_accuracy_pct: null,
        brier_score: null,
        interpretation:
          "No resolved markets with crowd price data found for the specified filters. Try increasing days_back or reducing min_volume.",
        markets_analyzed: 0,
        period_days: daysBack,
        category_breakdown: [],
        sample_markets: [],
        data_source: "Polymarket public API",
        generated_at: new Date().toISOString(),
      };
    }

    const breakdown = Object.entries(categoryStats)
      .map(([cat, s]) => ({
        category:    cat,
        accuracy_pct: Math.round((s.correct / s.total) * 1000) / 10,
        brier_score: Math.round((s.brierSum / s.total) * 10_000) / 10_000,
        markets:     s.total,
      }))
      .sort((a, b) => b.markets - a.markets);

    const overallAcc   = Math.round((correct / total) * 1000) / 10;
    const overallBrier = Math.round((brierSum / total) * 10_000) / 10_000;

    let interpretation = `Crowd was correct ${overallAcc}% of the time. `;
    if (overallBrier < 0.10) interpretation += "Excellent calibration (Brier < 0.10).";
    else if (overallBrier < 0.20) interpretation += "Good calibration (Brier 0.10–0.20).";
    else if (overallBrier < 0.25) interpretation += "Near-random calibration (Brier close to 0.25).";
    else interpretation += "Poor calibration — crowd was systematically wrong (Brier > 0.25).";

    return {
      overall_accuracy_pct: overallAcc,
      brier_score:          overallBrier,
      interpretation,
      markets_analyzed:     total,
      period_days:          daysBack,
      category_breakdown:   breakdown,
      sample_markets:       sampleMarkets,
      data_source:          "Polymarket public API (gamma-api.polymarket.com)",
      generated_at:         new Date().toISOString(),
    };
  },
};
