// world-bank-data.js
//
// World Bank open data — 1600+ development indicators across 200+ countries.
// Free World Bank API, no key required.
//
// Growth signal: "Data" category, +229 endpoints/day (signal-intel 2026-06-06).
// Use case: macro agents, country risk, development economics, policy analysis.

const WB_BASE = "https://api.worldbank.org/v2";
const UA      = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";
const T       = 15_000;

// Common indicator aliases → WB codes
const ALIASES = {
  gdp:            "NY.GDP.MKTP.CD",
  gdp_usd:        "NY.GDP.MKTP.CD",
  gdp_growth:     "NY.GDP.MKTP.KD.ZG",
  gdp_per_capita: "NY.GDP.PCAP.CD",
  population:     "SP.POP.TOTL",
  inflation:      "FP.CPI.TOTL.ZG",
  unemployment:   "SL.UEM.TOTL.ZS",
  fdi:            "BX.KLT.DINV.WD.GD.ZS",
  debt_gdp:       "GC.DOD.TOTL.GD.ZS",
  exports_gdp:    "NE.EXP.GNFS.ZS",
  imports_gdp:    "NE.IMP.GNFS.ZS",
  co2_per_capita: "EN.ATM.CO2E.PC",
  internet_users: "IT.NET.USER.ZS",
  life_expectancy:"SP.DYN.LE00.IN",
  gini:           "SI.POV.GINI",
  hdi:            "UNDP.HDI.XD",      // via UNDP/WB cross-listing
  literacy:       "SE.ADT.LITR.ZS",
  ease_of_biz:    "IC.BUS.EASE.XQ",
  current_account:"BN.CAB.XOKA.GD.ZS",
  market_cap_gdp: "CM.MKT.LCAP.GD.ZS",
  forex_reserves: "FI.RES.TOTL.CD",
};

// Known indicator metadata (name + unit) for common codes
const INDICATOR_META = {
  "NY.GDP.MKTP.CD":    { name: "GDP", unit: "current USD" },
  "NY.GDP.MKTP.KD.ZG": { name: "GDP growth rate", unit: "% annual" },
  "NY.GDP.PCAP.CD":    { name: "GDP per capita", unit: "current USD" },
  "SP.POP.TOTL":       { name: "Population", unit: "persons" },
  "FP.CPI.TOTL.ZG":    { name: "Inflation (CPI)", unit: "% annual" },
  "SL.UEM.TOTL.ZS":    { name: "Unemployment", unit: "% of labor force" },
  "BX.KLT.DINV.WD.GD.ZS": { name: "FDI net inflows", unit: "% of GDP" },
  "GC.DOD.TOTL.GD.ZS": { name: "Government debt", unit: "% of GDP" },
  "NE.EXP.GNFS.ZS":    { name: "Exports of goods & services", unit: "% of GDP" },
  "NE.IMP.GNFS.ZS":    { name: "Imports of goods & services", unit: "% of GDP" },
  "EN.ATM.CO2E.PC":    { name: "CO₂ emissions", unit: "tons per capita" },
  "IT.NET.USER.ZS":    { name: "Internet users", unit: "% of population" },
  "SP.DYN.LE00.IN":    { name: "Life expectancy at birth", unit: "years" },
  "SI.POV.GINI":       { name: "Gini coefficient (inequality)", unit: "0–100" },
  "SE.ADT.LITR.ZS":    { name: "Adult literacy rate", unit: "% adults ≥15" },
  "IC.BUS.EASE.XQ":    { name: "Ease of doing business rank", unit: "rank (lower = better)" },
  "BN.CAB.XOKA.GD.ZS": { name: "Current account balance", unit: "% of GDP" },
  "CM.MKT.LCAP.GD.ZS": { name: "Market capitalization of listed companies", unit: "% of GDP" },
  "FI.RES.TOTL.CD":    { name: "Total forex reserves", unit: "current USD" },
};

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function resolveIndicator(raw) {
  const k = raw.toLowerCase().replace(/[\s-]/g, "_");
  return ALIASES[k] ?? raw.toUpperCase();
}

function formatValue(val, indicatorCode) {
  if (val === null || val === undefined) return null;
  const meta = INDICATOR_META[indicatorCode];
  if (!meta) return val;
  const unit = meta.unit;
  if (unit === "current USD") {
    if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
    if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`;
    if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`;
    return `$${val.toLocaleString()}`;
  }
  if (unit.startsWith("%"))   return `${Number(val.toFixed(2))}%`;
  if (unit === "years")       return `${Number(val.toFixed(1))} yrs`;
  if (unit === "persons") {
    if (val >= 1e9) return `${(val / 1e9).toFixed(3)}B`;
    if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
    return val.toLocaleString();
  }
  return Number(val.toFixed(4));
}

