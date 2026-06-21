// earthquake-intel.js
//
// Real-time and historical earthquake intelligence from the USGS FDSN API.
// Two modes: "recent" for global significant events (M5.0+ default, last 7d)
// and "location" for quakes near a lat/lon (M3.0+ within 500km default).
//
// Returns magnitude, depth, place, time, tsunami flag, and shake intensity
// (CDI/MMI) plus a summary with max magnitude, average depth, and event count.
//
// Free upstream: USGS Earthquake Hazards Program FDSN Web Services
// (earthquake.usgs.gov/fdsnws). No API key. ~150K events/month globally.
//
// Agent use cases: disaster risk assessment, property due diligence,
// insurance underwriting, infrastructure monitoring, supply chain routing
// around seismically active zones.
//
// Price: $0.005

const BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const _cache = new Map(); // cacheKey → { ts, data }

// USGS GeoJSON feeds (pre-computed, rate-limit resistant, updated every 60s)
const FEEDS = {
  "5.0_week":  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/5.0_week.geojson",
  "4.5_week":  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
  "2.5_week":  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
};

async function fetchUSGSFeed(minMag) {
  const feedKey = minMag >= 5.0 ? "5.0_week" : minMag >= 4.5 ? "4.5_week" : "2.5_week";
  const url = FEEDS[feedKey];
  const resp = await fetch(url, {
    headers: { "User-Agent": "the-stall/4.3 (+https://intuitek.ai)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`USGS feed HTTP ${resp.status}`);
  return resp;
}

async function fetchUSGS(url, opts) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(12_000) });
    if (resp.ok) return resp;
    // 400 = USGS rate-limit on query API (returns 400 not 429); retry with backoff
    const retryable = resp.status >= 400 && resp.status < 500 ? attempt < 5 : attempt < 3;
    if (retryable) {
      await new Promise(r => setTimeout(r, Math.min(2 ** attempt * 1000, 16000)));
      continue;
    }
    throw new Error(`USGS API error: HTTP ${resp.status}`);
  }
  throw new Error("USGS API error: exhausted retries");
}

