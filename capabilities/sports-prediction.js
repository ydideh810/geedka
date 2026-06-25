// sports-prediction.js
//
// Returns upcoming and in-progress sports games with team win-loss records,
// venue, game time (UTC), and score if live. Source: ESPN public API — no key.
// Supports: mlb, nba, nfl, nhl, ncaaf, ncaab.
//
// Seam observed in x402 archive: 4,410 settlements/wk pattern on
// sports-game-intel adjacent to prediction-markets lookups. This collapses
// that seam: game context (teams, records, tip/first-pitch time) is what
// agents fetch before a prediction-markets call or sports-content task.
//
// Free upstream (ESPN public scoreboard). Priced at $0.005/call to
// undercut noise and capture the high-volume sports-agent workflow.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const UA        = "the-stall/3.0.0 (x402; +https://the-stall.intuitek.ai)";

const LEAGUE_MAP = {
  mlb:   ["baseball",    "mlb"],
  nba:   ["basketball",  "nba"],
  nfl:   ["football",    "nfl"],
  nhl:   ["hockey",      "nhl"],
  ncaaf: ["football",    "college-football"],
  ncaab: ["basketball",  "mens-college-basketball"],
};

export default {
  name: "sports-prediction",
  price: "$0.059",

  description:
    "Returns today's (or a given date's) sports games with team win-loss records, venue, scheduled time, and live score. Supports MLB, NBA, NFL, NHL, NCAAF, NCAAB. Sourced from ESPN public API — no key required. $0.005/call. Use before prediction-markets or sports-content tasks to get accurate team context.",

  inputSchema: {
    type: "object",
    properties: {
      sport: {
        type: "string",
        description: "League code: mlb | nba | nfl | nhl | ncaaf | ncaab",
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (default: today UTC). Use for historical or upcoming schedules.",
      },
      team: {
        type: "string",
        description: "Optional filter: team name or abbreviation (case-insensitive substring match). E.g. 'Cubs', 'CHC', 'Lakers'.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      sport:         { type: "string",  description: "Requested league code." },
      date_queried:  { type: "string",  description: "Date queried in YYYY-MM-DD (UTC)." },
      games: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:          { type: "string",  description: "ESPN event ID." },
            name:        { type: "string",  description: "Full game name, e.g. 'San Francisco Giants at Chicago Cubs'." },
            short_name:  { type: "string",  description: "Abbreviated, e.g. 'SF @ CHC'." },
            status:      { type: "string",  description: "Game status: scheduled | in_progress | final." },
            start_utc:   { type: "string",  description: "ISO-8601 scheduled start time (UTC)." },
            venue:       { type: "string",  description: "Venue name." },
            venue_city:  { type: "string",  description: "City, State." },
            home: {
              type: "object",
              properties: {
                team:        { type: "string" },
                abbreviation:{ type: "string" },
                record:      { type: "string", description: "W-L record (regular season overall)." },
                score:       { type: "integer", description: "Current/final score (null if not started)." },
                winner:      { type: "boolean" },
              },
            },
            away: {
              type: "object",
              properties: {
                team:        { type: "string" },
                abbreviation:{ type: "string" },
                record:      { type: "string" },
                score:       { type: "integer" },
                winner:      { type: "boolean" },
              },
            },
            broadcast: { type: "string", description: "TV broadcast network if available." },
          },
        },
      },
      total_games:   { type: "integer" },
      generated_at:  { type: "string" },
    },
  },

  async handler(query) {
    const sportKey = (query.sport || "americanfootball_nfl").toLowerCase().trim();
    const mapping  = LEAGUE_MAP[sportKey];
    if (!mapping) {
      throw new Error(`unsupported sport "${sportKey}". Use: ${Object.keys(LEAGUE_MAP).join(", ")}`);
    }

    const [category, league] = mapping;

    // Build date param — ESPN uses YYYYMMDD
    let dateParam = "";
    if (query.date) {
      const d = query.date.replace(/-/g, "");
      if (!/^\d{8}$/.test(d)) throw new Error('date must be YYYY-MM-DD');
      dateParam = `?dates=${d}`;
    }

    const url = `${ESPN_BASE}/${category}/${league}/scoreboard${dateParam}`;

    let data;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`ESPN API ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      throw new Error(`upstream fetch failed: ${err.message}`);
    }

    const teamFilter = (query.team || "").toLowerCase().trim();
    const rawEvents  = data.events || [];

    const games = rawEvents
      .map((ev) => {
        const comp = ev.competitions?.[0];
        if (!comp) return null;

        const statusName = ev.status?.type?.name || "";
        let status = "scheduled";
        if (statusName.includes("IN_PROGRESS") || statusName.includes("HALFTIME")) status = "in_progress";
        else if (statusName.includes("FINAL") || statusName.includes("STATUS_FINAL")) status = "final";

        const home = comp.competitors?.find((c) => c.homeAway === "home");
        const away = comp.competitors?.find((c) => c.homeAway === "away");

        const fmt = (side) => {
          if (!side) return null;
          const rec = side.records?.[0]?.summary || null;
          const sc   = side.score != null ? parseInt(side.score, 10) : null;
          return {
            team:         side.team?.displayName || "",
            abbreviation: side.team?.abbreviation || "",
            record:       rec,
            score:        isNaN(sc) ? null : sc,
            winner:       !!side.winner,
          };
        };

        const broadcast = comp.broadcasts?.[0]?.names?.[0] || null;
        const venue = comp.venue;

        return {
          id:         ev.id,
          name:       ev.name || "",
          short_name: ev.shortName || "",
          status,
          start_utc:  ev.date || null,
          venue:      venue?.fullName || null,
          venue_city: venue?.address
            ? [venue.address.city, venue.address.state].filter(Boolean).join(", ")
            : null,
          home: fmt(home),
          away: fmt(away),
          broadcast,
        };
      })
      .filter(Boolean)
      .filter((g) => {
        if (!teamFilter) return true;
        return (
          g.home?.team?.toLowerCase().includes(teamFilter) ||
          g.home?.abbreviation?.toLowerCase().includes(teamFilter) ||
          g.away?.team?.toLowerCase().includes(teamFilter) ||
          g.away?.abbreviation?.toLowerCase().includes(teamFilter) ||
          g.name?.toLowerCase().includes(teamFilter)
        );
      });

    const dateQueried = query.date || new Date().toISOString().slice(0, 10);

    return {
      sport:        sportKey,
      date_queried: dateQueried,
      games,
      total_games:  games.length,
      generated_at: new Date().toISOString(),
    };
  },
};
