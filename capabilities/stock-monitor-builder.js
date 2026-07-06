// stock-monitor-builder.js
//
// Build a complete stock monitoring job config in one call.
// Validates a cron schedule expression AND fetches current prices for the
// stocks you want to monitor, returning everything needed to deploy a watcher.
//
// Seam: 4x co-call pattern — agents calling cron-parser + stock-price-multi in
// the same session while building scheduled equity monitors. This cap serves
// both in one payment at $0.089 (vs $0.093 for two calls) and adds the full
// assembled job config on top.
//
// Upstream: Yahoo Finance v8 (free). Cron parsing: pure JS, zero external calls.

const YF_BASE      = "https://query2.finance.yahoo.com/v8/finance/chart";
const UA           = "Mozilla/5.0 (compatible; the-stall/4.91; +https://intuitek.ai)";
const FIELD_RANGES = [[0,59],[0,23],[1,31],[1,12],[0,6]];
const MONTH_NAMES  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_NAMES    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SHORTCUTS    = {
  "@yearly":"0 0 1 1 *","@annually":"0 0 1 1 *","@monthly":"0 0 1 * *",
  "@weekly":"0 0 * * 0","@daily":"0 0 * * *","@midnight":"0 0 * * *","@hourly":"0 * * * *",
};

// ── cron parser (same logic as cron-parser.js) ────────────────────────────────

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

function buildDescription(fields) {
  const [min, hr, dom, mon, dow] = fields;
  const parts = [];
  if (min.type === "any") parts.push("every minute");
  else if (min.values.length === 1 && min.values[0] === 0) parts.push("at the top of the hour");
  else parts.push(`at minute(s) ${min.values.join(", ")}`);
  if (hr.type !== "any") {
    parts.push(`at ${hr.values.map(h => {
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:00 ${ampm}`;
    }).join(", ")}`);
  }
  if (dow.type !== "any") {
    parts.push(`on ${dow.values.map(v => DOW_NAMES[v]).join(", ")}`);
  } else if (dom.type !== "any") {
    parts.push(`on day ${dom.values.join(", ")} of the month`);
  }
  if (mon.type !== "any") parts.push(`in ${mon.values.map(v => MONTH_NAMES[v - 1]).join(", ")}`);
  return parts.length === 0 ? "every minute" : parts.join(", ");
}

function nextRuns(fields, count, from) {
  const [minF, hrF, domF, monF, dowF] = fields;
  const results = [];
  const d = new Date(from || Date.now());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  let iter = 0;
  while (results.length < count && iter < 200000) {
    iter++;
    const mon = d.getMonth() + 1, dom = d.getDate(), dow = d.getDay();
    const hr = d.getHours(), min = d.getMinutes();
    if (monF.type === "specific" && !monF.values.includes(mon)) {
      d.setMonth(d.getMonth() + 1, 1, 0, 0, 0); continue;
    }
    if (!(dowF.type === "any" || dowF.values.includes(dow)) ||
        !(domF.type === "any" || domF.values.includes(dom))) {
      d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue;
    }
    if (hrF.type === "specific" && !hrF.values.includes(hr)) {
      const next = hrF.values.find(h => h > hr);
      if (next != null) d.setHours(next, 0, 0, 0);
      else { d.setDate(d.getDate() + 1); d.setHours(hrF.values[0], 0, 0, 0); }
      continue;
    }
    if (minF.type === "specific" && !minF.values.includes(min)) {
      const next = minF.values.find(m => m > min);
      if (next != null) d.setMinutes(next, 0, 0);
      else d.setHours(d.getHours() + 1, minF.values[0], 0, 0);
      continue;
    }
    results.push(d.toISOString());
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return results;
}

function parseCron(expression) {
  const normalized = SHORTCUTS[(expression || "@daily").trim().toLowerCase()] || expression.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron must have 5 fields (got ${parts.length})`);
  const fields = parts.map((p, i) => parseField(p, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
  return { normalized, fields, parts };
}

// ── price fetcher ─────────────────────────────────────────────────────────────

async function fetchTicker(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid ticker symbol" };
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker: sym, error: `no data (${data?.chart?.error?.code || "not_found"})` };
    const meta  = result.meta;
    const prev  = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const price = meta.regularMarketPrice;
    const diff  = price - prev;
    const pct   = prev !== 0 ? (diff / prev) * 100 : 0;
    return {
      ticker:     meta.symbol,
      name:       meta.longName || meta.shortName || null,
      price_usd:  Math.round(price * 10000) / 10000,
      change_pct: Math.round(pct   * 10000) / 10000,
      change_usd: Math.round(diff  * 10000) / 10000,
      volume:     meta.regularMarketVolume ?? null,
      currency:   meta.currency ?? "USD",
      market_time: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      error: null,
    };
  } catch (err) {
    return { ticker: sym, error: `fetch failed: ${err.message}` };
  }
}

