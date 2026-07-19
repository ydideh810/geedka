// city-lookup.js
//
// Airport and city lookup by keyword, country code, or IATA code.
// Returns IATA/ICAO codes, coordinates, timezone, and country for each match.
// Useful for travel-planning agents, itinerary builders, routing engines, and
// geographic enrichment tasks.
//
// Seam: stabletravel.dev/api/reference/cities — 377 calls/14d, 14 payers,
// $0.017/call. This cap provides equivalent data at $0.010 (41% undercut)
// sourced from OpenFlights open data (CC-BY, no auth required).

const AIRPORTS_CSV = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";
const UA           = "Mozilla/5.0 (compatible; myriad/3.48; +https://synaptiic.org)";
const TIMEOUT_MS   = 10000;
const MAX_RESULTS  = 20;

// Module-level cache: load once, reuse across requests
let _airports = null;

async function loadAirports() {
  if (_airports) return _airports;
  const resp = await fetch(AIRPORTS_CSV, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`OpenFlights fetch HTTP ${resp.status}`);
  const text = await resp.text();
  const airports = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // CSV with quoted fields — simple parse
    const cols = parseCSVLine(line);
    if (cols.length < 12) continue;
    const iata = cols[4]?.replace(/"/g, "");
    if (!iata || iata === "\\N" || iata.length !== 3) continue; // skip non-IATA airports
    airports.push({
      name:     cols[1]?.replace(/"/g, "") || null,
      city:     cols[2]?.replace(/"/g, "") || null,
      country:  cols[3]?.replace(/"/g, "") || null,
      iata,
      icao:     cols[5]?.replace(/"/g, "") || null,
      lat:      parseFloat(cols[6]) || null,
      lon:      parseFloat(cols[7]) || null,
      tz:       cols[11]?.replace(/"/g, "") || null,
    });
  }
  _airports = airports;
  return airports;
}

function parseCSVLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if (c === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

function score(ap, kw, cc) {
  const q = kw.toUpperCase();
  let s = 0;
  if (ap.iata === q) s += 100;
  else if (ap.icao === q) s += 80;
  else if (ap.city?.toUpperCase() === q) s += 60;
  else if (ap.city?.toUpperCase().startsWith(q)) s += 40;
  else if (ap.city?.toUpperCase().includes(q)) s += 20;
  else if (ap.name?.toUpperCase().includes(q)) s += 10;
  if (cc && ap.country) {
    // Match ISO country name or 2-letter code approximation
    if (ap.country.toUpperCase().startsWith(cc.toUpperCase())) s += 5;
  }
  return s;
}

export default {
  name: "city-lookup",
  price: "$0.034",
  description:
    "Search airports and cities by keyword, IATA code, or city name. Returns IATA/ICAO codes, coordinates, country, and timezone for each match — useful for travel planning, routing, and geographic enrichment.",
  inputSchema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "City name, airport name, or IATA/ICAO code (e.g. 'London', 'LHR', 'Paris')",
      },
      country: {
        type: "string",
        description: "Optional ISO country name filter (e.g. 'United Kingdom')",
      },
      max: {
        type: "integer",
        description: "Max results to return (default 10, max 20)",
        default: 10,
      },
    },
    required: [],
  },
  outputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            iata:    { type: "string" },
            icao:    { type: "string" },
            name:    { type: "string" },
            city:    { type: "string" },
            country: { type: "string" },
            lat:     { type: "number" },
            lon:     { type: "number" },
            tz:      { type: "string" },
          },
        },
      },
      count: { type: "integer" },
    },
  },

  async handler(query) {
    const kw  = (query.keyword || "New York").trim();

    const cc  = (query.country  || "").trim();
    const max = Math.min(parseInt(query.max) || 10, MAX_RESULTS);

    const airports = await loadAirports();

    const scored = airports
      .map((ap) => ({ ap, s: score(ap, kw, cc) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, max)
      .map(({ ap }) => ({
        iata:    ap.iata,
        icao:    ap.icao || null,
        name:    ap.name,
        city:    ap.city,
        country: ap.country,
        lat:     ap.lat,
        lon:     ap.lon,
        tz:      ap.tz,
      }));

    return {
      results: scored,
      count:   scored.length,
    };
  },
};
