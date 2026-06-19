// sanctions-screening.js
//
// OFAC Specially Designated Nationals (SDN) sanctions screening.
// Checks whether a person, company, vessel, or aircraft appears on the
// US Treasury OFAC SDN list — the primary US sanctions database.
//
// Source: US Treasury OFAC SDN CSV (www.treasury.gov/ofac/downloads/sdn.csv)
// and Alt Names CSV (add.csv) — free, no API key, updated regularly.
// ~19,000 entries: individuals, entities, vessels, aircraft.
//
// Returns: screened (true), hits array with match_score and program codes,
// match_type (exact/partial/alias), and top programs matched.
//
// Use cases: payment compliance, KYB screening, AML checks, counterparty
// due diligence, travel-risk assessment, import/export controls.
//
// Seam: commercial OFAC screening APIs charge $0.01–$0.10/query.
// Direct Treasury data delivers equivalent at $0.005/call.
//
// [REDACTED]3, 2026-06-07.

const SDN_URL  = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ALT_URL  = "https://www.treasury.gov/ofac/downloads/alt.csv";
const TIMEOUT  = 20_000;
const UA       = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";

// Module-level cache — survives multiple calls within one Node.js process
let sdnCache   = null;    // Array of parsed SDN rows
let altCache   = null;    // Map: ent_num → [alt_name, …]
let cacheTime  = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.text();
}

function parseCSV(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = [];
    let inQ = false, cur = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { cols.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

async function loadCache() {
  const now = Date.now();
  if (sdnCache && now - cacheTime < CACHE_TTL) return;

  const [sdnText, altText] = await Promise.allSettled([
    fetchText(SDN_URL),
    fetchText(ALT_URL),
  ]);

  if (sdnText.status !== "fulfilled") throw new Error("Failed to fetch OFAC SDN list");

  sdnCache = parseCSV(sdnText.value).map(row => ({
    ent_num:  row[0]  ?? "",
    name:     row[1]  ?? "",
    type:     row[2]  ?? "",          // individual | vessel | aircraft | -0-
    program:  row[3]  ?? "",
    title:    row[4]  ?? "",
    remarks:  row[11] ?? "",
    _nameLow: (row[1] ?? "").toLowerCase(),
  }));

  // Parse alt.csv for AKA names: ent_num, alt_type, alt_name, alt_remarks
  altCache = new Map();
  if (altText.status === "fulfilled") {
    for (const row of parseCSV(altText.value)) {
      const ent = row[0]; const altName = row[2] ?? "";
      if (!ent || !altName) continue;
      if (!altCache.has(ent)) altCache.set(ent, []);
      altCache.get(ent).push(altName.toLowerCase());
    }
  }

  cacheTime = now;
}

function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 2);
}

function tokenMatches(qt, ct) {
  if (qt === ct) return true;
  // Only allow prefix matching when both tokens are long enough to avoid "putin" ⊂ "happiness"
  if (qt.length >= 4 && ct.length >= 4) return ct.startsWith(qt) || qt.startsWith(ct);
  return false;
}

function scoreMatch(queryTokens, candidate) {
  const candTokens = tokenize(candidate);
  if (!candTokens.length || !queryTokens.length) return 0;
  const hits = queryTokens.filter(qt => candTokens.some(ct => tokenMatches(qt, ct)));
  const precision = hits.length / queryTokens.length;
  const recall    = hits.length / candTokens.length;
  if (!precision && !recall) return 0;
  return (2 * precision * recall) / (precision + recall); // F1
}

