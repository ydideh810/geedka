// wayback-intel.js
//
// Queries the Internet Archive (Wayback Machine) for historical snapshots of
// any public URL. Uses the free Availability API and CDX Search API — no
// authentication or API key required.
//
// Returns the closest archived snapshot URL, capture timestamp, and HTTP status
// code at archive time. Optionally lists up to 10 recent snapshots to trace
// how a site has changed over time.
//
// Useful for: research agents verifying historical website content, due diligence
// agents confirming when a domain was first archived, fact-checking agents
// validating historical claims, compliance agents retrieving archived regulatory
// disclosures, and competitive intelligence agents tracking competitor site changes.
//
// Free upstream: archive.org/wayback/available (closest snapshot lookup) +
//   web.archive.org/cdx/search/cdx (paginated snapshot list). No auth, open data.
// Archive covers 27+ years of web history, ~800 billion pages.

const WAYBACK_AVAIL = "https://archive.org/wayback/available";
const CDX_API       = "https://web.archive.org/cdx/search/cdx";
const TIMEOUT_MS    = 18000;
const UA            = "Mozilla/5.0 (compatible; the-stall/4.45; +https://intuitek.ai)";

async function getJSON(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Wayback HTTP ${r.status} for ${url}`);
  return r.json();
}

function parseTs(ts) {
  if (!ts || ts.length < 8) return ts;
  const y  = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d  = ts.slice(6, 8);
  const h  = ts.length >= 10 ? ts.slice(8, 10) : "00";
  const mi = ts.length >= 12 ? ts.slice(10, 12) : "00";
  const s  = ts.length >= 14 ? ts.slice(12, 14) : "00";
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function normTs(input) {
  if (!input) return "";
  return input.replace(/[-:TZ\s]/g, "").slice(0, 14);
}

export default {
  name:  "wayback-intel",
  price: "$0.034",

  description:
    "Queries the Internet Archive Wayback Machine for historical snapshots of any public URL. " +
    "Returns the closest archived snapshot URL, capture timestamp (ISO 8601), and HTTP status " +
    "code at the time of capture. Optionally lists up to 10 recent snapshots to trace how a " +
    "site evolved over time. Covers 800B+ archived pages spanning 27+ years of web history. " +
    "Useful for due diligence (when was this domain first archived?), fact-checking, competitor " +
    "tracking, and retrieving archived regulatory or financial disclosures.",

  inputSchema: {
    type:     "object",
    required: [],
    properties: {
      url: {
        type:        "string",
        description: "URL to look up in the Wayback Machine. May include or omit the scheme (e.g. 'example.com', 'https://sec.gov/edgar/').",
      },
      timestamp: {
        type:        "string",
        description: "Target date/time for the nearest snapshot. Accepts YYYYMMDD, YYYYMMDDHHMMSS, or ISO 8601 (e.g. '20200101', '2022-06-15'). Omit for the most recent snapshot.",
      },
      list_snapshots: {
        type:        "boolean",
        description: "If true, also return a list of up to 10 snapshots with timestamps, HTTP status, and direct archive URLs. Useful for tracking how a site changed over time. Default: false.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      url:      { type: "string" },
      archived: { type: "boolean", description: "True if at least one snapshot exists for this URL." },
      snapshot: {
        type: ["object", "null"],
        description: "Closest snapshot to the requested timestamp, or null if never archived.",
        properties: {
          archive_url:   { type: "string" },
          timestamp:     { type: "string", description: "ISO 8601 capture time." },
          raw_timestamp: { type: "string", description: "Wayback raw timestamp (YYYYMMDDHHmmss)." },
          http_status:   { type: "string" },
        },
      },
      snapshots: {
        type: ["array", "null"],
        description: "List of up to 10 recent snapshots (populated when list_snapshots=true).",
        items: {
          type: "object",
          properties: {
            timestamp:     { type: "string" },
            raw_timestamp: { type: "string" },
            http_status:   { type: "string" },
            mime_type:     { type: "string" },
            archive_url:   { type: "string" },
          },
        },
      },
    },
  },

  async handler({ url = "https://anthropic.com", timestamp, list_snapshots }) {
    const ts = normTs(timestamp);

    // Step 1 — closest snapshot via availability API
    const availQ = new URLSearchParams({ url });
    if (ts) availQ.set("timestamp", ts);
    const avail = await getJSON(`${WAYBACK_AVAIL}?${availQ}`);

    const closest = avail?.archived_snapshots?.closest ?? null;
    const result  = {
      url,
      archived:  !!(closest?.available),
      snapshot:  null,
      snapshots: null,
    };

    if (closest?.available) {
      result.snapshot = {
        archive_url:   closest.url.replace(/^http:/, "https:"),
        timestamp:     parseTs(closest.timestamp),
        raw_timestamp: closest.timestamp,
        http_status:   closest.status ?? "unknown",
      };
    }

    // Step 2 — optional snapshot list via CDX API
    if (list_snapshots) {
      const cdxQ = new URLSearchParams({
        url,
        output:   "json",
        limit:    "10",
        fl:       "timestamp,statuscode,mimetype",
        collapse: "timestamp:8",
      });
      if (ts) cdxQ.set("to", ts);

      try {
        const cdx = await getJSON(`${CDX_API}?${cdxQ}`);
        if (Array.isArray(cdx) && cdx.length > 1) {
          const [, ...rows] = cdx;
          result.snapshots = rows.reverse().map(row => ({
            timestamp:     parseTs(row[0]),
            raw_timestamp: row[0],
            http_status:   row[1],
            mime_type:     row[2],
            archive_url:   `https://web.archive.org/web/${row[0]}/${url}`,
          }));
        } else {
          result.snapshots = [];
        }
      } catch {
        result.snapshots = [];
      }
    }

    return result;
  },
};
