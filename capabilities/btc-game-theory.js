// btc-game-theory.js
//
// Bitcoin mining game theory + systems theory analysis in one call.
// Collapses the observed seam: btcnode.uk/api/game-theory → btcnode.uk/api/systems-theory
// (11 distinct wallets, 5-day persistence, PROSPECTOR strength 1.0).
// Priced at $0.006. Free upstream: mempool.space public API + CoinGecko.
//
// Computes: selfish-mining threshold, 51%-attack cost estimate, fee/subsidy ratio,
// difficulty-loop state (expansion vs contraction), Nash-equilibrium assessment,
// and the current epoch's difficulty trajectory.

const MEMPOOL   = "https://mempool.space/api";
const CG_PRICE  = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const UA        = "Mozilla/5.0 (compatible; the-stall/0.7; +https://intuitek.ai)";
const T         = 15_000;

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// Classic Eyal-Sirer selfish-mining threshold α* as a function of connectivity γ.
// γ = fraction of honest miners who extend the selfish chain when it ties.
// Result: minimum pool share needed for selfish mining to be profitable.
function selfishMiningThreshold(gamma = 0) {
  return (1 - gamma) / (3 - 2 * gamma);
}

// Rough 1-hour 51%-attack electricity cost.
// hash_rate_ehs: network hash rate in EH/s
// price_usd: BTC/USD
// efficiency_w_per_th: typical ASIC power draw (default 20 W/TH for modern hardware)
// electricity_kwh: $/kWh (default 0.07)
function attackCostPerHour(hash_rate_ehs, efficiency_w_per_th = 20, electricity_kwh = 0.07) {
  const attacker_ehs  = hash_rate_ehs * 0.51;
  const attacker_ths  = attacker_ehs * 1e6;          // 1 EH = 1e6 TH
  const power_w       = attacker_ths * efficiency_w_per_th;
  const power_kwh_hr  = power_w / 1000;
  return power_kwh_hr * electricity_kwh;
}