function findMatches(query, typeFilter, limit) {
  const qt = tokenize(query);
  if (qt.length === 0) return [];

  const scored = [];

  for (const entry of sdnCache) {
    if (typeFilter && entry.type !== "-0-" && entry.type !== typeFilter) continue;

    let score = scoreMatch(qt, entry._nameLow);
    let matchType = "primary";

    // Check AKA entries from alt.csv
    const alts = altCache.get(entry.ent_num) ?? [];
    for (const alt of alts) {
      const altScore = scoreMatch(qt, alt);
      if (altScore > score) { score = altScore; matchType = "alias"; }
    }

    // Also check remarks for "a.k.a." entries
    const akaMatches = [...entry.remarks.matchAll(/a\.k\.a\.\s*'([^']+)'/gi)];
    for (const [, aka] of akaMatches) {
      const s = scoreMatch(qt, aka.toLowerCase());
      if (s > score) { score = s; matchType = "alias"; }
    }

    if (score >= 0.35) {
      scored.push({ score, entry, matchType });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ score, entry, matchType }) => ({
    ent_num:    entry.ent_num,
    name:       entry.name,
    type:       entry.type === "-0-" ? "entity" : entry.type,
    program:    entry.program.replace(/\] \[/g, ", ").replace(/[\[\]]/g, ""),
    title:      entry.title === "-0-" ? null : entry.title || null,
    remarks:    entry.remarks === "-0-" ? null : entry.remarks.slice(0, 200) || null,
    match_score: Math.round(score * 100),
    match_type:  matchType,
  }));
}

export default {
  name:  "sanctions-screening",
  price: "$0.005",

  description:
    "OFAC SDN sanctions screening — checks whether a person, company, vessel, or aircraft appears on the US Treasury Specially Designated Nationals list. Returns match score, sanctions program(s), and entity type. Covers ~19,000 entries including RUSSIA-EO14024, SDGT, IRAN, DPRK, TCO, and 30+ programs. Use for payment compliance, KYB/KYC, AML checks, and counterparty due diligence.",

  inputSchema: {
    type:       "object",
    required: [],
    properties: {
      name: {
        type:        "string",
        description: "Entity name to screen (person, company, vessel, or aircraft). Full name preferred; partial name also works.",
        minLength:   2,
        maxLength:   200,
      },
      type: {
        type:        "string",
        enum:        ["individual", "entity", "vessel", "aircraft"],
        description: "Optional type filter. Omit to search all types.",
      },
      limit: {
        type:        "integer",
        description: "Maximum number of hits to return. Default 10, max 50.",
        default:     10,
        minimum:     1,
        maximum:     50,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:         { type: "string" },
      type_filter:   { type: "string" },
      matched:       { type: "boolean", description: "True if any hits found at or above 35% match score" },
      hit_count:     { type: "integer" },
      hits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ent_num:     { type: "string", description: "OFAC internal entity number" },
            name:        { type: "string", description: "Official SDN name" },
            type:        { type: "string", description: "individual | entity | vessel | aircraft" },
            program:     { type: "string", description: "Sanctions program(s) e.g. RUSSIA-EO14024, SDGT" },
            title:       { type: ["string", "null"] },
            remarks:     { type: ["string", "null"], description: "AKA aliases and remarks (first 200 chars)" },
            match_score: { type: "integer", description: "0–100 name match confidence (F1 score)" },
            match_type:  { type: "string", description: "primary | alias (matched via AKA)" },
          },
        },
      },
      programs_hit:  { type: "array", items: { type: "string" } },
      sdn_list_date: { type: "string", description: "Date the SDN list was last fetched (YYYY-MM-DD)" },
      source:        { type: "string" },
      disclaimer:    { type: "string" },
    },
  },

  async handler({ name = "North Korea", type, limit = 10 }) {

    await loadCache();

    const hits     = findMatches(name.trim(), type, Math.min(limit, 50));
    const matched  = hits.length > 0;
    const programs = [...new Set(hits.map(h => h.program))].slice(0, 8);

    return {
      query:         name.trim(),
      type_filter:   type ?? "all",
      matched,
      hit_count:     hits.length,
      hits,
      programs_hit:  programs,
      sdn_list_date: new Date(cacheTime).toISOString().slice(0, 10),
      source:        "US Treasury OFAC SDN List",
      disclaimer:    "Screening result is advisory only. A hit requires manual review. A clean result does not guarantee entity is not sanctioned.",
    };
  },
};
