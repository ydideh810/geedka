// portfolio-rebalance.js
//
// Pure-math portfolio rebalancing engine. No external API — just arithmetic.
// Takes current holdings (names + current values) and target allocations
// (percentages), returns the exact buy/sell orders needed to match targets.
//
// Seam: orbisapi.com/proxy/portfolio-rebalance-api — 1,412 sett/wk, 14 payers, $0.005/call
//
// Useful for: DeFi agents managing multi-asset positions, robo-advisory flows,
// drift monitoring, and automated rebalancing triggers.

function round(n, decimals = 4) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export default {
  name: "portfolio-rebalance",
  price: "$0.015",

  description:
    "Pure-math portfolio rebalancing calculator. Given current holdings (asset names and their current USD values) and target allocations (percentages summing to 100), returns the exact buy/sell dollar amounts needed to reach target weights. Handles partial rebalancing with a drift threshold. No external API — deterministic and instant. Useful for DeFi agents, robo-advisory flows, and automated rebalancing triggers.",

  inputSchema: {
    type: "object",
    properties: {
      holdings: {
        type: "array",
        description: "Current portfolio positions.",
        items: {
          type: "object",
          properties: {
            asset:         { type: "string",  description: "Asset name or ticker (e.g. 'BTC', 'ETH', 'USDC')." },
            current_value: { type: "number",  description: "Current USD value of this position." },
          },
          required: [],
        },
        minItems: 2,
      },
      targets: {
        type: "array",
        description: "Target allocation percentages. Must sum to 100.",
        items: {
          type: "object",
          properties: {
            asset:      { type: "string", description: "Asset name (must match a holding)." },
            target_pct: { type: "number", description: "Target weight percentage (e.g. 40 means 40%)." },
          },
          required: [],
        },
        minItems: 2,
      },
      drift_threshold_pct: {
        type: "number",
        description: "Minimum drift percentage before an asset is flagged as needing rebalance (default 1.0). Positions within threshold are marked 'in_range'.",
      },
      cash_injection: {
        type: "number",
        description: "Optional additional cash (USD) to deploy during rebalancing (positive = buying, negative = withdrawing).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      total_portfolio_value: { type: "number" },
      orders:                { type: "array",  description: "Buy/sell orders to reach target weights." },
      summary:               { type: "object" },
      generated_at:          { type: "string" },
    },
  },

  async handler(query) {
    const {
      holdings = [{asset: "SPY", current_value: 6000}, {asset: "BND", current_value: 4000}],
      targets  = [{asset: "SPY", target_pct: 60}, {asset: "BND", target_pct: 40}],
      drift_threshold_pct = 1.0,
      cash_injection = 0
    } = query;

    // Validate targets sum to ~100
    const targetSum = targets.reduce((s, t) => s + t.target_pct, 0);
    if (Math.abs(targetSum - 100) > 0.5)
      throw new Error(`target percentages must sum to 100 (got ${round(targetSum, 2)})`);

    // Build holding lookup
    const holdingMap = {};
    let totalValue = 0;
    for (const h of holdings) {
      if (h.current_value < 0) throw new Error(`negative value for ${h.asset}`);
      holdingMap[h.asset] = h.current_value;
      totalValue += h.current_value;
    }
    totalValue += cash_injection;

    if (totalValue <= 0) throw new Error("total portfolio value must be positive");

    // Build target lookup
    const targetMap = {};
    for (const t of targets) {
      targetMap[t.asset] = t.target_pct / 100;
    }

    // Check all targets reference known holdings (allow targets for new assets with 0 current value)
    const allAssets = new Set([
      ...Object.keys(holdingMap),
      ...Object.keys(targetMap),
    ]);

    // Compute orders
    const orders = [];
    let buysTotal  = 0;
    let sellsTotal = 0;

    for (const asset of allAssets) {
      const current_value  = holdingMap[asset] || 0;
      const target_frac    = targetMap[asset]  || 0;
      const target_value   = totalValue * target_frac;
      const delta          = target_value - current_value;

      const current_pct    = round((current_value / totalValue) * 100, 2);
      const target_pct_val = round(target_frac * 100, 2);
      const drift_pct      = round(Math.abs(target_pct_val - current_pct), 2);
      const in_range       = drift_pct <= drift_threshold_pct;

      const order = {
        asset,
        current_value:  round(current_value, 2),
        current_pct,
        target_pct:     target_pct_val,
        target_value:   round(target_value, 2),
        delta:          round(delta, 2),
        action:         delta > 0.01 ? "BUY" : delta < -0.01 ? "SELL" : "HOLD",
        drift_pct,
        needs_rebalance: !in_range && Math.abs(delta) > 0.01,
      };

      orders.push(order);
      if (delta > 0.01) buysTotal  += delta;
      if (delta < -0.01) sellsTotal += Math.abs(delta);
    }

    orders.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
      total_portfolio_value: round(totalValue, 2),
      cash_injection: round(cash_injection, 2),
      orders,
      summary: {
        assets_to_buy:  orders.filter(o => o.action === "BUY").length,
        assets_to_sell: orders.filter(o => o.action === "SELL").length,
        assets_in_range: orders.filter(o => !o.needs_rebalance).length,
        total_buy_volume:  round(buysTotal, 2),
        total_sell_volume: round(sellsTotal, 2),
        drift_threshold_pct,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
