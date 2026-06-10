// aviation-weather.js
//
// Current METAR and 24-30h TAF for any airport worldwide.
// Returns raw + parsed aviation weather: conditions, ceiling, visibility,
// wind, flight category (VFR/MVFR/IFR/LIFR), and forecast periods.
//
// Seam: stabletravel.dev/api/flightaware/airports/$ICAO/weather/forecast
//       11 unique payers, 100 calls/72h (2026-06-10 archive scan).
//       FlightAware version is paid; this uses NOAA aviationweather.gov — free, no key.
//
// Upstream: aviationweather.gov NWS Aviation Weather Center
//   METAR: https://aviationweather.gov/api/data/metar?ids={icao}&format=json
//   TAF:   https://aviationweather.gov/api/data/taf?ids={icao}&format=json
// Both endpoints are public, no auth, officially maintained by NOAA.

const AWC_BASE = "https://aviationweather.gov/api/data";
const UA       = "the-stall/4.0 (https://intuitek.ai)";
const TIMEOUT  = 12_000;

// Top-80 IATA → ICAO for user convenience; falls through to raw ICAO if length=4
const IATA_TO_ICAO = {
  ATL:"KATL", LAX:"KLAX", ORD:"KORD", DFW:"KDFW", DEN:"KDEN",
  JFK:"KJFK", SFO:"KSFO", SEA:"KSEA", LAS:"KLAS", MCO:"KMCO",
  EWR:"KEWR", CLT:"KCLT", PHX:"KPHX", IAH:"KIAH", MIA:"KMIA",
  BOS:"KBOS", MSP:"KMSP", DTW:"KDTW", FLL:"KFLL", LGA:"KLGA",
  BWI:"KBWI", SLC:"KSLC", SAN:"KSAN", MDW:"KMDW", TPA:"KTPA",
  PDX:"KPDX", HNL:"PHNL", AUS:"KAUS", STL:"KSTL", OAK:"KOAK",
  BNA:"KBNA", RDU:"KRDU", DCA:"KDCA", SMF:"KSMF", SNA:"KSNA",
  IAD:"KIAD", MCI:"KMCI", MSY:"KMSY", SJC:"KSJC", DAL:"KDAL",
  LHR:"EGLL", LGW:"EGKK", CDG:"LFPG", AMS:"EHAM", FRA:"EDDF",
  MAD:"LEMD", BCN:"LEBL", FCO:"LIRF", MUC:"EDDM", ZRH:"LSZH",
  DUB:"EIDW", CPH:"EKCH", OSL:"ENGM", ARN:"ESSA", HEL:"EFHK",
  SIN:"WSSS", HKG:"VHHH", NRT:"RJAA", HND:"RJTT", ICN:"RKSI",
  PEK:"ZBAA", PVG:"ZSPD", BKK:"VTBS", KUL:"WMKK", SYD:"YSSY",
  MEL:"YMML", DXB:"OMDB", DOH:"OTBD", AUH:"OMAA", JNB:"FAOR",
  GRU:"SBGR", EZE:"SAEZ", MEX:"MMMX", YYZ:"CYYZ", YVR:"CYVR",
};

function resolveIcao(input) {
  const up = (input || "").trim().toUpperCase();
  if (up.length === 4) return up;
  if (up.length === 3 && IATA_TO_ICAO[up]) return IATA_TO_ICAO[up];
  throw new Error(
    `Unknown airport code "${input}". Use 3-letter IATA (JFK) or 4-letter ICAO (KJFK).`
  );
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`AWC API HTTP ${resp.status}: ${url}`);
  return resp.json();
}

function fmtUnix(ts) {
  if (!ts && ts !== 0) return null;
  if (typeof ts === "string") return ts;   // already ISO string from AWC
  return new Date(ts * 1000).toISOString();
}

function parseMETAR(m) {
  if (!m) return null;
  const ceiling = (m.clouds || [])
    .filter(c => c.cover === "BKN" || c.cover === "OVC" || c.cover === "VV")
    .reduce((min, c) => (c.base < min ? c.base : min), Infinity);

  return {
    raw:              m.rawOb || null,
    observed_at:      fmtUnix(m.obsTime) || m.reportTime || null,
    station:          m.icaoId || null,
    station_name:     m.name  || null,
    flight_category:  m.fltCat || null,      // VFR | MVFR | IFR | LIFR
    temp_c:           m.temp  ?? null,
    dewpoint_c:       m.dewp  ?? null,
    wind_dir:         m.wdir  ?? null,       // degrees
    wind_speed_kt:    m.wspd  ?? null,
    wind_gust_kt:     m.wgst  ?? null,
    visibility_sm:    m.visib ?? null,
    ceiling_ft:       isFinite(ceiling) ? ceiling : null,
    altimeter_hPa:    m.altim ?? null,
    sky_conditions:   (m.clouds || []).map(c => ({
      cover: c.cover,
      base_ft: c.base ?? null,
      type:    c.type ?? null,
    })),
    weather_phenomena: m.wxString || null,
    elevation_m:      m.elev  ?? null,
    lat:              m.lat   ?? null,
    lon:              m.lon   ?? null,
  };
}

