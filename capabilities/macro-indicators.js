// macro-indicators.js
//
// Returns current US macroeconomic indicators: Fed Funds Rate, CPI,
// Unemployment Rate, and Real GDP. Sourced from FRED
// (St. Louis Federal Reserve) public CSV endpoint — no API key, updated monthly.
//
// Priced at $0.010 — macro context in a single call. An agent pricing risk
// in a multi-asset workflow pays once for the full macro backdrop rather than
// inferring it from equity prices. 10Y yield and VIX are in market-overview;
// this cap covers the FRED-sourced policy/economic data that market-overview omits.
//
// Seam origin: natural extension of us-stock-price + equity-technicals workflow.
// Free upstream: FRED public CSV (fred.stlouisfed.org) — no crumb, no auth.

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA        = "Mozilla/5.0 (compatible; the-stall/0.4; +https://intuitek.ai)";

async function fetchSeries(id) {
  const url = `${FRED_BASE}?id=${id}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`FRED ${id} returned ${resp.status}`);
  const text = await resp.text();
  const lines = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
  // Last non-missing observation
  for (let i = lines.length - 1; i >= 0; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      return { date: date.trim(), value: parseFloat(val.trim()) };
    }
  }
  return null;
}

export default {
  name: "macro-indicators",
  price: "$0.034",

  description:
    "Returns current US macroeconomic indicators: Fed Funds Rate, CPI (with year-over-year inflation %), Unemployment Rate, and Real GDP. Sourced from FRED (St. Louis Federal Reserve), updated monthly. One call establishes the policy and economic backdrop for any risk-pricing or multi-asset workflow. Pair with market-overview for the full macro picture.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      fed_funds_rate:         { type: "number",  description: "Fed Funds effective rate (%)." },
      fed_funds_date:         { type: "string",  description: "Date of latest Fed Funds observation (YYYY-MM-DD)." },
      cpi:                    { type: "number",  description: "CPI All Urban Consumers index value (1982-84=100)." },
      cpi_date:               { type: "string",  description: "Date of latest CPI observation." },
      cpi_yoy_pct:            { type: "number",  description: "CPI year-over-year % change (inflation rate), or null if prior-year data unavailable." },
      unemployment_rate:      { type: "number",  description: "US unemployment rate (%)." },
      unemployment_date:      { type: "string",  description: "Date of latest unemployment observation." },
      real_gdp_billions:      { type: "number",  description: "Real GDP in billions USD (SAAR — seasonally adjusted annual rate)." },
      real_gdp_date:          { type: "string",  description: "Date of latest GDP observation." },
      ts:                     { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    // Fetch all series in parallel
    const [ff, cpi, ur, gdp] = await Promise.allSettled([
      fetchSeries("FEDFUNDS"),
      fetchSeries("CPIAUCSL"),
      fetchSeries("UNRATE"),
      fetchSeries("GDP"),
    ]);

    const get = (r) => r.status === "fulfilled" ? r.value : null;
    const ffData  = get(ff);
    const cpiData = get(cpi);
    const urData  = get(ur);
    const gdpData = get(gdp);

    // CPI YoY: fetch one prior-year observation for the same month
    let cpiYoY = null;
    if (cpiData) {
      try {
        // Compute prior-year date by subtracting 365 days
        const d = new Date(cpiData.date + "T00:00:00Z");
        d.setFullYear(d.getFullYear() - 1);
        // FRED returns the closest available point; grab last observation up to that date
        const vintageUrl = `${FRED_BASE}?id=CPIAUCSL&vintage_date=${d.toISOString().slice(0, 10)}`;
        const vintResp = await fetch(vintageUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(8000),
        });
        if (vintResp.ok) {
          const text = await vintResp.text();
          const lines = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
          for (let i = lines.length - 1; i >= 0; i--) {
            const [, val] = lines[i].split(",");
            if (val && val.trim() !== "." && val.trim() !== "") {
              const priorCPI = parseFloat(val.trim());
              if (priorCPI > 0) {
                cpiYoY = Math.round(((cpiData.value - priorCPI) / priorCPI) * 10000) / 100;
              }
              break;
            }
          }
        }
      } catch {
        // YoY is optional — don't fail the whole call
      }
    }

    return {
      fed_funds_rate:    ffData?.value   ?? null,
      fed_funds_date:    ffData?.date    ?? null,
      cpi:               cpiData?.value  ?? null,
      cpi_date:          cpiData?.date   ?? null,
      cpi_yoy_pct:       cpiYoY,
      unemployment_rate: urData?.value   ?? null,
      unemployment_date: urData?.date    ?? null,
      real_gdp_billions: gdpData?.value  ?? null,
      real_gdp_date:     gdpData?.date   ?? null,
      ts:                new Date().toISOString(),
    };
  },
};
