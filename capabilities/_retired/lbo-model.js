// lbo-model.js
//
// Full leveraged buyout (LBO) model — pure computation, no external API.
// Sources & uses, year-by-year operating model, debt schedule with cash sweep,
// IRR + MOIC, and 3×3 sensitivity tables on entry/exit multiples.
//
// Competitor: financial-analyst.ai/lbo/model at $5.00/call (13 calls in 30d).
// MYRIAD prices at $4.50 — 10% below — with richer output: full operating model,
// full debt schedule, and dual sensitivity tables (IRR + MOIC).

function round2(n) { return Math.round(n * 100) / 100; }
function pct(n)    { return (n * 100).toFixed(1) + "%"; }

function solveIRR(invested, proceeds, years) {
  if (proceeds <= 0 || invested <= 0) return null;
  let lo = -0.999, hi = 50.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npv = -invested + proceeds / Math.pow(1 + mid, years);
    if (Math.abs(npv) < 0.01) return mid;
    if (npv > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function runModel(
  entry_ebitda, entry_multiple, debt_multiple, cash_on_hand, existing_debt,
  fee_pct, hold_years, entry_revenue, growth_rates, ebitda_margins,
  exit_multiple, sweep_pct, interest_rate, da_pct, capex_pct, tax_rate,
  term_loan
) {
  const purchase_price  = entry_ebitda * entry_multiple;
  const fees            = purchase_price * fee_pct;
  const total_uses      = purchase_price + fees + existing_debt;
  const equity_check    = total_uses - term_loan - cash_on_hand;

  if (equity_check <= 0) return null;

  const mandatory_pct = 0.01;
  let revenue      = entry_revenue;
  let opening_debt = term_loan;

  const ops  = [];
  const debt = [];

  for (let y = 0; y < hold_years; y++) {
    revenue        = revenue * (1 + growth_rates[y]);
    const ebitda   = revenue * ebitda_margins[y];
    const da       = revenue * da_pct;
    const ebit     = ebitda - da;
    const interest = opening_debt * interest_rate;
    const ebt      = ebit - interest;
    const taxes    = Math.max(ebt * tax_rate, 0);
    const ni       = ebt - taxes;
    const capex    = revenue * capex_pct;
    const fcf      = ni + da - capex;

    const mandatory  = term_loan * mandatory_pct;
    const sweep      = Math.max(fcf, 0) * sweep_pct;
    const paydown    = Math.min(mandatory + sweep, opening_debt);
    const closing    = Math.max(opening_debt - paydown, 0);
    const coverage   = interest + mandatory > 0
      ? round2(ebitda / (interest + mandatory))
      : null;

    ops.push({ year: y + 1, revenue, ebitda, da, ebit, interest, ebt, taxes, net_income: ni, capex, fcf });
    debt.push({ year: y + 1, opening_debt, interest, mandatory, sweep, paydown, closing, coverage });

    opening_debt = closing;
  }

  const exit_ebitda    = ops[hold_years - 1].ebitda;
  const exit_ev        = exit_ebitda * exit_multiple;
  const net_debt_exit  = debt[hold_years - 1].closing;
  const proceeds       = exit_ev - net_debt_exit;
  const moic           = proceeds > 0 ? proceeds / equity_check : 0;
  const irr            = solveIRR(equity_check, Math.max(proceeds, 0), hold_years);

  return { equity_check, proceeds, moic, irr, ops, debt, exit_ebitda, exit_ev, net_debt_exit };
}

export default {
  name: "lbo-model",
  price: "$4.50",

  description:
    "Full LBO model: sources & uses, year-by-year operating model, debt schedule with cash sweep, IRR and MOIC, plus 3×3 entry/exit sensitivity tables. Pure computation — no API dependency. Priced $4.50, 10% below the closest x402 competitor at $5.00, with richer output including full operating model and dual sensitivity tables.",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      entry_ebitda: {
        type: "number",
        description: "LTM EBITDA at acquisition (USD).",
      },
      entry_multiple: {
        type: "number",
        description: "Entry EV/EBITDA multiple.",
      },
      debt_multiple: {
        type: "number",
        description: "Initial leverage: Term Loan = entry_ebitda × debt_multiple.",
      },
      cash_on_hand: {
        type: "number",
        description: "Target cash acquired at close (USD). Reduces equity check. Default 0.",
        default: 0,
      },
      existing_debt: {
        type: "number",
        description: "Target existing debt refinanced at close (USD). Default 0.",
        default: 0,
      },
      transaction_fee_pct: {
        type: "number",
        description: "Total transaction fees as % of purchase price (e.g. 0.04 = 4%). Default 0.04.",
        default: 0.04,
      },
      hold_years: {
        type: "integer",
        description: "Investment hold period in years (1–10).",
        minimum: 1,
        maximum: 10,
      },
      entry_revenue: {
        type: "number",
        description: "LTM revenue at acquisition (USD).",
      },
      revenue_growth_rates: {
        type: "array",
        items: { type: "number" },
        description: "Annual revenue growth rate for each hold year (e.g. [0.08,0.07,0.06,0.05,0.05]).",
      },
      ebitda_margins: {
        type: "array",
        items: { type: "number" },
        description: "EBITDA margin for each hold year (e.g. [0.25,0.26,0.27,0.27,0.27]).",
      },
      exit_multiple: {
        type: "number",
        description: "Exit EV/EBITDA multiple at end of hold period.",
      },
      cash_sweep_pct: {
        type: "number",
        description: "Fraction of FCF applied to optional debt repayment (0–1). Default 1.0.",
        default: 1.0,
      },
      interest_rate: {
        type: "number",
        description: "Annual interest rate on term loan (e.g. 0.08). Default 0.08.",
        default: 0.08,
      },
      da_pct: {
        type: "number",
        description: "D&A as % of revenue. Default 0.04.",
        default: 0.04,
      },
      capex_pct: {
        type: "number",
        description: "CapEx as % of revenue. Default 0.03.",
        default: 0.03,
      },
      tax_rate: {
        type: "number",
        description: "Effective tax rate. Default 0.25.",
        default: 0.25,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      sources_and_uses: {
        type: "object",
        description: "Opening deal structure: where money comes from and goes.",
      },
      operating_model: {
        type: "array",
        description: "Year-by-year P&L and free cash flow.",
      },
      debt_schedule: {
        type: "array",
        description: "Year-by-year debt balance, interest, mandatory amortization, and cash sweep.",
      },
      exit: {
        type: "object",
        description: "Exit EV, net debt at exit, and equity proceeds.",
      },
      returns: {
        type: "object",
        description: "IRR, MOIC, equity invested, and equity proceeds.",
      },
      irr_sensitivity: {
        type: "object",
        description: "3×3 IRR table: rows = entry multiples (−1/0/+1x), cols = exit multiples (−1/0/+1x).",
      },
      moic_sensitivity: {
        type: "object",
        description: "3×3 MOIC table: same axis as irr_sensitivity.",
      },
      ts: { type: "string", description: "ISO-8601 timestamp." },
    },
  },

  async handler(q) {
    const entry_ebitda     = +(q.entry_ebitda    ?? 10);
    const entry_multiple   = +(q.entry_multiple  ?? 8);
    const debt_multiple    = +(q.debt_multiple   ?? 4);
    const cash_on_hand     = +(q.cash_on_hand     ?? 0);
    const existing_debt    = +(q.existing_debt    ?? 0);
    const fee_pct          = +(q.transaction_fee_pct ?? 0.04);
    const hold_years       = Math.max(1, Math.min(10, Math.round(+(q.hold_years ?? 5))));
    const entry_revenue    = +(q.entry_revenue   ?? 40);
    const exit_multiple    = +(q.exit_multiple   ?? 10);
    const sweep_pct        = +(q.cash_sweep_pct  ?? 1.0);
    const interest_rate    = +(q.interest_rate   ?? 0.08);
    const da_pct           = +(q.da_pct          ?? 0.04);
    const capex_pct        = +(q.capex_pct       ?? 0.03);
    const tax_rate         = +(q.tax_rate        ?? 0.25);

    const growth_rates  = (q.revenue_growth_rates || [0.10, 0.10, 0.10, 0.10, 0.10]).map(Number);
    const margins       = (q.ebitda_margins      || [0.25, 0.25, 0.25, 0.25, 0.25]).map(Number);

    for (const v of [entry_ebitda, entry_multiple, debt_multiple, entry_revenue, exit_multiple]) {
      if (!isFinite(v) || v <= 0) throw new Error("numeric inputs must be finite and positive");
    }

    const term_loan = entry_ebitda * debt_multiple;

    const result = runModel(
      entry_ebitda, entry_multiple, debt_multiple, cash_on_hand, existing_debt,
      fee_pct, hold_years, entry_revenue, growth_rates, margins,
      exit_multiple, sweep_pct, interest_rate, da_pct, capex_pct, tax_rate,
      term_loan
    );

    if (!result) throw new Error("equity_check is non-positive — deal is fully debt-financed; reduce debt_multiple or increase entry_revenue");

    const { equity_check, proceeds, moic, irr, ops, debt, exit_ebitda, exit_ev, net_debt_exit } = result;

    const purchase_price = entry_ebitda * entry_multiple;
    const fees           = purchase_price * fee_pct;
    const total_uses     = purchase_price + fees + existing_debt;

    const sources_and_uses = {
      uses: {
        purchase_price:    round2(purchase_price),
        transaction_fees:  round2(fees),
        debt_refinanced:   round2(existing_debt),
        total_uses:        round2(total_uses),
      },
      sources: {
        term_loan:    round2(term_loan),
        cash_on_hand: round2(cash_on_hand),
        equity_check: round2(equity_check),
        total_sources: round2(total_uses),
      },
      leverage: {
        debt_to_ebitda: `${debt_multiple.toFixed(1)}x`,
        equity_pct:     pct(equity_check / total_uses),
        entry_ev:       round2(purchase_price),
      },
    };

    const operating_model = ops.map(o => ({
      year:          o.year,
      revenue:       round2(o.revenue),
      ebitda:        round2(o.ebitda),
      ebitda_margin: pct(o.ebitda / o.revenue),
      da:            round2(o.da),
      ebit:          round2(o.ebit),
      interest:      round2(o.interest),
      ebt:           round2(o.ebt),
      taxes:         round2(o.taxes),
      net_income:    round2(o.net_income),
      capex:         round2(o.capex),
      fcf:           round2(o.fcf),
    }));

    const debt_schedule = debt.map(d => ({
      year:          d.year,
      opening_debt:  round2(d.opening_debt),
      interest:      round2(d.interest),
      mandatory:     round2(d.mandatory),
      cash_sweep:    round2(d.sweep),
      total_paydown: round2(d.paydown),
      closing_debt:  round2(d.closing),
      coverage_ratio: d.coverage != null ? `${d.coverage}x` : null,
    }));

    const exit_out = {
      exit_ebitda:    round2(exit_ebitda),
      exit_multiple:  `${exit_multiple.toFixed(1)}x`,
      exit_ev:        round2(exit_ev),
      net_debt:       round2(net_debt_exit),
      equity_proceeds: round2(proceeds),
    };

    const returns = {
      equity_invested:  round2(equity_check),
      equity_proceeds:  round2(proceeds),
      moic:             `${round2(moic)}x`,
      irr:              irr != null ? pct(irr) : "N/A",
      irr_decimal:      irr != null ? round2(irr) : null,
    };

    // Sensitivity tables: entry ± 1x, exit ± 1x
    const em_vals = [entry_multiple - 1, entry_multiple, entry_multiple + 1].filter(v => v > 0);
    const xm_vals = [exit_multiple  - 1, exit_multiple,  exit_multiple  + 1].filter(v => v > 0);

    const irr_sensitivity  = {};
    const moic_sensitivity = {};

    for (const em of em_vals) {
      const em_key = `${em.toFixed(1)}x`;
      irr_sensitivity[em_key]  = {};
      moic_sensitivity[em_key] = {};

      for (const xm of xm_vals) {
        const xm_key = `${xm.toFixed(1)}x`;
        const s = runModel(
          entry_ebitda, em, debt_multiple, cash_on_hand, existing_debt,
          fee_pct, hold_years, entry_revenue, growth_rates, margins,
          xm, sweep_pct, interest_rate, da_pct, capex_pct, tax_rate,
          term_loan
        );
        if (!s || s.proceeds <= 0) {
          irr_sensitivity[em_key][xm_key]  = "N/A";
          moic_sensitivity[em_key][xm_key] = "N/A";
        } else {
          irr_sensitivity[em_key][xm_key]  = s.irr != null ? pct(s.irr) : "N/A";
          moic_sensitivity[em_key][xm_key] = `${round2(s.moic)}x`;
        }
      }
    }

    return {
      sources_and_uses,
      operating_model,
      debt_schedule,
      exit: exit_out,
      returns,
      irr_sensitivity,
      moic_sensitivity,
      ts: new Date().toISOString(),
    };
  },
};
