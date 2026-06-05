// flight-tracker.js
//
// Live and recent flight data by airport — departures/arrivals and live region scan.
// Returns callsign, route, estimated times, and aircraft ICAO for each flight.
//
// Seam: stabletravel.dev/api/flights/status (401 settlements/wk, 32 payers)
//       stabletravel.dev/api/reference/cities (377 settlements/wk, 14 payers)
// Upstream: OpenSky Network public API — crowd-sourced ADS-B, free, no key required.
//
// OpenSky returns ICAO 4-letter airport codes (KJFK, EGLL, etc.).
// This capability accepts both IATA (JFK) and ICAO (KJFK) formats.

const OPENSKY = "https://opensky-network.org/api";
const UA      = "Mozilla/5.0 (compatible; the-stall/3.2; +https://intuitek.ai)";
const TIMEOUT = 15000;

// IATA → ICAO map for top 80 global airports
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
  MAD:"LEMD", BCN:"LEBL", FCO:"LIRF", MUC:"EDDM", ZUR:"LSZH",
  DUB:"EIDW", CPH:"EKCH", OSL:"ENGM", ARN:"ESSA", HEL:"EFHK",
  SIN:"WSSS", HKG:"VHHH", NRT:"RJAA", HND:"RJTT", ICN:"RKSI",
  PEK:"ZBAA", PVG:"ZSPD", BKK:"VTBS", KUL:"WMKK", SYD:"YSSY",
  MEL:"YMML", DXB:"OMDB", DOH:"OTBD", AUH:"OMAA", JNB:"FAOR",
  GRU:"SBGR", EZE:"SAEZ", MEX:"MMMX", YYZ:"CYYZ", YVR:"CYVR",
};

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (resp.status === 429) throw new Error("OpenSky rate limit reached — try again in 10 seconds");
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from OpenSky`);
  return resp.json();
}

function resolveIcao(input) {
  const up = (input || "").trim().toUpperCase();
  if (up.length === 4) return up;             // already ICAO
  if (up.length === 3 && IATA_TO_ICAO[up]) return IATA_TO_ICAO[up];
  throw new Error(`Unknown airport code "${input}". Use 3-letter IATA (JFK) or 4-letter ICAO (KJFK).`);
}

function fmtTime(unixSec) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000).toISOString();
}

export default {
  name:  "flight-tracker",
  price: "$0.008",

  description:
    "Recent departures or arrivals at any major airport via OpenSky Network (free, crowd-sourced ADS-B). Accepts 3-letter IATA (JFK) or 4-letter ICAO (KJFK) codes. Returns callsign, origin/destination airports, estimated times, and aircraft identifiers. Useful for logistics workflows, travel agents, itinerary builders, and supply-chain tracking tasks. Default: departures from airport in last 4 hours.",

  inputSchema: {
    type: "object",
    required: ["airport"],
    properties: {
      airport: {
        type: "string",
        description: "Airport code in IATA (3-letter, e.g. 'JFK') or ICAO (4-letter, e.g. 'KJFK') format.",
      },
      direction: {
        type: "string",
        enum: ["departures", "arrivals"],
        default: "departures",
        description: "Whether to return departing or arriving flights. Defaults to 'departures'.",
      },
      hours: {
        type: "number",
        minimum: 1,
        maximum: 24,
        default: 4,
        description: "Look-back window in hours (1–24). Defaults to 4. Larger windows return more flights.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      airport_icao: { type: "string",  description: "ICAO code of the queried airport." },
      direction:    { type: "string",  description: "departures or arrivals." },
      hours:        { type: "number",  description: "Look-back window used." },
      count:        { type: "number",  description: "Number of flights returned." },
      flights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            callsign:      { type: ["string","null"], description: "Flight callsign / airline+flight number." },
            icao24:        { type: "string",          description: "Aircraft transponder ICAO24 hex address." },
            origin:        { type: ["string","null"], description: "ICAO code of departure airport." },
            destination:   { type: ["string","null"], description: "ICAO code of arrival airport." },
            first_seen:    { type: ["string","null"], description: "ISO-8601 time when flight first appeared." },
            last_seen:     { type: ["string","null"], description: "ISO-8601 time of last ADS-B contact." },
          },
        },
      },
      coverage_note: { type: "string", description: "Data completeness caveat." },
      ts:            { type: "string", description: "ISO-8601 query timestamp." },
    },
  },

  async handler(query) {
    const icao      = resolveIcao(query.airport);
    const direction = query.direction === "arrivals" ? "arrivals" : "departures";
    const hours     = Math.min(24, Math.max(1, Number(query.hours) || 4));

    const nowSec   = Math.floor(Date.now() / 1000);
    const beginSec = nowSec - hours * 3600;

    const endpoint = direction === "arrivals" ? "arrival" : "departure";
    const url = `${OPENSKY}/flights/${endpoint}?airport=${icao}&begin=${beginSec}&end=${nowSec}`;

    const raw = await fetchJson(url);
    if (!Array.isArray(raw)) throw new Error("Unexpected OpenSky response shape");

    const flights = raw.map(f => ({
      callsign:    (f.callsign || "").trim() || null,
      icao24:      f.icao24 || null,
      origin:      f.estDepartureAirport || null,
      destination: f.estArrivalAirport   || null,
      first_seen:  fmtTime(f.firstSeen),
      last_seen:   fmtTime(f.lastSeen),
    }));

    return {
      airport_icao: icao,
      direction,
      hours,
      count: flights.length,
      flights,
      coverage_note:
        "OpenSky Network uses volunteer ADS-B receivers. Coverage is strongest over North America and Europe. " +
        "Arrivals data may be sparse for airports with fewer nearby receivers. " +
        "Very recent flights (<30min) may not appear yet.",
      ts: new Date().toISOString(),
    };
  },
};
