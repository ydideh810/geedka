// weather-history.js
//
// Historical daily weather for any location, date range, and variable set.
// Sourced from Open-Meteo Archive API backed by ERA5 reanalysis data (free, no key).
// Data available from 1940-01-01 to ~5 days before today.
//
// Gap from weather.js (7-day forecast): this retrieves *past* weather, enabling
// analysis of seasonal patterns, anomaly detection, climate trends, and event
// attribution (e.g. "how hot was August 2023 in Phoenix vs. the 30-year average?").
//
// Use cases: agricultural commodity agents (drought/growing-season analysis),
// energy agents (heating/cooling degree days), insurance risk, climate research,
// event-context enrichment, crop-yield modelling.
//
// Upstream: archive-api.open-meteo.com (ERA5 reanalysis, open data, no auth).
// Version: the-stall/4.59.0

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const UA          = "the-stall/4.59.0 (https://intuitek.ai; mailto:kyle@intuitek.ai)";
const TIMEOUT     = 20_000;

// Default variable set — temperature, precipitation, wind, sunshine
const DEFAULT_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "temperature_2m_mean",
  "precipitation_sum",
  "wind_speed_10m_max",
  "sunshine_duration",
];

// All supported daily variables from Open-Meteo Archive API
const VALID_VARS = new Set([
  "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
  "apparent_temperature_max", "apparent_temperature_min", "apparent_temperature_mean",
  "precipitation_sum", "rain_sum", "snowfall_sum", "precipitation_hours",
  "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
  "shortwave_radiation_sum", "sunshine_duration",
  "et0_fao_evapotranspiration",
  "cloud_cover_mean",
  "weather_code",
]);

// WMO weather code → label
const WMO = {
  0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
  45:"Fog",48:"Icy fog",
  51:"Light drizzle",53:"Moderate drizzle",55:"Dense drizzle",
  61:"Slight rain",63:"Moderate rain",65:"Heavy rain",
  71:"Slight snow",73:"Moderate snow",75:"Heavy snow",77:"Snow grains",
  80:"Slight rain showers",81:"Moderate rain showers",82:"Violent rain showers",
  85:"Slight snow showers",86:"Heavy snow showers",
  95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm with heavy hail",
};

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  return resp.json();
}

// Geocode a location name → { latitude, longitude, name, country }
// Tries full string first; if no results, falls back to the part before the first comma
// so "Miami, FL" → "Miami" still resolves.
async function geocode(location) {
  const queries = [location];
  if (location.includes(",")) queries.push(location.split(",")[0].trim());

  for (const q of queries) {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    const data = await fetchJson(url);
    if (data.results?.length) {
      const r = data.results[0];
      return {
        latitude:  r.latitude,
        longitude: r.longitude,
        name:      r.name,
        country:   r.country,
        timezone:  r.timezone,
      };
    }
  }
  throw new Error(`Location not found: "${location}". Try a major city name (e.g. "Phoenix" or "London").`);
}

// Summarise daily array into { min, max, mean, total } — tolerates nulls
function summarise(arr) {
  const vals = (arr || []).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    min:   Math.round(Math.min(...vals) * 100) / 100,
    max:   Math.round(Math.max(...vals) * 100) / 100,
    mean:  Math.round(mean * 100) / 100,
    total: Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100,
  };
}