export default {
  name: "stock-monitor-builder",
  price: "$0.089",

  description:
    "Build a complete stock monitoring job in one call. Validates your cron schedule (returns human description + next run times) AND fetches current prices for the stocks you want to watch. Returns a ready-to-use monitoring config combining both. Replaces separate cron-parser + stock-price-multi calls.",

  inputSchema: {
    type: "object",
    properties: {
      cron: {
        type: "string",
        description: "Cron expression (5 fields) or shortcut (@daily, @hourly, etc.) for when to run the monitor. Example: '0 9 * * 1-5' for weekdays at 9am UTC.",
      },
      tickers: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5,
        description: "Up to 5 US stock ticker symbols to monitor (e.g. ['AAPL','NVDA','MSFT']).",
      },
      next_runs: {
        type: "number",
        description: "Number of upcoming schedule run times to include (default 5, max 20).",
        default: 5,
      },
      monitor_name: {
        type: "string",
        description: "Optional name for this monitoring job (e.g. 'morning-tech-check').",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      monitor_name:   { type: "string", description: "Name of this monitoring job." },
      schedule: {
        type: "object",
        properties: {
          expression:    { type: "string" },
          normalized:    { type: "string" },
          valid:         { type: "boolean" },
          description:   { type: "string" },
          next_run_times: { type: "array", items: { type: "string" } },
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
        },
      },
      stocks: {
        type: "array",
        description: "Current price snapshot for each monitored ticker.",
      },
      job_config: {
        type: "object",
        description: "Assembled monitoring job config ready for deployment.",
        properties: {
          name:       { type: "string" },
          cron:       { type: "string" },
          tickers:    { type: "array", items: { type: "string" } },
          created_at: { type: "string" },
          baseline_prices: { type: "object", description: "ticker → price_usd at config creation time." },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const expression   = (query.cron || "@daily").trim();
    const rawTickers   = query.tickers ?? ["AAPL", "MSFT", "NVDA"];
    const tickers      = rawTickers.slice(0, 5);
    const nextRunCount = Math.min(Math.max(1, parseInt(query.next_runs, 10) || 5), 20);
    const monitorName  = query.monitor_name || `stock-monitor-${tickers.join("-").toLowerCase()}`;

    // Parse cron + fetch prices in parallel
    let schedule;
    try {
      const { normalized, fields, parts } = parseCron(expression);
      const runs = nextRuns(fields, nextRunCount, undefined);
      schedule = {
        expression,
        normalized,
        valid: true,
        description: buildDescription(fields),
        fields: {
          minute:       parts[0],
          hour:         parts[1],
          day_of_month: parts[2],
          month:        parts[3],
          day_of_week:  parts[4],
        },
        next_run_times: runs,
      };
    } catch (e) {
      schedule = { expression, normalized: expression, valid: false, error: e.message,
                   description: null, fields: null, next_run_times: [] };
    }

    const stocks = await Promise.all(tickers.map(fetchTicker));

    const baselinePrices = {};
    for (const s of stocks) {
      if (!s.error) baselinePrices[s.ticker] = s.price_usd;
    }

    const ts = new Date().toISOString();

    return {
      monitor_name: monitorName,
      schedule,
      stocks,
      job_config: {
        name:            monitorName,
        cron:            schedule.normalized || expression,
        tickers:         stocks.filter(s => !s.error).map(s => s.ticker),
        created_at:      ts,
        baseline_prices: baselinePrices,
      },
      ts,
    };
  },
};
