// imf-country-outlook.js
//
// IMF World Economic Outlook (WEO) forecasts — current year + 3-year horizon.
// 6 key indicators: GDP growth, CPI inflation, unemployment, current account,
// government gross debt, and fiscal balance. Covers 180+ countries.
//
// Upstream: IMF DataMapper API (api.imf.org) — free, no key required.
//   WEO updates twice per year (April + October). Cache 4h.
//
// Distinct from world-bank-data (historical actuals, 1-2yr lag).
// This cap returns IMF *forecasts* — what the IMF expects for 2025, 2026, 2027.
//
// Seam: IMF "World Economic Outlook" data is widely consumed by macro agents
//       for sovereign risk, EM allocation, currency thesis, fiscal sustainability.

const IMF_BASE = "https://www.imf.org/external/datamapper/api/v1";
const UA       = "Mozilla/5.0 (compatible; myriad/4.1; +https://synaptiic.org)";
const TIMEOUT  = 15_000;
const CACHE_MS = 4 * 60 * 60 * 1000; // 4 hours

const INDICATORS = {
  NGDP_RPCH:    { label: "GDP growth (%)",          unit: "%" },
  PCPIEPCH:     { label: "CPI inflation (%)",        unit: "%" },
  LUR:          { label: "Unemployment (%)",         unit: "%" },
  BCA_NGDPD:    { label: "Current account (% GDP)",  unit: "% of GDP" },
  GGXWDG_NGDP:  { label: "Gross govt debt (% GDP)",  unit: "% of GDP" },
  GGXCNL_NGDP:  { label: "Fiscal balance (% GDP)",   unit: "% of GDP" },
};

// ISO2 → ISO3 for common countries (agents often send 2-letter codes)
const ISO2_TO_3 = {
  US:"USA",GB:"GBR",DE:"DEU",FR:"FRA",JP:"JPN",CN:"CHN",IN:"IND",
  CA:"CAN",AU:"AUS",BR:"BRL",MX:"MEX",IT:"ITA",ES:"ESP",KR:"KOR",
  RU:"RUS",SA:"SAU",TR:"TUR",NL:"NLD",CH:"CHE",SE:"SWE",NO:"NOR",
  PL:"POL",BE:"BEL",AT:"AUT",AR:"ARG",ZA:"ZAF",EG:"EGY",NG:"NGA",
  ID:"IDN",MY:"MYS",TH:"THA",SG:"SGP",PH:"PHL",VN:"VNM",PK:"PAK",
  BD:"BGD",UA:"UKR",IL:"ISR",AE:"ARE",QA:"QAT",KW:"KWT",IR:"IRN",
  IQ:"IRQ",CL:"CHL",CO:"COL",PE:"PER",VE:"VEN",HU:"HUN",CZ:"CZE",
  RO:"ROU",GR:"GRC",PT:"PRT",DK:"DNK",FI:"FIN",NZ:"NZL",HK:"HKG",
};

const cache = new Map(); // key → { data, ts }

function cacheKey(countries, currentYear) {
  return `imf:${countries.join(",")}:${currentYear}`;
}

async function fetchIndicator(indicator, countryCodes) {
  const url = `${IMF_BASE}/${indicator}/${countryCodes.join(",")}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`IMF HTTP ${resp.status} for ${indicator}`);
  const body = await resp.json();
  return body.values?.[indicator] ?? {};
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

export default {
  name: "imf-country-outlook",

  price: "$0.034",

  description:
    "IMF World Economic Outlook forecasts — current year + 3-year horizon for 180+ countries. Returns GDP growth, CPI inflation, unemployment rate, current account balance (% GDP), government gross debt (% GDP), and fiscal balance (% GDP). Sourced from IMF DataMapper API (no key required). Distinct from World Bank data — these are IMF forward projections updated Apr/Oct. Use for sovereign risk, EM allocation, currency thesis, fiscal sustainability analysis.",

  inputSchema: {
    type: "object",
    properties: {
      country: {
        type: "string",
        description: "ISO 3-letter country code (e.g. 'USA', 'CHN', 'DEU'). Accepts ISO2 for common countries (e.g. 'US'). Comma-separate up to 5 countries for comparison (e.g. 'USA,CHN,DEU').",
      },
      horizon: {
        type: "integer",
        description: "Forecast years ahead to include (1–5). Default: 3.",
        default: 3,
        minimum: 1,
        maximum: 5,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      countries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            iso3:       { type: "string" },
            year_base:  { type: "integer", description: "First year in outlook (current calendar year)" },
            gdp_growth:     { type: "array", items: { type: ["number", "null"] } },
            cpi_inflation:  { type: "array", items: { type: ["number", "null"] } },
            unemployment:   { type: "array", items: { type: ["number", "null"] } },
            current_account_pct_gdp: { type: "array", items: { type: ["number", "null"] } },
            gross_debt_pct_gdp:      { type: "array", items: { type: ["number", "null"] } },
            fiscal_balance_pct_gdp:  { type: "array", items: { type: ["number", "null"] } },
          },
        },
      },
      years:     { type: "array", items: { type: "integer" } },
      source:    { type: "string" },
      as_of:     { type: "string" },
    },
  },

  async handler(query) {
    // Parse and normalise country codes
    const rawCodes = (query.country || "USA").split(",").map(s => s.trim().toUpperCase()).slice(0, 5);
    const iso3Codes = rawCodes.map(c => (c.length === 2 ? ISO2_TO_3[c] : c) ?? c).filter(Boolean);

    const horizon  = Math.max(1, Math.min(5, parseInt(query.horizon ?? "3", 10)));
    const thisYear = new Date().getFullYear();
    const years    = Array.from({ length: horizon }, (_, i) => thisYear + i);

    // Cache check
    const ck   = cacheKey(iso3Codes, thisYear);
    const hit  = cache.get(ck);
    if (hit && Date.now() - hit.ts < CACHE_MS) return hit.data;

    // Fetch all indicators in parallel
    const indKeys = Object.keys(INDICATORS);
    const results = await Promise.allSettled(
      indKeys.map(ind => fetchIndicator(ind, iso3Codes))
    );

    // Build per-country outlook
    const indData = {};
    indKeys.forEach((ind, i) => {
      indData[ind] = results[i].status === "fulfilled" ? results[i].value : {};
    });

    const countries = iso3Codes.map(iso3 => {
      function series(ind) {
        const raw = indData[ind][iso3] ?? {};
        return years.map(y => {
          const v = raw[String(y)];
          return v != null ? round2(Number(v)) : null;
        });
      }

      return {
        iso3,
        year_base:               thisYear,
        gdp_growth:              series("NGDP_RPCH"),
        cpi_inflation:           series("PCPIEPCH"),
        unemployment:            series("LUR"),
        current_account_pct_gdp: series("BCA_NGDPD"),
        gross_debt_pct_gdp:      series("GGXWDG_NGDP"),
        fiscal_balance_pct_gdp:  series("GGXCNL_NGDP"),
      };
    });

    const data = {
      countries,
      years,
      source:  "IMF World Economic Outlook (DataMapper API)",
      as_of:   new Date().toISOString().slice(0, 10),
    };

    cache.set(ck, { data, ts: Date.now() });
    return data;
  },
};