export default {
  name:  "weather-history",
  price: "$0.039",

  description:
    "Historical daily weather (temperature, precipitation, wind, sunshine) for any location from 1940 to ~5 days ago. Uses ERA5 reanalysis data. Accepts city name or lat,lng. Returns per-day values plus period summary stats. Useful for seasonal analysis, anomaly detection, and climate-context enrichment.",

  inputSchema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description:
          "City name (e.g. 'Phoenix, AZ') or 'lat,lng' (e.g. '33.45,-112.07'). Defaults to 'New York, NY'.",
      },
      start_date: {
        type: "string",
        description: "Start date YYYY-MM-DD (e.g. 2024-01-01). Earliest: 1940-01-01. Defaults to 30 days ago.",
      },
      end_date: {
        type: "string",
        description:
          "End date YYYY-MM-DD (latest: ~5 days before today). Defaults to yesterday if omitted.",
      },
      vars: {
        type: "string",
        description:
          "Comma-separated variable names to include. Defaults to temperature_2m_max, temperature_2m_min, temperature_2m_mean, precipitation_sum, wind_speed_10m_max, sunshine_duration. Valid options: " +
          [...VALID_VARS].sort().join(", "),
      },
      units: {
        type: "string",
        enum: ["metric", "imperial"],
        description:
          "Unit system. 'metric' = °C / mm / km/h (default). 'imperial' = °F / inch / mph.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      location:   { type: "object" },
      period:     { type: "object" },
      units:      { type: "object" },
      daily:      { type: "array" },
      summary:    { type: "object" },
    },
  },

  async handler(query) {
    const { end_date, vars, units = "metric" } = query;

    // Defaults: last 30 days of weather for New York
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const defaultEnd = today.toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);
    const defaultStart = thirtyDaysAgo.toISOString().slice(0, 10);

    const location = (query.location && query.location.trim()) || "New York, NY";
    const start_date = (query.start_date && query.start_date.trim()) || defaultStart;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date))
      throw new Error(`Invalid start_date "${start_date}". Use YYYY-MM-DD format.`);

    const resolvedEnd = end_date || defaultEnd;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedEnd))
      throw new Error(`Invalid end_date "${resolvedEnd}". Use YYYY-MM-DD format.`);

    // Validate date range (ERA5 available from 1940-01-01)
    if (start_date < "1940-01-01")
      throw new Error("ERA5 archive starts at 1940-01-01. Use a later start_date.");
    if (resolvedEnd < start_date)
      throw new Error("end_date must be >= start_date.");

    // Parse and validate requested variables
    const requestedVars = vars
      ? vars.split(",").map((v) => v.trim()).filter(Boolean)
      : DEFAULT_VARS;
    const invalidVars = requestedVars.filter((v) => !VALID_VARS.has(v));
    if (invalidVars.length)
      throw new Error(`Unknown variable(s): ${invalidVars.join(", ")}`);

    // Resolve location — accept "lat,lng" directly or geocode
    let loc;
    const latLngMatch = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/.exec(location.trim());
    if (latLngMatch) {
      loc = {
        latitude:  parseFloat(latLngMatch[1]),
        longitude: parseFloat(latLngMatch[2]),
        name:      location.trim(),
        country:   null,
        timezone:  "auto",
      };
    } else {
      loc = await geocode(location);
    }

    // Unit system parameters
    const tempUnit  = units === "imperial" ? "fahrenheit" : "celsius";
    const windUnit  = units === "imperial" ? "mph"        : "kmh";
    const precipUnit = units === "imperial" ? "inch"      : "mm";

    // Fetch historical archive
    const archiveParams = new URLSearchParams({
      latitude:       loc.latitude,
      longitude:      loc.longitude,
      start_date:     start_date,
      end_date:       resolvedEnd,
      daily:          requestedVars.join(","),
      timezone:       loc.timezone || "auto",
      temperature_unit: tempUnit,
      wind_speed_unit:  windUnit,
      precipitation_unit: precipUnit,
    });

    const archiveData = await fetchJson(`${ARCHIVE_URL}?${archiveParams}`);
    const daily = archiveData.daily || {};
    const times = daily.time || [];

    // Build per-day records
    const days = times.map((date, i) => {
      const row = { date };
      for (const v of requestedVars) {
        const raw = daily[v]?.[i];
        if (v === "weather_code" && raw != null) {
          row[v] = { code: raw, label: WMO[raw] || `WMO ${raw}` };
        } else if (v === "sunshine_duration" && raw != null) {
          // Convert seconds to hours for readability
          row["sunshine_hours"] = Math.round((raw / 3600) * 10) / 10;
        } else {
          row[v] = raw != null ? Math.round(raw * 100) / 100 : null;
        }
      }
      return row;
    });

    // Summary statistics for numeric variables
    const summaryVars = requestedVars.filter(
      (v) => v !== "weather_code" && v !== "wind_direction_10m_dominant"
    );
    const summary = {};
    for (const v of summaryVars) {
      const alias = v === "sunshine_duration" ? "sunshine_hours" : v;
      const arr = v === "sunshine_duration"
        ? days.map((d) => d["sunshine_hours"])
        : days.map((d) => d[v]);
      summary[alias] = summarise(arr);
    }

    return {
      location: {
        name:      loc.name,
        country:   loc.country,
        latitude:  archiveData.latitude  ?? loc.latitude,
        longitude: archiveData.longitude ?? loc.longitude,
        timezone:  archiveData.timezone  ?? loc.timezone,
        elevation: archiveData.elevation ?? null,
      },
      period: {
        start:      start_date,
        end:        resolvedEnd,
        days:       days.length,
      },
      units: {
        temperature:  tempUnit === "celsius" ? "°C" : "°F",
        precipitation: precipUnit === "mm" ? "mm" : "inch",
        wind_speed:   windUnit === "kmh" ? "km/h" : "mph",
        sunshine:     "hours",
      },
      daily:   days,
      summary: summary,
    };
  },
};
