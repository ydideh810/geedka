// weather-equity-brief.js
//
// AI brief: recent weather patterns for a region + live equity prices + GPT
// synthesis of weather-market correlations — all in one call.
//
// Seam signal (cy_hb_3329, 2026-07-06): 4 organic wallets co-calling
// stock-price-multi + weather-history over 30 days; 3 of those same wallets
// also co-calling research-synthesis + weather-history. Tri-combo signal
// confirms users want weather data, market prices, AND synthesis together.
//
// Use cases: weather-sensitive sector positioning (energy, utilities, agriculture,
// airlines, retail); heating/cooling degree day analysis vs utility stocks;
// drought/precipitation context for agricultural commodity plays.
//
// Upstream: Open-Meteo Archive API (ERA5 reanalysis, free, no auth)
//           + Open-Meteo Geocoding API (free)
//           + Yahoo Finance v8 chart (free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.

const GEOCODE_URL  = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive";
const YF_BASE      = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const MODEL        = "gpt-4o-mini";
const UA           = "Mozilla/5.0 (compatible; myriad/4.91; +https://synaptiic.org)";
const GEO_TIMEOUT  = 10_000;
const WX_TIMEOUT   = 15_000;
const EQ_TIMEOUT   = 8_000;
const SYN_TIMEOUT  = 25_000;
const MAX_TICKERS  = 5;
const DEFAULT_TICKERS = ["XLE", "XLU", "MOO"];  // energy, utilities, agriculture
const DEFAULT_LOCATION = "Chicago";              // midwest grain-belt proxy
const DEFAULT_DAYS = 14;

// ── Geocode ──────────────────────────────────────────────────────────────────

async function geocode(location) {
  const queries = [location];
  if (location.includes(",")) queries.push(location.split(",")[0].trim());

  for (const q of queries) {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(GEO_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`Geocode HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.results?.length) {
      const r = data.results[0];
      return { latitude: r.latitude, longitude: r.longitude, name: r.name, country: r.country };
    }
  }
  throw new Error(`Location not found: "${location}". Try a major city name.`);
}

// ── Weather history ───────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchWeather(lat, lon, days) {
  const end   = new Date();
  end.setDate(end.getDate() - 5);   // ERA5 lags ~5 days
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const vars = [
    "temperature_2m_max", "temperature_2m_min",
    "precipitation_sum", "wind_speed_10m_max", "sunshine_duration",
  ].join(",");

  const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${isoDate(start)}&end_date=${isoDate(end)}` +
    `&daily=${vars}&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&precipitation_unit=inch&timezone=auto`;

  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(WX_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.daily) throw new Error("No weather data returned");

  const d = data.daily;
  const n = d.time?.length || 0;

  // Compute summary stats
  function stat(arr) {
    const vals = (arr || []).filter(v => v !== null && v !== undefined);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
      min:  Math.round(Math.min(...vals) * 10) / 10,
      max:  Math.round(Math.max(...vals) * 10) / 10,
      mean: Math.round((sum / vals.length) * 10) / 10,
      total: Math.round(sum * 100) / 100,
    };
  }

  const tempMaxStat  = stat(d.temperature_2m_max);
  const tempMinStat  = stat(d.temperature_2m_min);
  const precipStat   = stat(d.precipitation_sum);
  const windStat     = stat(d.wind_speed_10m_max);
  const sunshineStat = stat(d.sunshine_duration?.map(s => s / 3600));  // convert seconds → hours

  // Derive anomaly signals for synthesis prompt
  const anomalies = [];
  if (tempMaxStat && tempMaxStat.mean > 90) anomalies.push(`heat (avg high ${tempMaxStat.mean}°F)`);
  if (tempMaxStat && tempMaxStat.mean < 32) anomalies.push(`extreme cold (avg high ${tempMaxStat.mean}°F)`);
  if (precipStat  && precipStat.total > 3)  anomalies.push(`heavy precipitation (${precipStat.total}" total)`);
  if (precipStat  && precipStat.total < 0.1) anomalies.push(`drought-dry conditions (<0.1" precipitation)`);
  if (windStat    && windStat.max > 40)     anomalies.push(`high winds (max ${windStat.max} mph)`);

  return {
    period:    { start: isoDate(start), end: isoDate(end), days: n },
    temp_high: tempMaxStat,
    temp_low:  tempMinStat,
    precip:    precipStat,
    wind:      windStat,
    sunshine_hours: sunshineStat,
    anomalies,
  };
}

// ── Equity prices ─────────────────────────────────────────────────────────────

async function fetchEquity(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid symbol" };
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(EQ_TIMEOUT),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker: sym, error: "no data" };
    const meta = result.meta;
    const price    = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prev     = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const change   = (price && prev) ? ((price - prev) / prev * 100) : null;
    return {
      ticker:   sym,
      name:     meta.longName || meta.shortName || null,
      price:    price  != null ? Math.round(price  * 100) / 100 : null,
      change:   change != null ? Math.round(change * 100) / 100 : null,
      currency: meta.currency || "USD",
    };
  } catch (e) {
    return { ticker, error: e.message };
  }
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

