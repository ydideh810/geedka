// usgs-earthquake.js
//
// Returns real-time earthquake events from the USGS Earthquake Hazards Program.
// Source: USGS FDSN Event Web Service — public domain, no API key, global coverage.
// Updated within minutes of event detection. Priced at $0.002/call.
//
// Seam: Commercial seismic risk APIs (RMS, Verisk AIR) cost $10K+/yr. USGS
// primary feed delivers equivalent event data at near-zero marginal cost.

const USGS_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query";

export default {
  name: "usgs-earthquake",
  price: "$0.039",

  description:
    "Real-time global earthquake events from USGS. Filter by magnitude, depth, location radius, or time window. Returns location, magnitude, depth, PAGER alert, and USGS event URL. Free primary source — no API key.",

  inputSchema: {
    type: "object",
    properties: {
      min_magnitude: {
        type: "number",
        description: "Minimum Richter magnitude to include. Default 4.5.",
      },
      days_back: {
        type: "number",
        description: "How many days of events to fetch (1–30). Default 7.",
      },
      limit: {
        type: "number",
        description: "Maximum number of events to return (1–100). Default 20.",
      },
      latitude: {
        type: "number",
        description: "Center latitude for radius search (decimal degrees). Requires longitude and radius_km.",
      },
      longitude: {
        type: "number",
        description: "Center longitude for radius search (decimal degrees). Requires latitude and radius_km.",
      },
      radius_km: {
        type: "number",
        description: "Search radius in km around lat/lon. Max 20001. Default 500 when lat/lon provided.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      count:         { type: "integer", description: "Number of events returned." },
      window_days:   { type: "number",  description: "Time window searched (days back from now)." },
      min_magnitude: { type: "number",  description: "Minimum magnitude filter applied." },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:         { type: "string",  description: "USGS event ID." },
            time:       { type: "string",  description: "ISO-8601 UTC event time." },
            magnitude:  { type: "number",  description: "Magnitude (Richter scale)." },
            mag_type:   { type: "string",  description: "Magnitude type (mww, ml, mb, etc.)." },
            depth_km:   { type: "number",  description: "Hypocenter depth in km." },
            place:      { type: "string",  description: "Human-readable location description." },
            latitude:   { type: "number",  description: "Epicenter latitude." },
            longitude:  { type: "number",  description: "Epicenter longitude." },
            alert:      { type: "string",  description: "PAGER alert level: green/yellow/orange/red (null if not assessed)." },
            tsunami:    { type: "integer", description: "Tsunami warning flag: 1 = warning issued, 0 = none." },
            felt:       { type: "integer", description: "Number of 'Did You Feel It?' responses (null if none)." },
            sig:        { type: "integer", description: "USGS significance score (0–1000). Higher = more impactful." },
            url:        { type: "string",  description: "USGS event detail page URL." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const minMag   = Math.max(0, Math.min(10, query.min_magnitude ?? 4.5));
    const daysBack = Math.max(1, Math.min(30, query.days_back ?? 7));
    const limit    = Math.max(1, Math.min(100, query.limit ?? 20));

    const endTime   = new Date();
    const startTime = new Date(endTime.getTime() - daysBack * 86400000);

    const params = new URLSearchParams({
      format:         "geojson",
      starttime:      startTime.toISOString().replace("Z", "+00:00"),
      endtime:        endTime.toISOString().replace("Z", "+00:00"),
      minmagnitude:   String(minMag),
      orderby:        "time",
      limit:          String(limit),
    });

    const lat = query.latitude;
    const lon = query.longitude;
    if (typeof lat === "number" && typeof lon === "number") {
      const radius = query.radius_km ?? 500;
      params.set("latitude",  String(lat));
      params.set("longitude", String(lon));
      params.set("maxradiuskm", String(Math.min(20001, radius)));
    }

    const url = `${USGS_BASE}?${params}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "the-stall/0.4 (x402 MCP; +https://intuitek.ai)" },
    });
    if (!resp.ok) throw new Error(`USGS API error ${resp.status}: ${await resp.text().catch(() => "")}`);

    const data = await resp.json();
    const features = data.features ?? [];

    const events = features.map((f) => {
      const p  = f.properties;
      const g  = f.geometry.coordinates;  // [lon, lat, depth]
      return {
        id:        f.id,
        time:      new Date(p.time).toISOString(),
        magnitude: p.mag,
        mag_type:  p.magType,
        depth_km:  g[2],
        place:     p.place,
        latitude:  g[1],
        longitude: g[0],
        alert:     p.alert ?? null,
        tsunami:   p.tsunami ?? 0,
        felt:      p.felt ?? null,
        sig:       p.sig,
        url:       p.url,
      };
    });

    return {
      count:         events.length,
      window_days:   daysBack,
      min_magnitude: minMag,
      events,
      ts: new Date().toISOString(),
    };
  },
};
