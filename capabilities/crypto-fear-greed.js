// crypto-fear-greed.js
//
// Crypto market sentiment via the alternative.me Fear & Greed Index.
// Returns the current score + label, 7-day trend, 30-day summary (min/max/avg),
// and a regime interpretation agents can act on directly.
//
// Seam: crypto-pulse + defi-market-pulse give price/volume context but no
// aggregate sentiment. Trading agents building entry/exit signals, DCA triggers,
// or portfolio hedges need a single scalar that captures market psychology.
// alternative.me FGI is the industry-standard free equivalent of the CNN F&G
// for crypto — widely cited, daily updated, 90-day history available.
//
// Free upstream: api.alternative.me/fng — no API key, no auth. Updated daily.
// Priced at $0.005 — sentiment-layer data, same tier as fomc-tracker.

const FNG_URL = "https://api.alternative.me/fng/?limit=30&format=json";
const UA      = "Mozilla/5.0 (compatible; the-stall/4.5; +https://intuitek.ai)";
const TIMEOUT = 10_000;

function classify(score) {
  const n = Number(score);
  if (n <= 24)  return "Extreme Fear";
  if (n <= 44)  return "Fear";
  if (n <= 54)  return "Neutral";
  if (n <= 74)  return "Greed";
  return "Extreme Greed";
}

function regime(score) {
  const n = Number(score);
  if (n <= 20)  return "capitulation_zone";
  if (n <= 35)  return "fear_accumulate";
  if (n <= 54)  return "neutral_hold";
  if (n <= 74)  return "greed_cautious";
  return "euphoria_reduce";
}

export default {
  name:  "crypto-fear-greed",
  price: "$0.039",

  description:
    "Crypto Fear & Greed Index — current score (0=extreme fear, 100=extreme greed), 7-day trend, 30-day min/max/avg, and trading regime signal. Free alternative.me data updated daily. $0.005/call.",

  inputSchema: {
    type:       "object",
    properties: {
      days: {
        type:        "integer",
        minimum:     1,
        maximum:     30,
        description: "History depth for trend and summary (1–30). Default: 7.",
      },
    },
    required: [],
  },

  outputSchema: {
    type:       "object",
    properties: {
      current: {
        type: "object",
        properties: {
          score:            { type: "integer", description: "0=extreme fear, 100=extreme greed" },
          label:            { type: "string" },
          regime:           { type: "string", description: "capitulation_zone | fear_accumulate | neutral_hold | greed_cautious | euphoria_reduce" },
          updated_at:       { type: "string", description: "ISO-8601 UTC timestamp" },
          next_update_secs: { type: "integer" },
        },
      },
      trend: {
        type:        "array",
        description: "Daily scores, newest first",
        items: {
          type: "object",
          properties: {
            date:  { type: "string" },
            score: { type: "integer" },
            label: { type: "string" },
          },
        },
      },
      summary: {
        type:        "object",
        description: "Stats across the requested history window",
        properties: {
          days:    { type: "integer" },
          min:     { type: "integer" },
          max:     { type: "integer" },
          avg:     { type: "number" },
          label:   { type: "string", description: "Dominant classification for window" },
          signal:  { type: "string", description: "buy_signal | hold | sell_signal — derived from current vs 30d avg" },
        },
      },
    },
  },

  async handler(query) {
    const days = Math.min(Math.max(parseInt(query.days ?? "7", 10), 1), 30);
    const limit = Math.max(days, 7);  // always fetch at least 7 for trend

    const r = await fetch(`https://api.alternative.me/fng/?limit=${limit}&format=json`, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(`FNG API HTTP ${r.status}`);

    const body = await r.json();
    const data = body.data ?? [];
    if (!data.length) throw new Error("Empty FNG response");

    const now = data[0];
    const nowScore = parseInt(now.value, 10);

    const trend = data.slice(0, days).map(d => ({
      date:  new Date(parseInt(d.timestamp, 10) * 1000).toISOString().slice(0, 10),
      score: parseInt(d.value, 10),
      label: d.value_classification ?? classify(d.value),
    }));

    const scores = trend.map(t => t.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;

    // dominant label = most frequent classification in window
    const counts = {};
    trend.forEach(t => { counts[t.label] = (counts[t.label] ?? 0) + 1; });
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    // signal: current vs avg
    let signal;
    if (nowScore <= 25 && avgScore <= 35)      signal = "buy_signal";   // both in fear → contrarian buy
    else if (nowScore >= 70 && avgScore >= 65) signal = "sell_signal";  // both in greed → take profit
    else                                        signal = "hold";

    return {
      current: {
        score:            nowScore,
        label:            now.value_classification ?? classify(now.value),
        regime:           regime(nowScore),
        updated_at:       new Date(parseInt(now.timestamp, 10) * 1000).toISOString(),
        next_update_secs: parseInt(now.time_until_update ?? "0", 10),
      },
      trend,
      summary: {
        days,
        min:    minScore,
        max:    maxScore,
        avg:    avgScore,
        label:  dominant,
        signal,
      },
    };
  },
};
