// sports-scores.js
//
// Live and recent sports scores via the free ESPN scoreboard API.
// Covers NBA, NFL, MLB, NHL, MLS, EPL, and other major leagues.
// Zero auth — ESPN's public API endpoint.
//
// Seam: orbisapi.com/proxy/sports-scores-api — 88 sett/wk, 16 payers, $0.005/call

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const TIMEOUT   = 10000;

const LEAGUES = {
  // Basketball
  nba:        { path: "basketball/nba",       name: "NBA" },
  wnba:       { path: "basketball/wnba",      name: "WNBA" },
  ncaab:      { path: "basketball/mens-college-basketball", name: "NCAAB" },
  // Football
  nfl:        { path: "football/nfl",         name: "NFL" },
  ncaaf:      { path: "football/college-football", name: "NCAAF" },
  // Baseball
  mlb:        { path: "baseball/mlb",         name: "MLB" },
  // Hockey
  nhl:        { path: "hockey/nhl",           name: "NHL" },
  // Soccer
  mls:        { path: "soccer/usa.1",         name: "MLS" },
  epl:        { path: "soccer/eng.1",         name: "English Premier League" },
  laliga:     { path: "soccer/esp.1",         name: "La Liga" },
  bundesliga: { path: "soccer/ger.1",         name: "Bundesliga" },
  seriea:     { path: "soccer/ita.1",         name: "Serie A" },
  ucl:        { path: "soccer/uefa.champions", name: "Champions League" },
};

function shapeCompetitor(comp) {
  return {
    team:      comp.team?.displayName || comp.team?.name || null,
    abbrev:    comp.team?.abbreviation || null,
    score:     comp.score !== undefined ? parseInt(comp.score, 10) : null,
    home_away: comp.homeAway || null,
    winner:    comp.winner || false,
    record:    comp.records?.[0]?.summary || null,
    logo:      comp.team?.logo || null,
  };
}

function shapeEvent(event) {
  const comp    = event.competitions?.[0] || {};
  const status  = comp.status   || {};
  const details = status.type   || {};
  const teams   = (comp.competitors || []).map(shapeCompetitor);

  const home = teams.find(t => t.home_away === "home") || teams[0] || null;
  const away = teams.find(t => t.home_away === "away") || teams[1] || null;

  return {
    id:           event.id,
    name:         event.name || event.shortName || null,
    date:         event.date || null,
    venue:        comp.venue?.fullName || null,
    city:         comp.venue?.address?.city || null,
    status: {
      state:      details.state || null,   // "pre" | "in" | "post"
      description: details.description || details.shortDetail || null,
      display:    status.displayClock || null,
      period:     comp.status?.period || null,
    },
    home,
    away,
    broadcasts:   (comp.broadcasts || []).map(b => b.names?.[0]).filter(Boolean),
  };
}

export default {
  name: "sports-scores",
  price: "$0.004",

  description:
    "Live and recent sports scores for NBA, NFL, MLB, NHL, MLS, EPL, La Liga, Bundesliga, Serie A, Champions League, and more. Returns game status, current score, venue, period/clock, and broadcast info. Uses ESPN's free public scoreboard API. Optional date filter (YYYYMMDD) for historical or upcoming schedule.",

  inputSchema: {
    type: "object",
    properties: {
      league: {
        type: "string",
        enum: ["nba", "wnba", "ncaab", "nfl", "ncaaf", "mlb", "nhl", "mls", "epl", "laliga", "bundesliga", "seriea", "ucl"],
        description: "League code. Default: 'nba'.",
      },
      date: {
        type: "string",
        description: "Date in YYYYMMDD format (e.g. '20240115'). Defaults to today.",
      },
      limit: {
        type: "integer",
        description: "Max games to return (default 10, max 30).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      league:        { type: "string" },
      league_name:   { type: "string" },
      date:          { type: "string" },
      games:         { type: "array", description: "Game scores and status." },
      game_count:    { type: "integer" },
      generated_at:  { type: "string" },
    },
  },

  async handler(query) {
    const leagueKey = (query.league || "nba").toLowerCase();
    const league    = LEAGUES[leagueKey];
    if (!league) throw new Error(`unknown league '${leagueKey}' — valid: ${Object.keys(LEAGUES).join(", ")}`);

    const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 10), 30);
    const url   = `${ESPN_BASE}/${league.path}/scoreboard${query.date ? `?dates=${query.date}` : ""}`;

    const resp = await fetch(url, {
      headers: { "User-Agent": "the-stall/3.21 (https://intuitek.ai)", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`ESPN API HTTP ${resp.status}`);

    const data   = await resp.json();
    const events = (data.events || []).slice(0, limit);

    return {
      league:      leagueKey,
      league_name: league.name,
      date:        query.date || new Date().toISOString().slice(0, 10),
      games:       events.map(shapeEvent),
      game_count:  events.length,
      generated_at: new Date().toISOString(),
    };
  },
};
