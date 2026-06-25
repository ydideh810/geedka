// flight-tracker.js
//
// Real-time global flight tracking via OpenSky Network ATC transponder data.
// OpenSky aggregates ADS-B receiver networks covering 40,000+ airports and
// up to 200,000 airborne aircraft simultaneously.
//
// Three modes:
//   1. icao24(hex)         — locate a specific aircraft by its 6-hex ICAO24
//                            transponder code. Returns live position, altitude,
//                            speed, heading, squawk. Globally authoritative.
//   2. callsign(cs)        — find an active flight by callsign (ICAO 3-letter
//                            airline format: "AAL123", "UAL456", "DAL789").
//                            Searches CONUS+Canada+Caribbean by default;
//                            set global=true for worldwide search.
//   3. area(...)           — all flights in a bounding box or near an airport.
//                            Supply lamin/lomin/lamax/lomax or airport (IATA code).
//                            Returns up to 50 flights sorted by altitude.
//
// Source: opensky-network.org/api — live ADS-B aggregation (no auth required).
// Data latency: ~10-15 seconds. Unauthenticated rate limit: ~1 req/10s.
// Position coverage: near-complete over US, Europe; partial over oceans.
//
// Seam: agents doing travel research, supply chain tracking, VIP jet monitoring,
// cargo logistics, or aviation due diligence need live flight data. No other
// x402/MCP cap covers real-time ATC/ADS-B flight positions.
//
// Price: $0.010 — single OpenSky API call with structured, unit-converted output.

const OPENSKY_BASE = "https://opensky-network.org/api";
const TIMEOUT_MS  = 18_000;
const UA          = "the-stall/4.69 flight-tracker (kyle@intuitek.ai)";

