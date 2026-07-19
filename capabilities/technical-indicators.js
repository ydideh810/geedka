// technical-indicators.js
//
// Full technical analysis suite for any US equity (or index/ETF).
// Computes RSI, MACD, SMA, EMA, and Bollinger Bands from 1-year daily
// OHLCV history, then classifies the current technical posture.
//
// Designed for autonomous stock-screening and trading pipelines where
// technicals are needed AFTER a fundamental screen — "does the chart
// confirm the thesis?" Any agent doing stock analysis naturally needs
// one call for technicals rather than fetching raw price history and
// running the math itself.
//
// Computed from daily closes (1yr, ~252 trading days):
//   RSI(14)         — relative strength index, overbought >70, oversold <30
//   MACD(12,26,9)   — line, signal, histogram, and cross direction
//   SMA(20/50/200)  — simple moving averages; golden/death cross detection
//   EMA(20)         — exponential moving average
//   BBands(20,2σ)   — Bollinger Bands: upper, mid, lower, %B, squeeze flag
//   Volume SMA(20)  — volume trend vs recent average
//   tech_signal     — composite: STRONG_BULLISH | BULLISH | NEUTRAL |
//                     BEARISH | STRONG_BEARISH
//
// Source: Yahoo Finance v8/finance/chart — public, no API key.
// Price: $0.025

const UA        = "Mozilla/5.0 (compatible; myriad/4.65; +https://synaptiic.org)";
const YF_CRUMB  = "https://fc.yahoo.com";
const YF_CRUMB2 = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_CHART  = "https://query2.finance.yahoo.com/v8/finance/chart";
const TMO       = 16_000;
const CRUMB_TTL = 30 * 60 * 1000;

let _crumb = null;

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }
function r4(n) { return n != null ? Math.round(n * 10000) / 10000 : null; }

