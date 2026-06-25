// timezone.js
//
// Timezone intelligence using Node.js built-in Intl (IANA timezone database,
// 418 zones). Returns the current time in any timezone, UTC offset, DST status,
// and can convert a specific ISO timestamp to another timezone.
//
// Zero external dependencies — fully computed from IANA data embedded in the
// Node.js runtime. No rate limits, no API keys, always available.
//
// Useful for scheduling agents, global operations, time-sensitive data
// enrichment, and any agent that needs to reason about time across zones.

const ALL_ZONES = Intl.supportedValuesOf("timeZone");
// UTC is always valid in Intl but absent from supportedValuesOf in some Node builds
const VALID_ZONE = (tz) => tz === "UTC" || tz === "Etc/UTC" || ALL_ZONES.includes(tz);

function getZoneInfo(tz, targetDate) {
  const date = targetDate || new Date();

  // Compute local time parts
  const fmtFull = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "longOffset",
  });
  const fmtLong = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, timeZoneName: "long",
  });

  const parts      = Object.fromEntries(fmtFull.formatToParts(date).map(p => [p.type, p.value]));
  const longParts  = Object.fromEntries(fmtLong.formatToParts(date).map(p => [p.type, p.value]));

  const offsetStr  = parts.timeZoneName; // "GMT-05:00" or "GMT+05:30"
  const tzLongName = longParts.timeZoneName; // "Central Daylight Time"

  // Parse offset to minutes
  const offsetMatch = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMins  = offsetMatch
    ? (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3], 10)) * (offsetMatch[1] === "+" ? 1 : -1)
    : null;

  // Detect DST: compare summer and winter offsets — if they differ, DST is used; if current offset matches summer, DST is active
  const jan   = new Date(date.getFullYear(), 0, 15);
  const jul   = new Date(date.getFullYear(), 6, 15);
  const fmtOff = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
  const janOff = fmtOff.formatToParts(jan).find(p => p.type === "timeZoneName")?.value;
  const julOff = fmtOff.formatToParts(jul).find(p => p.type === "timeZoneName")?.value;
  const usesDst  = janOff !== julOff;
  const isDst    = usesDst && offsetStr === julOff; // northern hemisphere: summer=July

  // Build ISO datetime in that zone (approximate — not full ISO with offset)
  const localIso = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offsetStr.replace("GMT", "")}`;

  return {
    timezone:     tz,
    local_iso:    localIso,
    utc_offset:   offsetStr,
    offset_minutes: offsetMins,
    tz_name_long: tzLongName,
    uses_dst:     usesDst,
    is_dst:       isDst,
    utc_now:      date.toISOString(),
  };
}

export default {
  name: "timezone",
  price: "$0.034",

  description:
    "Timezone intelligence using the IANA database (418 zones) built into Node.js. Returns current local time, UTC offset, DST status, and the long timezone name for any IANA timezone. Can also convert an ISO timestamp to one or more target timezones. Useful for scheduling agents, global operations, and time-aware data enrichment. Zero external API calls — instant response.",

  inputSchema: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone name to look up (e.g. 'America/Chicago', 'Europe/London', 'Asia/Tokyo'). Omit to return UTC.",
      },
      timezones: {
        type: "array",
        items: { type: "string" },
        description: "Batch: list of IANA timezone names (max 20). If provided, 'timezone' is ignored.",
      },
      convert_from_iso: {
        type: "string",
        description: "ISO 8601 timestamp to convert (e.g. '2026-06-06T15:00:00Z'). If omitted, uses current UTC time.",
      },
      search: {
        type: "string",
        description: "Return a list of timezone names matching this substring (e.g. 'America', 'Paris'). Use to discover valid timezone identifiers.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      results:      { type: "array" },
      count:        { type: "integer" },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    // Timezone search mode
    if (query.search) {
      const q = query.search.toLowerCase();
      const matches = ALL_ZONES.filter(z => z.toLowerCase().includes(q)).slice(0, 30);
      return { results: matches.map(z => ({ timezone: z })), count: matches.length, generated_at: new Date().toISOString() };
    }

    const date = query.convert_from_iso ? new Date(query.convert_from_iso) : new Date();
    if (isNaN(date.getTime())) throw new Error("invalid convert_from_iso — use ISO 8601 format");

    let zones;
    if (Array.isArray(query.timezones) && query.timezones.length > 0) {
      zones = query.timezones.slice(0, 20);
    } else {
      zones = [query.timezone || "UTC"];
    }

    const results = [];
    for (const tz of zones) {
      if (!VALID_ZONE(tz)) throw new Error(`unknown timezone: '${tz}' — use 'search' to find valid IANA names (e.g. 'America/New_York', 'Europe/London')`);
      results.push(getZoneInfo(tz, date));
    }

    return { results, count: results.length, generated_at: new Date().toISOString() };
  },
};