// Major airport IATA codes → [lat, lon]
const AIRPORT_COORDS = {
  // North America
  ATL: [33.636, -84.428], AUS: [30.194, -97.670], BNA: [36.122, -86.677],
  BOS: [42.365, -71.010], BUF: [42.941, -78.733], CLT: [35.214, -80.943],
  CMH: [39.998, -82.892], DCA: [38.852, -77.037], DEN: [39.856, -104.674],
  DFW: [32.897, -97.038], DTW: [42.212, -83.354], EWR: [40.692, -74.169],
  FLL: [26.072, -80.152], HNL: [21.325, -157.923], HOU: [29.645, -95.279],
  IAD: [38.944, -77.456], IAH: [29.990, -95.337], IND: [39.717, -86.294],
  JFK: [40.640, -73.779], LAS: [36.086, -115.153], LAX: [33.943, -118.408],
  LGA: [40.777, -73.874], MCI: [39.298, -94.714], MCO: [28.429, -81.309],
  MDW: [41.786, -87.752], MEM: [35.043, -89.977], MIA: [25.796, -80.287],
  MKE: [42.948, -87.897], MSP: [44.883, -93.208], MSY: [29.993, -90.258],
  OAK: [37.722, -122.221], OGG: [20.899, -156.430], OMA: [41.302, -95.894],
  ONT: [34.056, -117.601], ORD: [41.979, -87.905], PDX: [45.589, -122.593],
  PHL: [39.872, -75.241], PHX: [33.437, -112.008], PIT: [40.492, -80.233],
  RDU: [35.877, -78.788], RSW: [26.536, -81.756], SAN: [32.734, -117.190],
  SAT: [29.533, -98.470], SEA: [47.449, -122.309], SFO: [37.619, -122.375],
  SJC: [37.362, -121.929], SLC: [40.789, -111.978], STL: [38.749, -90.370],
  TPA: [27.976, -82.533], YEG: [53.310, -113.580], YUL: [45.470, -73.741],
  YVR: [49.194, -123.184], YYC: [51.131, -114.013], YYZ: [43.680, -79.630],
  // Europe
  AMS: [52.310,   4.768], ARN: [59.652,  17.919], ATH: [37.936,  23.944],
  BCN: [41.297,   2.078], BRU: [50.902,   4.484], CDG: [49.009,   2.548],
  CPH: [55.618,  12.656], DUB: [53.421,  -6.270], DUS: [51.290,   6.767],
  FCO: [41.804,  12.252], FRA: [50.034,   8.570], GVA: [46.238,   6.109],
  HAM: [53.631,  10.006], HEL: [60.317,  24.963], IST: [41.275,  28.752],
  LHR: [51.477,  -0.461], LIS: [38.774,  -9.134], MAD: [40.472,  -3.561],
  MAN: [53.354,  -2.275], MUC: [48.354,  11.786], OSL: [60.202,  11.084],
  PRG: [50.101,  14.260], STN: [51.885,   0.235], VCE: [45.505,  12.352],
  VIE: [48.110,  16.570], WAW: [52.166,  20.967], ZRH: [47.458,   8.548],
  // Asia-Pacific
  BKK: [13.681, 100.747], BOM: [19.089,  72.868], CAN: [23.392, 113.299],
  CGK: [-6.126, 106.656], DEL: [28.556,  77.100], DXB: [25.253,  55.364],
  HKG: [22.308, 113.915], ICN: [37.469, 126.451], KUL: [2.745,  101.710],
  MEL: [-37.673, 144.843], NRT: [35.765, 140.386], PEK: [40.072, 116.588],
  PVG: [31.143, 121.805], SIN: [1.359,  103.990], SYD: [-33.946, 151.177],
  // Latin America & Caribbean
  BOG: [4.702, -74.147], EZE: [-34.822, -58.536], GRU: [-23.433, -46.469],
  LIM: [-12.022, -77.114], MEX: [19.436, -99.072], SCL: [-33.393, -70.786],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const res = await fetch(`${OPENSKY_BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("OpenSky rate limit hit — unauthenticated users limited to ~1 req/10s. Retry in 15 seconds.");
    throw new Error(`OpenSky HTTP ${res.status}`);
  }
  return res.json();
}

function msToKnots(ms) {
  return ms != null ? Math.round(ms * 1.94384) : null;
}
function mToFt(m) {
  return m != null ? Math.round(m * 3.28084) : null;
}
function msVrateToFpm(ms) {
  return ms != null ? Math.round(ms * 196.85) : null;
}

// OpenSky state vector field indices
const F = {
  ICAO24: 0, CALLSIGN: 1, COUNTRY: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VEL: 9, TRACK: 10,
  VRATE: 11, GEO_ALT: 13, SQUAWK: 14, SPI: 15,
};

function parseState(s) {
  if (!s) return null;
  const cs = s[F.CALLSIGN]?.trim() || null;
  return {
    icao24:         s[F.ICAO24],
    callsign:       cs,
    origin_country: s[F.COUNTRY],
    on_ground:      s[F.ON_GROUND],
    longitude:      s[F.LON],
    latitude:       s[F.LAT],
    altitude_ft:    mToFt(s[F.BARO_ALT]),
    altitude_m:     s[F.BARO_ALT] != null ? Math.round(s[F.BARO_ALT]) : null,
    speed_kts:      msToKnots(s[F.VEL]),
    heading_deg:    s[F.TRACK] != null ? Math.round(s[F.TRACK]) : null,
    vertical_rate_fpm: msVrateToFpm(s[F.VRATE]),
    squawk:         s[F.SQUAWK] || null,
    last_contact:   s[F.LAST_CONTACT],
  };
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function byIcao24(hex) {
  const clean = hex.toLowerCase().trim();
  const data = await apiFetch(`/states/all?icao24=${clean}`);
  const states = data.states || [];
  if (!states.length) {
    return {
      icao24: clean,
      found: false,
      note: "Aircraft not currently tracked. It may be on the ground, outside coverage, or transponder off.",
      source: "OpenSky Network",
    };
  }
  return {
    icao24: clean,
    found: true,
    flight: parseState(states[0]),
    source: "OpenSky Network (live ADS-B)",
    note: "Position accurate to ~10-15 seconds.",
  };
}

async function byCallsign(callsign, searchGlobal) {
  const target = callsign.trim().toUpperCase().replace(/\s+/g, "");

  // CONUS+Canada+Caribbean bounding box covers >90% of US flights
  const url = searchGlobal
    ? "/states/all"
    : "/states/all?lamin=15&lomin=-140&lamax=55&lomax=-60";

  const data = await apiFetch(url);
  const states = data.states || [];

  const exact = states.filter(s => s[F.CALLSIGN]?.trim().toUpperCase() === target);
  if (exact.length) {
    return {
      callsign: target,
      found: true,
      matches: exact.slice(0, 5).map(parseState),
      total_flights_in_search: states.length,
      search_area: searchGlobal ? "global" : "CONUS+Canada+Caribbean",
      source: "OpenSky Network (live ADS-B)",
    };
  }

  // Partial prefix match (useful if user provided IATA instead of ICAO)
  const partial = states.filter(s => s[F.CALLSIGN]?.trim().toUpperCase().startsWith(target.slice(0, 4)));
  return {
    callsign: target,
    found: false,
    search_area: searchGlobal ? "global" : "CONUS+Canada+Caribbean",
    total_flights_in_search: states.length,
    partial_matches: partial.slice(0, 5).map(parseState),
    note: !searchGlobal
      ? "Not found in CONUS. If flight is international, retry with global=true. Callsigns must use ICAO airline codes (3-letter): 'AAL' not 'AA', 'UAL' not 'UA', 'DAL' not 'DL'."
      : "Not found globally. Confirm ICAO callsign format (e.g. AAL123, UAL456). Aircraft may be on the ground.",
    source: "OpenSky Network (live ADS-B)",
  };
}

async function byArea({ airport, lamin, lomin, lamax, lomax, radius_deg = 0.5, limit = 50 }) {
  let box, areaLabel;

  if (airport) {
    const code = airport.toUpperCase();
    const coords = AIRPORT_COORDS[code];
    if (!coords) {
      const available = Object.keys(AIRPORT_COORDS).sort().join(", ");
      throw new Error(`Airport "${code}" not in lookup table. Supported IATA codes: ${available}`);
    }
    const [lat, lon] = coords;
    const r = Number(radius_deg) || 0.5;
    box = { lamin: lat - r, lomin: lon - r, lamax: lat + r, lomax: lon + r };
    areaLabel = `${code} airport (±${r}°, ~${Math.round(r * 60)} nmi radius)`;
  } else if (lamin != null && lomin != null && lamax != null && lomax != null) {
    box = { lamin: Number(lamin), lomin: Number(lomin), lamax: Number(lamax), lomax: Number(lomax) };
    areaLabel = `${lamin},${lomin} → ${lamax},${lomax}`;
  } else {
    throw new Error("Provide 'airport' (IATA code) OR 'lamin', 'lomin', 'lamax', 'lomax' coordinates.");
  }

  const url = `/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;
  const data = await apiFetch(url);
  const states = data.states || [];

  // Sort: airborne by altitude desc, then ground traffic
  const airborne = states.filter(s => !s[F.ON_GROUND]);
  const onGround = states.filter(s =>  s[F.ON_GROUND]);
  airborne.sort((a, b) => (b[F.BARO_ALT] || 0) - (a[F.BARO_ALT] || 0));

  const cap = Number(limit) || 50;
  const combined = [...airborne, ...onGround].slice(0, cap);

  return {
    area:              areaLabel,
    total_flights:     states.length,
    airborne:          airborne.length,
    on_ground:         onGround.length,
    showing:           combined.length,
    flights:           combined.map(parseState),
    source:            "OpenSky Network (live ADS-B)",
    note:              "Flights sorted: airborne by altitude (highest first), then ground traffic. Positions accurate to ~15s.",
  };
}

// ── Cap export ────────────────────────────────────────────────────────────────

export default {
  name: "flight-tracker",
  price: "$0.010",

  description:
    "Real-time global flight positions via OpenSky Network ADS-B. icao24 mode: locate any aircraft by its 6-hex transponder code — returns altitude (ft), speed (kts), heading, vertical rate, squawk. callsign mode: find a flight by ICAO callsign (e.g. 'AAL123', 'UAL456') across CONUS or globally. area mode: all flights near an airport (IATA code) or within a lat/lon bounding box — returns up to 50 flights sorted by altitude. No API key. Coverage: US/Europe near-complete, oceans partial.",

  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["icao24", "callsign", "area"],
        description: "icao24: lookup by transponder hex | callsign: find flight by ICAO callsign | area: all flights near a location",
      },
      icao24: {
        type: "string",
        description: "6-hex ICAO24 transponder code for icao24 mode. Example: 'a6a7ad' (N-registered US aircraft). Find at planefinder.net or flightaware.com.",
      },
      callsign: {
        type: "string",
        description: "ICAO airline callsign for callsign mode. Use 3-letter ICAO codes: 'AAL123' (American), 'UAL456' (United), 'DAL789' (Delta), 'SWA101' (Southwest), 'BAW7' (British Airways).",
      },
      global: {
        type: "boolean",
        description: "For callsign mode: search globally instead of CONUS-only. Default false. Set true for international flights.",
      },
      airport: {
        type: "string",
        description: "IATA airport code for area mode. Examples: 'ORD', 'LAX', 'JFK', 'LHR', 'DXB'. Searches within radius_deg of the airport.",
      },
      radius_deg: {
        type: "number",
        description: "Radius in degrees for area mode with airport. Default 0.5 (~30 nmi). Use 0.25 for approach/departure, 1.0 for broader traffic picture.",
      },
      lamin: { type: "number", description: "Min latitude (south bound) for area mode bounding box. Example: 33.0" },
      lomin: { type: "number", description: "Min longitude (west bound) for area mode bounding box. Example: -88.0" },
      lamax: { type: "number", description: "Max latitude (north bound) for area mode bounding box. Example: 35.0" },
      lomax: { type: "number", description: "Max longitude (east bound) for area mode bounding box. Example: -86.0" },
      limit: {
        type: "number",
        description: "Max flights to return in area mode. Default 50, max 100.",
      },
    },
    required: ["mode"],
  },

  outputSchema: {
    type: "object",
    properties: {
      found:          { type: "boolean" },
      icao24:         { type: "string"  },
      callsign:       { type: "string"  },
      flight:         { type: "object"  },
      matches:        { type: "array"   },
      partial_matches:{ type: "array"   },
      area:           { type: "string"  },
      total_flights:  { type: "integer" },
      airborne:       { type: "integer" },
      on_ground:      { type: "integer" },
      flights:        { type: "array"   },
      search_area:    { type: "string"  },
      total_flights_in_search: { type: "integer" },
      source:         { type: "string"  },
      note:           { type: "string"  },
    },
  },

  async handler({ mode, icao24, callsign, global: isGlobal, airport, lamin, lomin, lamax, lomax, radius_deg, limit }) {
    switch (mode) {
      case "icao24": {
        if (!icao24) throw new Error("icao24 parameter required for icao24 mode.");
        return byIcao24(icao24);
      }
      case "callsign": {
        if (!callsign) throw new Error("callsign parameter required for callsign mode.");
        return byCallsign(callsign, isGlobal ?? false);
      }
      case "area": {
        return byArea({ airport, lamin, lomin, lamax, lomax, radius_deg, limit });
      }
      default:
        throw new Error(`Unknown mode "${mode}". Use: icao24 | callsign | area`);
    }
  },
};
