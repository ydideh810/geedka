// air-quality.js
//
// Real-time air quality for any lat/lon using Open-Meteo's free Air Quality API.
// Returns US AQI with category label, PM2.5, PM10, NO2, O3, CO, dust, and UV index.
//
// Source: Open-Meteo Air Quality API (open-meteo.com) — completely free, no auth.
// Powered by Copernicus Atmosphere Monitoring Service (CAMS) forecasts.
// Data updates hourly.
//
// AQI categories: Good (0-50), Moderate (51-100), Unhealthy for Sensitive Groups
// (101-150), Unhealthy (151-200), Very Unhealthy (201-300), Hazardous (301+).
//
// Seam: paid air quality APIs (IQAir $0.01+, AirVisual $0.01) — free upstream
// makes this profitable at $0.002/call.
//
// [REDACTED]3, 2026-06-07.

const BASE    = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT = 10_000;

const AQI_CATEGORIES = [
  { max: 50,  label: "Good",                         color: "green"  },
  { max: 100, label: "Moderate",                     color: "yellow" },
  { max: 150, label: "Unhealthy for Sensitive Groups", color: "orange" },
  { max: 200, label: "Unhealthy",                    color: "red"    },
  { max: 300, label: "Very Unhealthy",               color: "purple" },
  { max: 999, label: "Hazardous",                    color: "maroon" },
];

function aqiCategory(aqi) {
  if (aqi == null) return { label: "Unknown", color: "gray" };
  return AQI_CATEGORIES.find(c => aqi <= c.max) ?? AQI_CATEGORIES.at(-1);
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

export default {
  name: "air-quality",
  price: "$0.002",

  description:
    "Real-time US AQI and pollutant readings for any lat/lon. Returns current AQI with category label (Good/Moderate/Unhealthy/Hazardous), PM2.5, PM10, nitrogen dioxide, ozone, carbon monoxide, dust levels, and UV index. Data from CAMS (Copernicus Atmosphere Monitoring Service), updated hourly. Use for health advisories, outdoor event planning, environment-sensitive routing, or regulatory compliance checks.",

  inputSchema: {
    type: "object",
    required: ["lat", "lon"],
    properties: {
      lat: {
        type: "number",
        description: "Latitude in decimal degrees (e.g. 40.71 for New York City).",
        minimum: -90,
        maximum: 90,
      },
      lon: {
        type: "number",
        description: "Longitude in decimal degrees (e.g. -74.01 for New York City).",
        minimum: -180,
        maximum: 180,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      lat:          { type: "number" },
      lon:          { type: "number" },
      timezone:     { type: "string" },
      elevation_m:  { type: "number" },
      measured_at:  { type: "string", description: "ISO-8601 local time" },
      aqi: {
        type: "object",
        properties: {
          value:    { type: "integer", description: "US AQI (0–500)" },
          category: { type: "string", description: "Good / Moderate / Unhealthy for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous" },
          color:    { type: "string", description: "Indicator color: green / yellow / orange / red / purple / maroon" },
        },
      },
      pollutants: {
        type: "object",
        properties: {
          pm2_5:            { type: "number", description: "PM2.5 fine particles (µg/m³)" },
          pm10:             { type: "number", description: "PM10 coarse particles (µg/m³)" },
          nitrogen_dioxide: { type: "number", description: "NO₂ (µg/m³)" },
          ozone:            { type: "number", description: "O₃ (µg/m³)" },
          carbon_monoxide:  { type: "number", description: "CO (µg/m³)" },
          dust:             { type: "number", description: "Dust concentration (µg/m³)" },
        },
      },
      uv_index: { type: "number", description: "Current UV index (0–11+)" },
    },
  },

  async handler(query) {
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!isFinite(lat) || lat < -90 || lat > 90)
      throw new Error("lat must be a number between -90 and 90");
    if (!isFinite(lon) || lon < -180 || lon > 180)
      throw new Error("lon must be a number between -180 and 180");

    const url = new URL(BASE);
    url.searchParams.set("latitude",  lat.toFixed(4));
    url.searchParams.set("longitude", lon.toFixed(4));
    url.searchParams.set("timezone",  "auto");
    url.searchParams.set("current",   [
      "us_aqi",
      "pm2_5",
      "pm10",
      "nitrogen_dioxide",
      "ozone",
      "carbon_monoxide",
      "dust",
      "uv_index",
    ].join(","));

    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(`Open-Meteo air quality HTTP ${r.status}`);
    const d = await r.json();

    const cur = d.current ?? {};
    const aqi = cur.us_aqi;
    const cat = aqiCategory(aqi);

    return {
      lat:         d.latitude,
      lon:         d.longitude,
      timezone:    d.timezone ?? "UTC",
      elevation_m: d.elevation ?? null,
      measured_at: cur.time ?? null,
      aqi: {
        value:    aqi ?? null,
        category: cat.label,
        color:    cat.color,
      },
      pollutants: {
        pm2_5:            round2(cur.pm2_5),
        pm10:             round2(cur.pm10),
        nitrogen_dioxide: round2(cur.nitrogen_dioxide),
        ozone:            round2(cur.ozone),
        carbon_monoxide:  round2(cur.carbon_monoxide),
        dust:             round2(cur.dust),
      },
      uv_index: round2(cur.uv_index),
    };
  },
};