function parseTAF(t) {
  if (!t) return null;
  return {
    raw:          t.rawTAF || null,
    issued_at:    fmtUnix(t.issueTime) || null,
    valid_from:   fmtUnix(t.validTimeFrom) || null,
    valid_to:     fmtUnix(t.validTimeTo)   || null,
    station_name: t.name || null,
    forecast_periods: (t.fcsts || []).map(f => ({
      from:             fmtUnix(f.timeFrom) || null,
      to:               fmtUnix(f.timeTo)   || null,
      change_type:      f.fcstChange || null,   // FM | BECMG | TEMPO | PROB
      probability:      f.probability ?? null,
      wind_dir:         f.wdir  ?? null,
      wind_speed_kt:    f.wspd  ?? null,
      wind_gust_kt:     f.wgst  ?? null,
      visibility_sm:    f.visib ?? null,
      weather_phenomena: f.wxString || null,
      sky_conditions:   (f.clouds || []).map(c => ({
        cover:   c.cover,
        base_ft: c.base ?? null,
        type:    c.type ?? null,
      })),
    })),
  };
}

export default {
  name: "aviation-weather",

  price: "$0.003",

  description:
    "Aviation weather (METAR + TAF) for any airport. " +
    "Returns current conditions (temp, wind, visibility, ceiling, flight category VFR/MVFR/IFR/LIFR) " +
    "plus 24–30 hour TAF forecast periods. " +
    "Accepts IATA (JFK) or ICAO (KJFK) codes. " +
    "Source: NOAA Aviation Weather Center — official, real-time, no API key.",

  inputSchema: {
    type: "object",
    required: ["airport"],
    properties: {
      airport: {
        type: "string",
        description:
          "Airport code: 3-letter IATA (e.g. JFK, LHR, SYD) or 4-letter ICAO (e.g. KJFK, EGLL, YSSY).",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      airport_icao: { type: "string", description: "Resolved 4-letter ICAO code." },
      metar: {
        type: "object",
        description: "Most recent METAR observation.",
        properties: {
          raw:             { type: ["string","null"], description: "Raw METAR string." },
          observed_at:     { type: ["string","null"], description: "ISO-8601 observation time." },
          flight_category: { type: ["string","null"], description: "VFR | MVFR | IFR | LIFR." },
          temp_c:          { type: ["number","null"], description: "Temperature °C." },
          dewpoint_c:      { type: ["number","null"], description: "Dewpoint °C." },
          wind_dir:        { type: ["number","null"], description: "Wind direction degrees." },
          wind_speed_kt:   { type: ["number","null"], description: "Wind speed knots." },
          wind_gust_kt:    { type: ["number","null"], description: "Wind gust knots (null if calm)." },
          visibility_sm:   { type: ["string","number","null"], description: "Visibility statute miles." },
          ceiling_ft:      { type: ["number","null"], description: "Lowest BKN/OVC/VV layer AGL in feet." },
          altimeter_hPa:   { type: ["number","null"], description: "Altimeter setting hPa." },
          sky_conditions:  { type: "array", description: "Cloud layers array." },
          weather_phenomena: { type: ["string","null"], description: "Wx codes (e.g. -TSRA, VCTS)." },
        },
      },
      taf: {
        type: "object",
        description: "Most recent Terminal Aerodrome Forecast.",
        properties: {
          raw:              { type: ["string","null"], description: "Raw TAF string." },
          issued_at:        { type: ["string","null"], description: "TAF issue time ISO-8601." },
          valid_from:       { type: ["string","null"], description: "Valid period start ISO-8601." },
          valid_to:         { type: ["string","null"], description: "Valid period end ISO-8601." },
          forecast_periods: { type: "array", description: "Array of forecast change groups." },
        },
      },
      ts: { type: "string", description: "ISO-8601 query timestamp." },
    },
  },

  async handler(query) {
    const icao = resolveIcao(query.airport);
    const metarUrl = `${AWC_BASE}/metar?ids=${icao}&format=json`;
    const tafUrl   = `${AWC_BASE}/taf?ids=${icao}&format=json`;

    const [metarData, tafData] = await Promise.all([
      fetchJson(metarUrl),
      fetchJson(tafUrl),
    ]);

    const metar = parseMETAR((metarData || [])[0] || null);
    const taf   = parseTAF((tafData   || [])[0] || null);

    if (!metar && !taf) {
      throw new Error(
        `No aviation weather data found for ${icao}. ` +
        `Verify the airport has an ASOS/AWOS station and is reporting to NWS.`
      );
    }

    return {
      airport_icao: icao,
      metar,
      taf,
      ts: new Date().toISOString(),
    };
  },
};