async function synthesize(location, weather, equities, apiKey) {
  const wxDesc = [
    `Temperature: high avg ${weather.temp_high?.mean ?? "?"}°F, low avg ${weather.temp_low?.mean ?? "?"}°F`,
    `Precipitation: ${weather.precip?.total ?? "?"}\" over ${weather.period.days} days`,
    `Max wind: ${weather.wind?.max ?? "?"}mph`,
    weather.anomalies.length ? `Notable patterns: ${weather.anomalies.join("; ")}` : "No extreme anomalies",
  ].join("\n");

  const eqText = equities.map(e =>
    e.error ? `${e.ticker}: unavailable`
            : `${e.ticker}${e.name ? ` (${e.name.slice(0, 25)})` : ""}: $${e.price} (${e.change >= 0 ? "+" : ""}${e.change}%)`
  ).join("\n");

  const prompt = `You are a concise weather-market analyst. Based on recent weather for ${location} and current equity prices, write a brief (3–4 sentences) that:
1. Characterizes the recent weather pattern and any anomalies
2. Identifies which of the listed equities are most likely weather-impacted and why (consider sector: energy = heating/cooling demand; utilities = same; agriculture ETFs = precipitation/drought; airlines = disruptions)
3. States the single clearest weather-driven portfolio signal

Recent weather (${weather.period.start} to ${weather.period.end}):
${wxDesc}

Equity snapshot:
${eqText}

Write the brief now. Be specific. No generic filler.`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  220,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.substring(0, 120)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "Synthesis unavailable.";
}

// ── Export ────────────────────────────────────────────────────────────────────

export default {
  name:  "weather-equity-brief",
  price: "$2.00",

  description:
    "Recent weather patterns for a region + live equity prices + AI synthesis of weather-market correlations. One call replaces weather-history + stock-price-multi + research-synthesis. Ideal for weather-sensitive sectors: energy (XLE), utilities (XLU), agriculture (MOO/ADM), airlines (DAL). Returns 14-day weather summary, equity snapshot, and a GPT-4o-mini brief on the dominant weather-driven portfolio signal.",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      location: {
        type: "string",
        description: `City or region for weather history (default "${DEFAULT_LOCATION}"). Accepts city names like "Kansas City", "Des Moines", "Houston".`,
      },
      tickers: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_TICKERS,
        description: `Up to ${MAX_TICKERS} equity or ETF tickers (default: ["XLE","XLU","MOO"]). Use weather-sensitive names — energy, utilities, agriculture, airlines.`,
      },
      days: {
        type: "integer",
        minimum: 7,
        maximum: 30,
        description: `Days of weather history to analyse (default ${DEFAULT_DAYS}, max 30). ERA5 data lags ~5 days, so end date is always 5 days before today.`,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      brief:        { type: "string",  description: "AI-synthesized 3-4 sentence weather-market brief." },
      location:     { type: "object",  description: "Resolved location with name and coordinates." },
      weather:      { type: "object",  description: "Period summary: temp highs/lows, precip, wind, anomalies." },
      equities:     { type: "array",   description: "Ticker prices and % change." },
      generated_at: { type: "string",  description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const locationStr = query?.location || DEFAULT_LOCATION;
    const rawTickers  = query?.tickers
      ? (Array.isArray(query.tickers) ? query.tickers : String(query.tickers).split(",").map(s => s.trim()))
      : DEFAULT_TICKERS;
    const tickers = rawTickers.slice(0, MAX_TICKERS);
    const days    = Math.min(Math.max(parseInt(query?.days || DEFAULT_DAYS, 10), 7), 30);

    const apiKey = (typeof process !== "undefined" && process.env?.OPENAI_API_KEY) || query?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const loc = await geocode(locationStr);

    const [weather, ...equities] = await Promise.all([
      fetchWeather(loc.latitude, loc.longitude, days),
      ...tickers.map(t => fetchEquity(t)),
    ]);

    const brief = await synthesize(`${loc.name}, ${loc.country}`, weather, equities, apiKey);

    return {
      brief,
      location: { name: loc.name, country: loc.country, latitude: loc.latitude, longitude: loc.longitude },
      weather,
      equities,
      generated_at: new Date().toISOString(),
    };
  },
};