async function refreshCrumb() {
  const seedR = await fetch(YF_CRUMB, {
    headers: { "User-Agent": UA }, redirect: "follow",
    signal: AbortSignal.timeout(TMO),
  });
  const cookies = (seedR.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
  const crumbR  = await fetch(YF_CRUMB2, {
    headers: { "User-Agent": UA, "Cookie": cookies },
    signal: AbortSignal.timeout(TMO),
  });
  if (!crumbR.ok) throw new Error(`crumb ${crumbR.status}`);
  const crumb = (await crumbR.text()).trim();
  if (!crumb) throw new Error("empty crumb");
  _crumb = { crumb, cookies, ts: Date.now() };
  return _crumb;
}

async function getCrumb() {
  if (_crumb && (Date.now() - _crumb.ts) < CRUMB_TTL) return _crumb;
  return refreshCrumb();
}

async function fetchChart(ticker, retry = true) {
  const { crumb, cookies } = await getCrumb();
  const url = `${YF_CHART}/${encodeURIComponent(ticker)}?range=1y&interval=1d&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (resp.status === 401 && retry) { _crumb = null; return fetchChart(ticker, false); }
  if (!resp.ok) throw new Error(`Yahoo chart ${resp.status} for ${ticker}`);
  return resp.json();
}

// --- Indicators ---

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

function emaFull(closes, period) {
  if (closes.length < period) return [];
  const k   = 2 / (period + 1);
  const out  = new Array(closes.length).fill(null);
  let val    = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = val;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    out[i] = val;
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const eFast  = emaFull(closes, fast);
  const eSlow  = emaFull(closes, slow);
  const macdLine = closes.map((_, i) =>
    eFast[i] != null && eSlow[i] != null ? eFast[i] - eSlow[i] : null
  ).filter(v => v != null);
  if (macdLine.length < signal) return null;
  const signalLine = ema(macdLine, signal);
  const macdVal    = macdLine[macdLine.length - 1];
  const histogram  = signalLine != null ? macdVal - signalLine : null;
  const prev       = macdLine.length >= 2 ? macdLine[macdLine.length - 2] : null;
  const prevSig    = macdLine.length >= signal + 1
    ? ema(macdLine.slice(0, -1), signal) : null;
  let cross = "none";
  if (prev != null && prevSig != null && signalLine != null) {
    if (prev < prevSig && macdVal > signalLine) cross = "bullish_cross";
    if (prev > prevSig && macdVal < signalLine) cross = "bearish_cross";
  }
  return { line: macdVal, signal_line: signalLine, histogram, cross };
}

function bollingerBands(closes, period = 20, stdDevMult = 2) {
  if (closes.length < period) return null;
  const slice  = closes.slice(-period);
  const mid    = slice.reduce((a, b) => a + b, 0) / period;
  const vari   = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const sd     = Math.sqrt(vari);
  const upper  = mid + stdDevMult * sd;
  const lower  = mid - stdDevMult * sd;
  const price  = closes[closes.length - 1];
  const pctB   = sd > 0 ? (price - lower) / (upper - lower) : null;
  const bwidth = mid > 0 ? (upper - lower) / mid : null;
  const squeeze = bwidth != null && bwidth < 0.05;
  return { upper, mid, lower, pct_b: pctB, bandwidth: bwidth, squeeze };
}

function compositeSignal(rsiVal, macdData, price, s20, s50, s200) {
  let score = 0;
  if (rsiVal != null) {
    if (rsiVal > 70)      score -= 1;
    else if (rsiVal > 60) score += 1;
    else if (rsiVal < 30) score -= 1;
    else if (rsiVal < 40) score -= 1;
    else                  score += 0;
  }
  if (macdData?.histogram != null) {
    score += macdData.histogram > 0 ? 1 : -1;
  }
  if (macdData?.cross === "bullish_cross") score += 2;
  if (macdData?.cross === "bearish_cross") score -= 2;
  if (price != null && s20 != null) score += price > s20 ? 1 : -1;
  if (price != null && s50 != null) score += price > s50 ? 1 : -1;
  if (price != null && s200 != null) score += price > s200 ? 1 : -1;
  if (s50 != null && s200 != null) {
    if (s50 > s200) score += 1;
    else            score -= 1;
  }
  if (score >= 4)       return "STRONG_BULLISH";
  if (score >= 2)       return "BULLISH";
  if (score <= -4)      return "STRONG_BEARISH";
  if (score <= -2)      return "BEARISH";
  return "NEUTRAL";
}

export default {
  name:  "technical-indicators",
  price: "$0.025",

  description:
    "Full technical analysis for any US equity, ETF, or index. Returns RSI(14), MACD(12,26,9), SMA(20/50/200), EMA(20), Bollinger Bands, volume trend, golden/death cross status, and a composite tech_signal (STRONG_BULLISH/BULLISH/NEUTRAL/BEARISH/STRONG_BEARISH). One call replaces raw price history fetch + indicator math. Pairs with stock-screener, equity-fundamentals, and earnings-reaction. Yahoo Finance, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "Equity ticker symbol (e.g. AAPL, SPY, QQQ).",
      },
    },
    required: ["ticker"],
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:        { type: "string" },
      name:          { type: ["string", "null"] },
      price:         { type: ["number", "null"] },
      tech_signal:   { type: "string", enum: ["STRONG_BULLISH", "BULLISH", "NEUTRAL", "BEARISH", "STRONG_BEARISH"] },
      rsi_14:        { type: ["number", "null"], description: "RSI(14). Overbought >70, oversold <30." },
      rsi_signal:    { type: "string", enum: ["overbought", "oversold", "neutral"] },
      macd: {
        type: ["object", "null"],
        properties: {
          line:        { type: ["number", "null"] },
          signal_line: { type: ["number", "null"] },
          histogram:   { type: ["number", "null"] },
          cross:       { type: "string", enum: ["bullish_cross", "bearish_cross", "none"] },
          trend:       { type: "string", enum: ["bullish", "bearish", "flat"] },
        },
      },
      moving_averages: {
        type: "object",
        properties: {
          sma_20:  { type: ["number", "null"] },
          sma_50:  { type: ["number", "null"] },
          sma_200: { type: ["number", "null"] },
          ema_20:  { type: ["number", "null"] },
          price_vs_sma20:  { type: ["string", "null"], enum: ["above", "below", null] },
          price_vs_sma50:  { type: ["string", "null"], enum: ["above", "below", null] },
          price_vs_sma200: { type: ["string", "null"], enum: ["above", "below", null] },
          golden_cross: { type: "boolean", description: "SMA50 > SMA200 (long-term bullish setup)." },
          death_cross:  { type: "boolean", description: "SMA50 < SMA200 (long-term bearish setup)." },
        },
      },
      bollinger_bands: {
        type: ["object", "null"],
        properties: {
          upper:     { type: ["number", "null"] },
          mid:       { type: ["number", "null"] },
          lower:     { type: ["number", "null"] },
          pct_b:     { type: ["number", "null"], description: "0=at lower band, 1=at upper band." },
          bandwidth: { type: ["number", "null"] },
          squeeze:   { type: "boolean", description: "True when bandwidth <5% of midpoint (volatility contraction)." },
          position:  { type: "string", enum: ["above_upper", "near_upper", "mid", "near_lower", "below_lower"] },
        },
      },
      volume: {
        type: "object",
        properties: {
          last:        { type: ["number", "null"] },
          sma_20:      { type: ["number", "null"] },
          vs_avg:      { type: ["string", "null"], enum: ["high", "normal", "low", null] },
          vs_avg_pct:  { type: ["number", "null"] },
        },
      },
      data_days: { type: "integer" },
      ts:        { type: "string" },
    },
  },

  async handler({ ticker }) {
    if (!ticker || typeof ticker !== "string") throw new Error("ticker is required");
    const sym = ticker.trim().toUpperCase();

    const data  = await fetchChart(sym);
    const res   = data?.chart?.result?.[0];
    if (!res) throw new Error(`no chart data for "${sym}"`);

    const meta   = res.meta || {};
    const name   = meta.shortName || meta.longName || null;
    const tss    = res.timestamp || [];
    const q      = res.indicators?.quote?.[0] || {};
    const closes = (q.close || []).filter((v, i) => v != null && tss[i] != null);
    const vols   = (q.volume || []).filter((v, i) => v != null && (q.close || [])[i] != null);

    if (closes.length < 30) throw new Error(`insufficient data for "${sym}" (${closes.length} days)`);

    const price  = closes[closes.length - 1];

    // RSI
    const rsiVal = rsi(closes, 14);
    const rsiSig = rsiVal == null ? "neutral"
      : rsiVal > 70 ? "overbought"
      : rsiVal < 30 ? "oversold"
      : "neutral";

    // MACD
    const macdData = macd(closes);
    let macdTrend = "flat";
    if (macdData?.histogram != null) macdTrend = macdData.histogram > 0 ? "bullish" : "bearish";

    // Moving averages
    const s20  = sma(closes, 20);
    const s50  = sma(closes, 50);
    const s200 = sma(closes, Math.min(200, closes.length));
    const e20  = ema(closes, 20);

    const golden = s50 != null && s200 != null && s50 > s200;
    const death  = s50 != null && s200 != null && s50 < s200;

    // Bollinger Bands
    const bb = bollingerBands(closes, 20, 2);
    let bbPos = "mid";
    if (bb) {
      if (price > bb.upper)                          bbPos = "above_upper";
      else if (price > bb.mid + (bb.upper - bb.mid) * 0.5) bbPos = "near_upper";
      else if (price < bb.lower)                     bbPos = "below_lower";
      else if (price < bb.mid - (bb.mid - bb.lower) * 0.5) bbPos = "near_lower";
      else                                            bbPos = "mid";
    }

    // Volume
    const lastVol = vols[vols.length - 1] ?? null;
    const volSma  = vols.length >= 20
      ? vols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    const volPct  = volSma ? (lastVol / volSma - 1) * 100 : null;
    const volSig  = volPct == null ? null
      : volPct > 30 ? "high"
      : volPct < -30 ? "low"
      : "normal";

    // Composite
    const techSig = compositeSignal(rsiVal, macdData, price, s20, s50, s200);

    return {
      ticker: sym,
      name,
      price: r2(price),
      tech_signal: techSig,
      rsi_14: r2(rsiVal),
      rsi_signal: rsiSig,
      macd: macdData ? {
        line:        r4(macdData.line),
        signal_line: r4(macdData.signal_line),
        histogram:   r4(macdData.histogram),
        cross:       macdData.cross,
        trend:       macdTrend,
      } : null,
      moving_averages: {
        sma_20:  r2(s20),
        sma_50:  r2(s50),
        sma_200: r2(s200),
        ema_20:  r2(e20),
        price_vs_sma20:  s20  ? (price > s20  ? "above" : "below") : null,
        price_vs_sma50:  s50  ? (price > s50  ? "above" : "below") : null,
        price_vs_sma200: s200 ? (price > s200 ? "above" : "below") : null,
        golden_cross: golden,
        death_cross:  death,
      },
      bollinger_bands: bb ? {
        upper:    r2(bb.upper),
        mid:      r2(bb.mid),
        lower:    r2(bb.lower),
        pct_b:    r2(bb.pct_b),
        bandwidth: r4(bb.bandwidth),
        squeeze:  bb.squeeze,
        position: bbPos,
      } : null,
      volume: {
        last:       lastVol,
        sma_20:     volSma != null ? Math.round(volSma) : null,
        vs_avg:     volSig,
        vs_avg_pct: r2(volPct),
      },
      data_days: closes.length,
      ts: new Date().toISOString(),
    };
  },
};