export default {
  name:  "world-bank-data",
  price: "$0.003",

  description:
    "World Bank open data — 1600+ development indicators for 200+ countries. Returns most-recent values and 5-year trend for any indicator by country. Covers GDP, population, inflation, unemployment, FDI, debt, exports, CO₂, life expectancy, Gini, internet penetration, ease of doing business, and more. Accepts ticker-style aliases (gdp, inflation, unemployment) or full WB indicator codes. Sourced from api.worldbank.org — free, no key required. Use for country risk, macro comparisons, policy analysis, and development economics.",

  inputSchema: {
    type: "object",
    properties: {
      country: {
        type: "string",
        description: "ISO 2-letter country code(s), semicolon-separated for multiple (e.g. 'US', 'US;CN;DE'). Use 'WLD' for world average.",
      },
      indicator: {
        type: "string",
        description: "Indicator alias or WB code. Aliases: gdp, gdp_growth, gdp_per_capita, population, inflation, unemployment, fdi, debt_gdp, exports_gdp, imports_gdp, co2_per_capita, internet_users, life_expectancy, gini, literacy, ease_of_biz, current_account, market_cap_gdp, forex_reserves. Or any WB indicator code like 'NY.GDP.MKTP.CD'.",
      },
      years: {
        type: "integer",
        description: "Number of most-recent years to return (1–10). Default: 5.",
        default: 5,
        minimum: 1,
        maximum: 10,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      indicator_code: { type: "string" },
      indicator_name: { type: "string" },
      indicator_unit: { type: "string" },
      series: {
        type: "array",
        description: "One entry per country, with yearly values.",
        items: {
          type: "object",
          properties: {
            country_code:  { type: "string" },
            country_name:  { type: "string" },
            latest_year:   { type: "string" },
            latest_value:  {},
            latest_formatted: { type: "string" },
            trend:         { type: "array", items: { type: "object" }, description: "Year-value pairs, most-recent first." },
            yoy_change_pct: { type: "number", description: "% change from previous year (null if only 1 data point)." },
          },
        },
      },
      note: { type: "string" },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const countries   = String(input.country || "US").toUpperCase().split(";").map(s => s.trim()).filter(Boolean);
    const indicatorRaw = String(input.indicator || "NY.GDP.MKTP.CD");
    const indicator   = resolveIndicator(indicatorRaw);
    const nYears      = Math.min(10, Math.max(1, parseInt(input.years ?? 5)));

    const countriesParam = countries.join(";");
    const url = `${WB_BASE}/country/${encodeURIComponent(countriesParam)}/indicator/${encodeURIComponent(indicator)}`
              + `?format=json&per_page=${countries.length * nYears + 10}&mrv=${nYears}`;

    const raw  = await get(url);
    const meta = raw[0];
    const rows = raw[1] ?? [];

    if (!rows.length) {
      return {
        indicator_code: indicator,
        indicator_name: INDICATOR_META[indicator]?.name ?? indicator,
        indicator_unit: INDICATOR_META[indicator]?.unit ?? "unknown",
        series: [],
        note: "No data found for this country+indicator combination. Check country code and indicator.",
        generated_at: new Date().toISOString(),
      };
    }

    // Resolve indicator name from first row if available
    const indicatorName = rows[0]?.indicator?.value ?? INDICATOR_META[indicator]?.name ?? indicator;
    const indicatorUnit = INDICATOR_META[indicator]?.unit ?? "see WB documentation";

    // Group by country
    const byCountry = {};
    for (const row of rows) {
      const cid = row.country?.id ?? "??";
      if (!byCountry[cid]) {
        byCountry[cid] = { name: row.country?.value ?? cid, points: [] };
      }
      if (row.value !== null && row.value !== undefined) {
        byCountry[cid].points.push({ year: row.date, value: row.value });
      }
    }

    const series = Object.entries(byCountry).map(([code, entry]) => {
      const points    = entry.points.sort((a, b) => b.year.localeCompare(a.year));
      const latest    = points[0];
      const prev      = points[1];
      const yoy       = (latest && prev && prev.value !== 0)
        ? Number(((latest.value - prev.value) / Math.abs(prev.value) * 100).toFixed(2))
        : null;
      const trend     = points.map(p => ({ year: p.year, value: Number(p.value.toFixed(4)) }));

      return {
        country_code:     code,
        country_name:     entry.name,
        latest_year:      latest?.year ?? null,
        latest_value:     latest?.value ?? null,
        latest_formatted: latest ? String(formatValue(latest.value, indicator)) : null,
        trend,
        yoy_change_pct:   yoy,
      };
    });

    return {
      indicator_code: indicator,
      indicator_name: indicatorName,
      indicator_unit: indicatorUnit,
      series,
      note: meta?.total > rows.length
        ? `Showing ${rows.length} of ${meta.total} available rows (most-recent ${nYears} per country).`
        : null,
      generated_at: new Date().toISOString(),
    };
  },
};
