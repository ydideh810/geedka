// weather-research-brief.js
//
// Weather-contextualized research intelligence: pulls historical weather for a
// location and deep multi-source research for a query topic, then synthesizes
// them into a single actionable brief.
//
// Seam signal (cy_hb_3335, 2026-07-06): 13 organic wallets co-calling
// research-synthesis + weather-history — the strongest unexploited co-call pair
// in the last 30 days. Distinct from weather-equity-brief (which uses stock prices
// instead of research aggregation).
//
// Use cases: agricultural commodity analysis (drought + crop science research),
// climate/energy positioning (weather extremes + policy research), supply chain
// risk (weather events + logistics research), insurance/actuarial (historical
// weather + risk literature), environmental due diligence.
//
// Upstream: Open-Meteo Archive API (ERA5 reanalysis, free, no auth)
//           + Open-Meteo Geocoding API (free)
//           + HN Algolia, OpenAlex, Reddit, arXiv, DuckDuckGo (all free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.
// Version: the-stall/4.94.0

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; the-stall/4.94; +https://intuitek.ai)";
const GEO_TIMEOUT = 10_000;
const WX_TIMEOUT  = 15_000;
const SRC_TIMEOUT = 8_000;
const SYN_TIMEOUT = 25_000;

const DEFAULT_LOCATION = "Chicago";
const DEFAULT_DAYS     = 14;
const DEFAULT_QUERY    = "climate impact on agriculture markets 2025";

// ── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── geocode ──────────────────────────────────────────────────────────────────

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

// ── weather history ───────────────────────────────────────────────────────────

async function fetchWeather(lat, lon, days) {
  const end = new Date();
  end.setDate(end.getDate() - 5);     // ERA5 lags ~5 days
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
  if (!resp.ok) throw new Error(`Open-Meteo Archive HTTP ${resp.status}`);
  const data = await resp.json();

  const daily = data.daily || {};
  const dates = daily.time || [];
  const n = dates.length;
  if (n === 0) throw new Error("No weather data returned for this location/date range.");

  const maxTemps = daily.temperature_2m_max || [];
  const minTemps = daily.temperature_2m_min || [];
  const precip   = daily.precipitation_sum  || [];
  const wind     = daily.wind_speed_10m_max || [];
  const sunshine = daily.sunshine_duration  || [];

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + (b ?? 0), 0) / arr.length : null;
  const max = (arr) => arr.length ? Math.max(...arr.filter(v => v != null)) : null;
  const sum = (arr) => arr.length ? arr.reduce((a, b) => a + (b ?? 0), 0) : null;

  const avgHigh   = avg(maxTemps);
  const avgLow    = avg(minTemps);
  const peakWind  = max(wind);
  const totalPrecip = sum(precip);
  const avgSun    = avg(sunshine);

  // Anomaly detection: count extreme temp days (>95°F high or <20°F low)
  const hotDays  = maxTemps.filter(v => v > 95).length;
  const coldDays = minTemps.filter(v => v < 20).length;
  const dryDays  = precip.filter(v => v != null && v < 0.01).length;
  const wetDays  = precip.filter(v => v > 0.5).length;

  const anomalies = [];
  if (hotDays > 3)  anomalies.push(`${hotDays} extreme heat days (>95°F)`);
  if (coldDays > 3) anomalies.push(`${coldDays} extreme cold days (<20°F)`);
  if (dryDays > n * 0.8) anomalies.push(`Drought conditions (${dryDays}/${n} dry days)`);
  if (wetDays > n * 0.5) anomalies.push(`Wet period (${wetDays}/${n} days with >0.5" precip)`);

  return {
    period_start: isoDate(start),
    period_end:   isoDate(end),
    days:         n,
    avg_high_f:   avgHigh != null ? Math.round(avgHigh * 10) / 10 : null,
    avg_low_f:    avgLow  != null ? Math.round(avgLow  * 10) / 10 : null,
    total_precip_in:  totalPrecip != null ? Math.round(totalPrecip * 100) / 100 : null,
    peak_wind_mph:    peakWind    != null ? Math.round(peakWind)           : null,
    avg_sunshine_hrs: avgSun      != null ? Math.round(avgSun / 3600 * 10) / 10 : null,
    anomalies,
  };
}

// ── research fetchers ─────────────────────────────────────────────────────────

async function fetchHN(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const d = await r.json();
  return (d.hits || []).map(h => ({
    source: "Hacker News",
    title:  h.title,
    url:    h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    snippet: h.story_text ? h.story_text.slice(0, 300) : null,
  }));
}