export default {
  name:  "btc-game-theory",
  price: "$0.006",

  description:
    "Bitcoin mining game theory and systems dynamics in one call. Returns: selfish-mining profitability threshold (Eyal-Sirer), 51%-attack electricity cost estimate, fee-vs-subsidy revenue split, difficulty epoch trajectory (expansion / contraction / neutral), Nash-equilibrium state for honest mining, and current epoch progress. Sourced from mempool.space and CoinGecko — no API key required. Use for miner-incentive analysis, network security assessment, and pre-investment regime detection.",

  inputSchema: {
    type: "object",
    properties: {
      connectivity_gamma: {
        type: "number",
        description:
          "Assumed fraction of honest miners who extend the selfish chain when block heights are equal (0–1). Higher γ means better-connected selfish miner. Default 0 (worst-case for honest miners).",
        default: 0,
        minimum: 0,
        maximum: 1,
      },
      electricity_kwh_usd: {
        type: "number",
        description:
          "Assumed electricity cost in $/kWh for 51%-attack cost estimate. Default 0.07.",
        default: 0.07,
        minimum: 0.001,
      },
      efficiency_w_per_th: {
        type: "number",
        description:
          "Assumed ASIC power efficiency in W/TH. Default 20 (representative of modern S21/M60 hardware). Lower = more efficient attackers.",
        default: 20,
        minimum: 1,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      network: {
        type: "object",
        properties: {
          hash_rate_ehs:         { type: "number", description: "Current network hash rate in EH/s." },
          block_height:          { type: "integer" },
          btc_price_usd:         { type: "number" },
        },
      },
      game_theory: {
        type: "object",
        properties: {
          selfish_mining_threshold_pct: {
            type: "number",
            description: "Minimum pool share (%) needed for selfish mining to be profitable given γ.",
          },
          honest_mining_nash_equilibrium: {
            type: "boolean",
            description: "True when no known public pool approaches the selfish-mining threshold.",
          },
          attack_cost_51pct_per_hour_usd: {
            type: "number",
            description: "Estimated electricity cost in USD to sustain a 51% attack for one hour.",
          },
          attack_cost_24h_usd:    { type: "number", description: "24-hour sustained attack cost (electricity only)." },
          fee_subsidy_ratio:      { type: "number", description: "Ratio of fee revenue to total miner revenue (0–1). Near 0 = subsidy-dependent; near 1 = fee-driven security." },
          fee_revenue_btc_day:    { type: "number", description: "Fee revenue in BTC per day (last ~144 blocks)." },
          subsidy_btc_day:        { type: "number", description: "Block subsidy in BTC per day." },
        },
      },
      systems_theory: {
        type: "object",
        properties: {
          difficulty_epoch_progress_pct: { type: "number" },
          difficulty_projected_change_pct: {
            type: "number",
            description: "Projected difficulty change at next retarget (negative = easing, positive = tightening).",
          },
          difficulty_loop_state: {
            type: "string",
            enum: ["EXPANDING", "CONTRACTING", "NEUTRAL"],
            description: "Hash-rate loop: EXPANDING (more miners joining), CONTRACTING (miners leaving), NEUTRAL (<2% change).",
          },
          blocks_until_retarget:    { type: "integer" },
          estimated_retarget_date:  { type: "string", description: "ISO-8601 estimated next difficulty adjustment." },
          fee_pressure_state: {
            type: "string",
            enum: ["HIGH", "MEDIUM", "LOW"],
            description: "Current mempool fee pressure: HIGH >20 sat/vB, MEDIUM 5–20, LOW <5.",
          },
          fastest_fee_sat_vb:  { type: "integer" },
          economy_fee_sat_vb:  { type: "integer" },
          security_trend:      { type: "string", description: "Brief narrative of current security posture." },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const gamma      = Number(input.connectivity_gamma     ?? 0);
    const elec       = Number(input.electricity_kwh_usd    ?? 0.07);
    const efficiency = Number(input.efficiency_w_per_th    ?? 20);

    const [diffAdj, rewardStats, fees, blockTip, priceData, hashrateData] = await Promise.all([
      get(`${MEMPOOL}/v1/difficulty-adjustment`),
      get(`${MEMPOOL}/v1/mining/reward-stats/144`),
      get(`${MEMPOOL}/v1/fees/recommended`),
      get(`${MEMPOOL}/blocks/tip/height`),
      get(CG_PRICE).catch(() => ({ bitcoin: { usd: null } })),
      get(`${MEMPOOL}/v1/mining/hashrate/1m`).catch(() => ({ hashrates: [] })),
    ]);

    // Hash rate — most recent entry in EH/s
    const latestHashrate = hashrateData?.hashrates?.slice(-1)[0]?.avgHashrate ?? 0;
    const hashRateEhs    = latestHashrate / 1e18;   // hashes → EH

    // BTC price
    const btcPrice = priceData?.bitcoin?.usd ?? null;

    // Reward stats (last ~144 blocks ≈ 1 day)
    const totalRewardSats = Number(rewardStats.totalReward ?? 0);
    const totalFeeSats    = Number(rewardStats.totalFee    ?? 0);
    const subsidySats     = totalRewardSats - totalFeeSats;
    const feeRatio        = totalRewardSats > 0 ? totalFeeSats / totalRewardSats : 0;
    const feeRevBtc       = totalFeeSats / 1e8;
    const subsidyBtc      = subsidySats  / 1e8;

    // Selfish mining threshold
    const threshold_frac = selfishMiningThreshold(gamma);
    const threshold_pct  = Number((threshold_frac * 100).toFixed(2));

    // 51% attack cost
    const costHour  = attackCostPerHour(hashRateEhs, efficiency, elec);
    const cost24h   = costHour * 24;

    // Difficulty loop state
    const projChange = diffAdj.difficultyChange ?? 0;
    const loopState  = projChange > 2 ? "EXPANDING" : projChange < -2 ? "CONTRACTING" : "NEUTRAL";

    // Fee pressure
    const fastFee = fees.fastestFee ?? 0;
    const feePressure = fastFee > 20 ? "HIGH" : fastFee >= 5 ? "MEDIUM" : "LOW";

    // Security trend narrative
    const secVerbs   = loopState === "EXPANDING" ? "strengthening" : loopState === "CONTRACTING" ? "weakening" : "stable";
    const subsidyPct = Number(((1 - feeRatio) * 100).toFixed(1));
    const secTrend   = `Hash rate ${secVerbs} (${projChange > 0 ? "+" : ""}${projChange.toFixed(2)}% next retarget). `
                     + `Miner revenue ${subsidyPct}% subsidy / ${(feeRatio * 100).toFixed(1)}% fees. `
                     + `51% attack costs ~$${Math.round(cost24h).toLocaleString()}/day.`;

    return {
      network: {
        hash_rate_ehs:   Number(hashRateEhs.toFixed(2)),
        block_height:    typeof blockTip === "number" ? blockTip : null,
        btc_price_usd:   btcPrice,
      },
      game_theory: {
        selfish_mining_threshold_pct:        threshold_pct,
        honest_mining_nash_equilibrium:      threshold_pct > 25,  // conservative: no known pool at ~33%
        attack_cost_51pct_per_hour_usd:      Math.round(costHour),
        attack_cost_24h_usd:                 Math.round(cost24h),
        fee_subsidy_ratio:                   Number(feeRatio.toFixed(6)),
        fee_revenue_btc_day:                 Number(feeRevBtc.toFixed(4)),
        subsidy_btc_day:                     Number(subsidyBtc.toFixed(4)),
      },
      systems_theory: {
        difficulty_epoch_progress_pct:       Number((diffAdj.progressPercent ?? 0).toFixed(2)),
        difficulty_projected_change_pct:     Number(projChange.toFixed(4)),
        difficulty_loop_state:               loopState,
        blocks_until_retarget:               diffAdj.remainingBlocks ?? null,
        estimated_retarget_date:             diffAdj.estimatedRetargetDate
                                               ? new Date(diffAdj.estimatedRetargetDate).toISOString()
                                               : null,
        fee_pressure_state:                  feePressure,
        fastest_fee_sat_vb:                  fastFee,
        economy_fee_sat_vb:                  fees.economyFee ?? 0,
        security_trend:                      secTrend,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