function iso(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

function r2(n) { return Math.round(n * 100) / 100; }

export default {
  name: "earthquake-intel",
  price: "$0.039",
  description:
    "Real-time earthquake intelligence from USGS. Fetch recent global significant quakes (M5.0+ last 7 days) or quakes near a lat/lon (M3.0+ within 500 km). Returns magnitude, depth, location, tsunami flag, and shake intensity. Free USGS FDSN API — no key required.",

  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["recent", "location"],
        description: "recent = global events sorted by time/magnitude; location = near a lat/lon coordinate. Default: recent.",
      },
      days: {
        type: "number",
        description: "Look-back window in days (1–30). Default: 7.",
      },
      min_magnitude: {
        type: "number",
        description: "Minimum Richter magnitude to include. Default: 5.0 (recent) or 3.0 (location).",
      },
      lat: {
        type: "number",
        description: "Latitude in decimal degrees. Required for location mode.",
      },
      lon: {
        type: "number",
        description: "Longitude in decimal degrees. Required for location mode.",
      },
      radius_km: {
        type: "number",
        description: "Search radius in km for location mode (10–1000). Default: 500.",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (5–50). Default: 20.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      mode:        { type: "string" },
      window_days: { type: "number" },
      total_count: { type: "number" },
      summary: {
        type: "object",
        properties: {
          max_magnitude:     { type: "number" },
          max_magnitude_place: { type: "string" },
          avg_depth_km:      { type: "number" },
          tsunami_warnings:  { type: "number" },
          significant_events: { type: "number", description: "Events with USGS significance score >= 600." },
        },
      },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:          { type: "string" },
            magnitude:   { type: "number" },
            mag_type:    { type: "string" },
            place:       { type: "string" },
            time_utc:    { type: "string" },
            depth_km:    { type: "number" },
            latitude:    { type: "number" },
            longitude:   { type: "number" },
            tsunami:     { type: "boolean" },
            cdi:         { type: "number",  description: "Community Internet Intensity Map (felt shaking, 1-10)." },
            mmi:         { type: "number",  description: "Instrumental intensity (ShakeMap, 1-10)." },
            alert:       { type: "string",  description: "PAGER alert level: green/yellow/orange/red." },
            significance: { type: "number", description: "USGS significance score (0-1000+)." },
            felt_reports: { type: "number" },
            url:         { type: "string" },
          },
        },
      },
    },
  },

  async handler({ mode = "recent", days, min_magnitude, lat, lon, radius_km, limit }) {
    mode = (mode === "location") ? "location" : "recent";

    const windowDays  = Math.min(Math.max(Number(days) || 7, 1), 30);
    const defaultMag  = mode === "location" ? 3.0 : 5.0;
    const minMag      = Number(min_magnitude) ?? defaultMag;
    const clampedMag  = Math.min(Math.max(minMag, 1.0), 9.9);
    const maxResults  = Math.min(Math.max(Number(limit) || 20, 5), 50);

    const params = new URLSearchParams({
      format:       "geojson",
      starttime:    iso(windowDays),
      minmagnitude: String(clampedMag),
      orderby:      "magnitude",
      limit:        String(maxResults),
    });

    if (mode === "location") {
      if (lat === undefined || lon === undefined) {
        throw new Error("lat and lon are required for location mode");
      }
      params.set("latitude",      String(Number(lat)));
      params.set("longitude",     String(Number(lon)));
      params.set("maxradiuskm",   String(Math.min(Math.max(Number(radius_km) || 500, 10), 1000)));
      params.set("orderby",       "time");
    }

    const cacheKey = `${mode}|${windowDays}|${clampedMag}|${lat ?? ""}|${lon ?? ""}`;
    const cached = _cache.get(cacheKey);

    let data;
    try {
      let resp;
      if (mode === "recent" && windowDays <= 7) {
        // Use pre-computed GeoJSON feed for recent mode — avoids USGS query API rate-limits
        resp = await fetchUSGSFeed(clampedMag);
      } else {
        resp = await fetchUSGS(`${BASE}?${params}`, {
          headers: { "User-Agent": "the-stall/4.3 (+https://intuitek.ai)" },
        });
      }
      data = await resp.json();
      _cache.set(cacheKey, { ts: Date.now(), data });
    } catch (err) {
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        data = cached.data;
      } else {
        throw err;
      }
    }
    const features = data.features || [];

    const events = features.map(f => {
      const p  = f.properties;
      const [glon, glat, depth] = f.geometry.coordinates;
      return {
        id:          f.id,
        magnitude:   p.mag !== null ? r2(p.mag) : null,
        mag_type:    p.magType || null,
        place:       p.place || null,
        time_utc:    p.time ? new Date(p.time).toISOString() : null,
        depth_km:    depth !== null ? r2(depth) : null,
        latitude:    r2(glat),
        longitude:   r2(glon),
        tsunami:     p.tsunami === 1,
        cdi:         p.cdi !== null ? r2(p.cdi) : null,
        mmi:         p.mmi !== null ? r2(p.mmi) : null,
        alert:       p.alert || null,
        significance: p.sig || 0,
        felt_reports: p.felt || 0,
        url:         p.url || null,
      };
    });

    // Summary stats
    const mags       = events.map(e => e.magnitude).filter(m => m !== null);
    const depths     = events.map(e => e.depth_km).filter(d => d !== null);
    const maxMag     = mags.length ? Math.max(...mags) : null;
    const maxMagEvt  = maxMag !== null ? events.find(e => e.magnitude === maxMag) : null;
    const avgDepth   = depths.length ? r2(depths.reduce((a, b) => a + b, 0) / depths.length) : null;
    const tsunamiCnt = events.filter(e => e.tsunami).length;
    const sigCnt     = events.filter(e => (e.significance || 0) >= 600).length;

    return {
      mode,
      window_days:   windowDays,
      total_count:   data.metadata?.count ?? features.length,
      summary: {
        max_magnitude:        maxMag,
        max_magnitude_place:  maxMagEvt?.place ?? null,
        avg_depth_km:         avgDepth,
        tsunami_warnings:     tsunamiCnt,
        significant_events:   sigCnt,
      },
      events,
    };
  },
};