async function fetchOpenAlex(query) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=5&mailto=kyle@intuitek.ai&select=title,abstract_inverted_index,publication_year,cited_by_count,primary_location`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const d = await r.json();
  return (d.results || []).map(w => ({
    source:  "OpenAlex (Academic)",
    title:   w.title,
    year:    w.publication_year,
    cited:   w.cited_by_count,
    url:     w.primary_location?.landing_page_url || null,
    snippet: decodeInvertedIndex(w.abstract_inverted_index)?.slice(0, 300) || null,
  }));
}

function decodeInvertedIndex(inv) {
  if (!inv) return null;
  return Object.entries(inv)
    .flatMap(([w, positions]) => positions.map(p => ({ w, p })))
    .sort((a, b) => a.p - b.p)
    .map(x => x.w)
    .join(" ");
}

async function fetchReddit(query) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5&t=month`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`Reddit ${r.status}`);
  const d = await r.json();
  return ((d.data?.children) || []).map(c => c.data).map(p => ({
    source:    "Reddit",
    title:     p.title,
    subreddit: p.subreddit,
    snippet:   p.selftext ? p.selftext.slice(0, 300) : null,
  }));
}

async function fetchArxiv(query) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=4&sortBy=relevance`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`arXiv ${r.status}`);
  const text = await r.text();
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(text)) !== null) {
    const block   = m[1];
    const title   = (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || "").trim().replace(/\n/g, " ");
    const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1] || "").trim().slice(0, 300);
    const link    = /<id>(.*?)<\/id>/.exec(block)?.[1]?.trim() || null;
    if (title) entries.push({ source: "arXiv (Preprint)", title, url: link, snippet: summary });
  }
  return entries;
}

async function fetchDDG(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`DDG ${r.status}`);
  const d = await r.json();
  const items = [];
  if (d.AbstractText) {
    items.push({ source: "DuckDuckGo Abstract", title: d.Heading, url: d.AbstractURL, snippet: d.AbstractText.slice(0, 400) });
  }
  (d.RelatedTopics || []).slice(0, 3).forEach(t => {
    if (t.Text && t.FirstURL) {
      items.push({ source: "DuckDuckGo", title: t.Text.slice(0, 80), snippet: t.Text.slice(0, 300) });
    }
  });
  return items;
}

// ── synthesis ─────────────────────────────────────────────────────────────────

async function synthesize(query, locationName, weather, researchItems, apiKey) {
  const sourceText = researchItems.slice(0, 20).map((s, i) =>
    `[${i + 1}] ${s.source}: ${s.title || ""}` +
    (s.snippet ? `\n    → ${s.snippet}` : "")
  ).join("\n\n");

  const wxSummary = [
    `Avg High: ${weather.avg_high_f ?? "N/A"}°F`,
    `Avg Low: ${weather.avg_low_f ?? "N/A"}°F`,
    `Total Precip: ${weather.total_precip_in ?? "N/A"} inches`,
    `Peak Wind: ${weather.peak_wind_mph ?? "N/A"} mph`,
    `Avg Sunshine: ${weather.avg_sunshine_hrs ?? "N/A"} hrs/day`,
    weather.anomalies.length ? `Weather anomalies: ${weather.anomalies.join("; ")}` : "No significant weather anomalies detected.",
  ].join(" | ");

  const prompt = `You are an intelligence analyst integrating weather data with research literature.

WEATHER CONTEXT — ${locationName} (${weather.period_start} to ${weather.period_end}, ${weather.days} days):
${wxSummary}

RESEARCH TOPIC: "${query}"

RESEARCH SOURCES GATHERED:
${sourceText}

Your task: Synthesize the weather conditions and the research findings into a unified brief. Consider how the observed weather context (temperature extremes, precipitation anomalies, growing conditions, energy stress, or similar) relates to or amplifies the research topic. Provide actionable intelligence.

Respond ONLY with a JSON object (no markdown, no prose outside the JSON):
{
  "brief": "3-4 sentence executive synthesis connecting weather context to research findings",
  "weather_research_connection": "1-2 sentences on how the weather conditions are specifically relevant to this research topic",
  "key_findings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "weather_signal": "positive | negative | neutral | amplifying",
  "trends": ["trend 1", "trend 2", "trend 3"],
  "action_items": ["action 1", "action 2"]
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: "You are an intelligence analyst. Always respond with valid JSON only." },
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

// ── export ────────────────────────────────────────────────────────────────────

