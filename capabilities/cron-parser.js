// cron-parser.js
//
// Parse, explain, and validate Unix cron expressions in human language.
// Returns a plain-English description plus the next N scheduled run times.
// Zero external calls — pure JS computation.
//
// Seam: netintel-production cron-parser/explain — 25 calls/48h, growing.
// DevOps agents building or verifying cron schedules need this to confirm
// intent matches syntax without a browser or external service.

const FIELD_NAMES  = ["minute", "hour", "day-of-month", "month", "day-of-week"];
const MONTH_NAMES  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_NAMES    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const FIELD_RANGES = [[0,59],[0,23],[1,31],[1,12],[0,6]]; // [min,max]

// Named shortcuts
const SHORTCUTS = {
  "@yearly":  "0 0 1 1 *",
  "@annually":"0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly":  "0 0 * * 0",
  "@daily":   "0 0 * * *",
  "@midnight":"0 0 * * *",
  "@hourly":  "0 * * * *",
};

function parseField(str, min, max) {
  if (str === "*") return { type: "any", values: null };
  const values = new Set();
  for (const part of str.split(",")) {
    const step = part.includes("/") ? parseInt(part.split("/")[1], 10) : 1;
    const range = part.split("/")[0];
    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b)
        throw new Error(`invalid range ${range} for field ${min}-${max}`);
      for (let i = a; i <= b; i += step) values.add(i);
    } else {
      const v = parseInt(range, 10);
      if (isNaN(v) || v < min || v > max)
        throw new Error(`value ${v} out of range ${min}-${max}`);
      values.add(v);
    }
  }
  return { type: "specific", values: [...values].sort((a, b) => a - b) };
}

function fieldToText(field, idx) {
  if (field.type === "any") return null;
  const vals = field.values;
  if (idx === 3) return vals.map(v => MONTH_NAMES[v - 1]).join(", ");
  if (idx === 4) return vals.map(v => DOW_NAMES[v]).join(", ");
  return vals.join(", ");
}

function buildDescription(fields) {
  const [min, hr, dom, mon, dow] = fields;
  const parts = [];

  // Minute
  if (min.type === "any") parts.push("every minute");
  else if (min.values.length === 1 && min.values[0] === 0) parts.push("at the top of the hour");
  else parts.push(`at minute(s) ${fieldToText(min, 0)}`);

  // Hour
  if (hr.type !== "any") {
    const hrText = fieldToText(hr, 1);
    const formatted = hr.values.map(h => {
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:00 ${ampm}`;
    }).join(", ");
    parts.push(`at ${formatted}`);
  }

  // Day-of-week
  if (dow.type !== "any") {
    parts.push(`on ${fieldToText(dow, 4)}`);
  } else if (dom.type !== "any") {
    parts.push(`on day ${fieldToText(dom, 2)} of the month`);
  }

  // Month
  if (mon.type !== "any") {
    parts.push(`in ${fieldToText(mon, 3)}`);
  }

  if (parts.length === 0) return "every minute";
  return parts.join(", ");
}

function nextRuns(fields, count, from) {
  const [minF, hrF, domF, monF, dowF] = fields;
  const results = [];
  const d = new Date(from || Date.now());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  const maxIter = 200000;
  let iter = 0;
  while (results.length < count && iter < maxIter) {
    iter++;
    const mon = d.getMonth() + 1;
    const dom = d.getDate();
    const dow = d.getDay();
    const hr  = d.getHours();
    const min = d.getMinutes();

    if (monF.type === "specific" && !monF.values.includes(mon)) {
      d.setMonth(d.getMonth() + 1, 1, 0, 0, 0); continue;
    }
    const dowOk = dowF.type === "any" || dowF.values.includes(dow);
    const domOk = domF.type === "any" || domF.values.includes(dom);
    if (!dowOk || !domOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (hrF.type === "specific" && !hrF.values.includes(hr)) {
      const next = hrF.values.find(h => h > hr);
      if (next != null) { d.setHours(next, 0, 0, 0); }
      else { d.setDate(d.getDate() + 1); d.setHours(hrF.values[0], 0, 0, 0); }
      continue;
    }
    if (minF.type === "specific" && !minF.values.includes(min)) {
      const next = minF.values.find(m => m > min);
      if (next != null) { d.setMinutes(next, 0, 0); }
      else { d.setHours(d.getHours() + 1, minF.values[0], 0, 0); }
      continue;
    }
    results.push(d.toISOString());
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return results;
}

export default {
  name: "cron-parser",
  price: "$0.034",
  description: "Parse and explain any Unix cron expression in plain English. Returns human-readable schedule description, field breakdown, and the next N run times (UTC). Supports @yearly/@monthly/@weekly/@daily/@hourly shortcuts. Zero external calls.",
  inputSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "Cron expression (5 fields: minute hour day month weekday) or shortcut (@daily, @hourly, etc.). Example: '0 9 * * 1-5'. Defaults to '@daily'.",
      },
      next_runs: {
        type: "number",
        description: "Number of upcoming run times to return (default 5, max 20).",
        default: 5,
      },
      from_iso: {
        type: "string",
        description: "ISO 8601 reference timestamp to compute next runs from (default: now).",
      },
    },
    required: [],
  },
  outputSchema: {
    type: "object",
    properties: {
      expression:   { type: "string" },
      normalized:   { type: "string" },
      valid:        { type: "boolean" },
      description:  { type: "string" },
      fields: {
        type: "object",
        properties: {
          minute:       { type: "string" },
          hour:         { type: "string" },
          day_of_month: { type: "string" },
          month:        { type: "string" },
          day_of_week:  { type: "string" },
        },
      },
      next_run_times: { type: "array", items: { type: "string" } },
    },
  },
  handler({ expression, next_runs = 5, from_iso }) {
    expression = (expression || "@daily").trim();

    // Resolve shortcuts
    const normalized = SHORTCUTS[expression.toLowerCase()] || expression;

    const parts = normalized.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`cron expression must have exactly 5 fields (got ${parts.length}): minute hour day month weekday`);
    }

    const count = Math.min(Math.max(1, parseInt(next_runs, 10) || 5), 20);
    const from  = from_iso ? new Date(from_iso).getTime() : undefined;

    let fields;
    try {
      fields = parts.map((p, i) => parseField(p, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
    } catch (e) {
      return { expression, normalized, valid: false, error: e.message, description: null, fields: null, next_run_times: [] };
    }

    const description = buildDescription(fields);
    const runs = nextRuns(fields, count, from);

    return {
      expression,
      normalized,
      valid: true,
      description,
      fields: {
        minute:       parts[0],
        hour:         parts[1],
        day_of_month: parts[2],
        month:        parts[3],
        day_of_week:  parts[4],
      },
      next_run_times: runs,
    };
  },
};
