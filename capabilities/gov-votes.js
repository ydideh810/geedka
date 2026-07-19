// gov-votes.js
//
// US Congressional vote records via official government XML sources.
// Senate: senate.gov LIS roll call vote menu (no auth, no rate limit)
// House:  clerk.house.gov individual roll call XML files
//
// Replaced GovTrack (permanently 403'd as of 2026-06).
//
// Seam: 2s.io/api/gov/house-votes — 340 sett/wk, 2 payers, $0.004/call

const SENATE_BASE = "https://www.senate.gov/legislative/LIS/roll_call_lists";
const HOUSE_BASE  = "https://clerk.house.gov/evs";
const TIMEOUT     = 18000;
const UA          = "Mozilla/5.0 (compatible; myriad/3.24; +https://synaptiic.org)";

// ─── XML helpers (regex-based; these are simple gov XML files) ───────────────

function tag(xml, t) {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"));
  return m ? m[1].trim() : null;
}

function allTags(xml, t) {
  const rx = new RegExp(`<${t}[^>]*>[\\s\\S]*?</${t}>`, "gi");
  return (xml.match(rx) || []);
}

function attr(el, a) {
  const m = el.match(new RegExp(`${a}="([^"]*)"`, "i"));
  return m ? m[1].trim() : null;
}

// ─── Senate ─────────────────────────────────────────────────────────────────

// Returns { session, year } for congress 119 based on current date.
function senateSession() {
  const y = new Date().getFullYear();
  // 119th Congress: session 1 = 2025, session 2 = 2026
  return { session: y >= 2026 ? 2 : 1, year: y };
}

async function fetchSenateVotes(limit, category) {
  const { session } = senateSession();
  const url = `${SENATE_BASE}/vote_menu_119_${session}.xml`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`Senate XML HTTP ${resp.status}`);
  const xml  = await resp.text();
  const blks = allTags(xml, "vote");
  const out  = [];
  for (const blk of blks) {
    const question = tag(blk, "question") || "";
    const cat      = inferCategory(question);
    if (category && cat !== category) continue;
    const yeas = parseInt(tag(blk, "yeas") || "0", 10);
    const nays = parseInt(tag(blk, "nays") || "0", 10);
    out.push({
      id:          `s${tag(blk,"vote_number")||""}`,
      chamber:     "senate",
      date:        tag(blk, "vote_date") || null,
      question:    question.replace(/\s+/g, " "),
      result:      tag(blk, "result") || null,
      total_plus:  yeas,
      total_minus: nays,
      bill:        tag(blk, "issue") || null,
      title:       tag(blk, "title") || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── House ──────────────────────────────────────────────────────────────────

async function probeLatestHouseRoll() {
  const year = new Date().getFullYear();
  // Probe from 350 downward in steps to find the latest existing roll.
  for (let n = 350; n >= 1; n -= (n > 50 ? 20 : 1)) {
    const url  = `${HOUSE_BASE}/${year}/roll${String(n).padStart(3, "0")}.xml`;
    const resp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      // Found a 200; now step forward 1 at a time to find the true latest.
      let latest = n;
      for (let m = n + 1; m <= n + 25; m++) {
        const u2 = `${HOUSE_BASE}/${year}/roll${String(m).padStart(3, "0")}.xml`;
        const r2 = await fetch(u2, {
          method: "HEAD",
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(5000),
        });
        if (r2.ok) latest = m; else break;
      }
      return { year, latest };
    }
  }
  throw new Error("Could not determine latest House roll call number");
}

function parseHouseRoll(xml, rollNum, year) {
  const yeas = parseInt(
    (xml.match(/<totals-by-vote>[\s\S]*?<yea-total>(\d+)<\/yea-total>/i) || [])[1] || "0", 10
  );
  const nays = parseInt(
    (xml.match(/<totals-by-vote>[\s\S]*?<nay-total>(\d+)<\/nay-total>/i) || [])[1] || "0", 10
  );
  const question = tag(xml, "vote-question") || "";
  return {
    id:          `h${rollNum}`,
    chamber:     "house",
    date:        tag(xml, "action-date") || null,
    question,
    result:      tag(xml, "vote-result") || null,
    total_plus:  yeas,
    total_minus: nays,
    bill:        tag(xml, "legis-num") || null,
    title:       tag(xml, "vote-desc") || null,
  };
}

async function fetchHouseVotes(limit, category) {
  const { year, latest } = await probeLatestHouseRoll();
  const votes = [];
  for (let n = latest; n >= 1 && votes.length < limit; n--) {
    const url  = `${HOUSE_BASE}/${year}/roll${String(n).padStart(3, "0")}.xml`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) continue;
    const xml  = await resp.text();
    const vote = parseHouseRoll(xml, n, year);
    const cat  = inferCategory(vote.question);
    if (category && cat !== category) continue;
    votes.push(vote);
  }
  return votes;
}

// ─── Category inference ──────────────────────────────────────────────────────

function inferCategory(question) {
  const q = (question || "").toLowerCase();
  if (/passage|on passage|third reading/.test(q)) return "passage";
  if (/amendment/.test(q)) return "amendment";
  if (/cloture/.test(q)) return "cloture";
  if (/nomination|confirm/.test(q)) return "nomination";
  if (/treaty/.test(q)) return "treaty";
  if (/impeach/.test(q)) return "impeachment";
  if (/veto/.test(q)) return "veto-override";
  if (/procedural|motion to proceed|rule|previous question/.test(q)) return "procedural";
  return "other";
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name: "gov-votes",
  price: "$0.034",

  description:
    "US Congressional vote records from official government XML sources (senate.gov + clerk.house.gov). Search by chamber (house/senate), category (passage, amendment, cloture, nomination, procedural, etc.), or limit. Returns vote question, result (Passed/Failed), yea/nay totals, bill number, and description. 119th Congress (2025–2026). No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      chamber: {
        type: "string",
        enum: ["house", "senate"],
        description: "Chamber to search. Default: 'senate'.",
      },
      category: {
        type: "string",
        enum: ["passage", "amendment", "cloture", "procedural", "nomination", "treaty", "impeachment", "veto-override", "other"],
        description: "Vote category filter (inferred from vote question).",
      },
      limit: {
        type: "integer",
        description: "Max results (default 10, max 25).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      votes:        { type: "array",   description: "Congressional vote records, most recent first." },
      count:        { type: "integer" },
      chamber:      { type: "string"  },
      generated_at: { type: "string"  },
    },
  },

  async handler(query) {
    const chamber = (query.chamber || "senate").toLowerCase();
    const limit   = Math.min(Math.max(1, parseInt(query.limit, 10) || 10), 25);
    const cat     = query.category || null;

    const votes = chamber === "house"
      ? await fetchHouseVotes(limit, cat)
      : await fetchSenateVotes(limit, cat);

    return {
      votes,
      count:        votes.length,
      chamber,
      generated_at: new Date().toISOString(),
    };
  },
};