export default {
  name:  "weather-research-brief",
  price: "$2.50",

  description:
    "Weather-contextualized research intelligence — pulls historical weather for any location (ERA5 reanalysis via Open-Meteo) and multi-source research on any topic (Hacker News, OpenAlex academic papers, Reddit, arXiv, DuckDuckGo), then synthesizes them into a unified brief showing how weather conditions amplify or inform the research findings. Ideal for agricultural commodity analysis, climate/energy positioning, supply chain risk, insurance/actuarial, and environmental due diligence.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Research topic to investigate (e.g. 'drought impact on corn yields', 'extreme heat energy demand', 'hurricane insurance market risk', 'climate adaptation agriculture'). Omit for a default climate-markets report.",
      },
      location: {
        type: "string",
        description: `City or region for weather history (default "${DEFAULT_LOCATION}"). Accepts city names like "Kansas City", "Miami", "Phoenix", "Des Moines".`,
      },
      days: {
        type: "integer",
        minimum: 7,
        maximum: 30,
        description: `Days of weather history to analyse (default ${DEFAULT_DAYS}, max 30). ERA5 data lags ~5 days, so the period ends 5 days before today.`,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:                     { type: "string",  description: "Research topic queried." },
      location:                  { type: "object",  description: "Resolved location with name and coordinates." },
      weather:                   { type: "object",  description: "Weather period summary: highs, lows, precip, wind, anomalies." },
      brief:                     { type: "string",  description: "AI executive synthesis connecting weather context to research." },
      weather_research_connection: { type: "string", description: "Specific connection between weather conditions and research topic." },
      key_findings:              { type: "array",   items: { type: "string" }, description: "Top research findings." },
      weather_signal:            { type: "string",  description: "positive | negative | neutral | amplifying" },
      trends:                    { type: "array",   items: { type: "string" }, description: "Emerging trends." },
      action_items:              { type: "array",   items: { type: "string" }, description: "Recommended actions." },
      sources_queried:           { type: "integer", description: "Number of research sources attempted." },
      sources_responded:         { type: "integer", description: "Sources that returned results." },
      generated_at:              { type: "string",  description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const researchQuery = (query?.query && query.query.trim().length >= 3
      ? query.query.trim()
      : DEFAULT_QUERY).slice(0, 200);
    const locationStr = (query?.location && query.location.trim()) || DEFAULT_LOCATION;
    const days = Math.min(Math.max(parseInt(query?.days || DEFAULT_DAYS, 10), 7), 30);

    const apiKey = (typeof process !== "undefined" && process.env?.OPENAI_API_KEY) || query?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    // Geocode + research in parallel; weather needs geocode result
    const loc = await geocode(locationStr);

    const [weather, ...sourceSets] = await Promise.all([
      fetchWeather(loc.latitude, loc.longitude, days),
      fetchHN(researchQuery).then(items => ({ name: "hn",       ok: true,  items })).catch(e => ({ name: "hn",       ok: false, items: [], error: e.message })),
      fetchOpenAlex(researchQuery).then(items => ({ name: "openalex", ok: true, items })).catch(e => ({ name: "openalex", ok: false, items: [], error: e.message })),
      fetchReddit(researchQuery).then(items => ({ name: "reddit",   ok: true,  items })).catch(e => ({ name: "reddit",   ok: false, items: [], error: e.message })),
      fetchArxiv(researchQuery).then(items => ({ name: "arxiv",    ok: true,  items })).catch(e => ({ name: "arxiv",    ok: false, items: [], error: e.message })),
      fetchDDG(researchQuery).then(items => ({ name: "ddg",      ok: true,  items })).catch(e => ({ name: "ddg",      ok: false, items: [], error: e.message })),
    ]);

    const responded  = sourceSets.filter(s => s.ok && s.items.length > 0);
    const allItems   = responded.flatMap(s => s.items);

    let synthesis;
    try {
      synthesis = await synthesize(researchQuery, `${loc.name}, ${loc.country}`, weather, allItems, apiKey);
    } catch (err) {
      return {
        error:   "synthesis_failed",
        message: err.message,
        query:   researchQuery,
        location: { name: loc.name, country: loc.country },
        weather,
        generated_at: new Date().toISOString(),
      };
    }

    return {
      query:    researchQuery,
      location: { name: loc.name, country: loc.country, latitude: loc.latitude, longitude: loc.longitude },
      weather,
      brief:                       synthesis.brief                       || "",
      weather_research_connection: synthesis.weather_research_connection || "",
      key_findings:                synthesis.key_findings                || [],
      weather_signal:              synthesis.weather_signal              || "neutral",
      trends:                      synthesis.trends                      || [],
      action_items:                synthesis.action_items                || [],
      sources_queried:   5,
      sources_responded: responded.length,
      generated_at:      new Date().toISOString(),
    };
  },
};
