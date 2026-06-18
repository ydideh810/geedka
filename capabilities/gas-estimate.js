// gas-estimate.js
//
// Multi-chain gas price oracle. Returns current gas estimates (fast / standard
// / slow) in Gwei and estimated USD cost for a standard transfer, with EIP-1559
// base fee and priority fee breakdown where supported.
//
// Seam: api.x402node.dev/chain/eth-gas (9p, 165s, $0.005) +
//        api.x402node.dev/chain/base-gas (21p, 124s, $0.005) +
//        api.myceliasignal.com/oracle/gas/ethereum (5p, 39s) —
//        collapse 3 separate per-chain endpoints into one $0.015 multi-chain call.
//
// Free upstream: DRPC.org + public RPCs — eth_gasPrice + eth_feeHistory.
// Chains: ethereum, base, polygon, arbitrum, bsc.
//
// [REDACTED]5, 2026-06-06.

const RPCS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://mainnet.base.org",
  polygon:  "https://polygon.rpc.thirdweb.com",
  arbitrum: "https://arbitrum.llamarpc.com",
  bsc:      "https://bsc.drpc.org",
};

const COINGECKO_ETH = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,matic-network,binancecoin&vs_currencies=usd";
const TIMEOUT = 10_000;
const UA = "Mozilla/5.0 (compatible; the-stall/3.55; +https://intuitek.ai)";
const GAS_TRANSFER = 21_000; // standard ETH transfer gas limit

// In-memory price cache (60s TTL)
let _prices = null;
let _pricesTs = 0;

async function fetchPrices() {
  if (_prices && Date.now() - _pricesTs < 60_000) return _prices;
  try {
    const r = await fetch(COINGECKO_ETH, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const d = await r.json();
    _prices = {
      ethereum: d?.ethereum?.usd || 3000,
      polygon:  d?.["matic-network"]?.usd || 0.8,
      arbitrum: d?.ethereum?.usd || 3000,
      base:     d?.ethereum?.usd || 3000,
      bsc:      d?.binancecoin?.usd || 600,
    };
    _pricesTs = Date.now();
    return _prices;
  } catch {
    return { ethereum: 3000, base: 3000, polygon: 0.8, arbitrum: 3000, bsc: 600 };
  }
}

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

async function getGas(chain) {
  const rpcUrl = RPCS[chain];
  if (!rpcUrl) throw new Error(`Unknown chain: ${chain}`);

  let gasPrice = null;
  let baseFee = null;
  let priorityFee = null;

  try {
    // Get current gas price (legacy)
    const raw = await rpc(rpcUrl, "eth_gasPrice", []);
    gasPrice = parseInt(raw, 16) / 1e9; // to gwei

    // Try EIP-1559 fee history for better estimates
    const hist = await rpc(rpcUrl, "eth_feeHistory", ["0x5", "latest", [10, 50, 90]]);
    if (hist?.baseFeePerGas?.length) {
      const latest = hist.baseFeePerGas.slice(-2, -1)[0];
      baseFee = parseInt(latest, 16) / 1e9;
      const rewards = hist.reward || [];
      if (rewards.length > 0) {
        const p10 = rewards.map(r => parseInt(r[0], 16) / 1e9);
        const p50 = rewards.map(r => parseInt(r[1], 16) / 1e9);
        const p90 = rewards.map(r => parseInt(r[2], 16) / 1e9);
        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        priorityFee = {
          slow:     Math.round(avg(p10) * 10) / 10,
          standard: Math.round(avg(p50) * 10) / 10,
          fast:     Math.round(avg(p90) * 10) / 10,
        };
      }
    }
  } catch { /* fallback to gasPrice */ }

  if (gasPrice === null) throw new Error(`Cannot fetch gas for ${chain}`);

  const bf = baseFee || gasPrice * 0.8;
  const prio = priorityFee || {
    slow:     Math.round(gasPrice * 0.08 * 10) / 10,
    standard: Math.round(gasPrice * 0.15 * 10) / 10,
    fast:     Math.round(gasPrice * 0.3 * 10) / 10,
  };

  return {
    baseFeeGwei:   Math.round(bf * 100) / 100,
    priorityFeeGwei: prio,
    totalGwei: {
      slow:     Math.round((bf + prio.slow) * 100) / 100,
      standard: Math.round((bf + prio.standard) * 100) / 100,
      fast:     Math.round((bf + prio.fast) * 100) / 100,
    },
  };
}

const VALID_CHAINS = Object.keys(RPCS);

export default {
  name: "gas-estimate",
  price: "$0.015",
  description:
    "Multi-chain gas price oracle: fast/standard/slow Gwei + USD cost for a transfer. Chains: ethereum, base, polygon, arbitrum, bsc. Seam: x402node/myceliasignal gas feeds.",

  inputSchema: {
    type: "object",
    properties: {
      chain: {
        type: "string",
        description: "Chain to query. Options: ethereum, base, polygon, arbitrum, bsc. Omit for all 5.",
        enum: [...VALID_CHAINS, "all"],
      },
    },
  },

  outputSchema: {
    type: "object",
    description: "Gas estimates per chain",
    additionalProperties: {
      type: "object",
      properties: {
        baseFeeGwei:      { type: "number" },
        priorityFeeGwei:  { type: "object" },
        totalGwei:        { type: "object" },
        transferCostUSD:  { type: "object" },
      },
    },
  },

  async handler({ chain = "all" }) {
    const targets = (chain === "all") ? VALID_CHAINS : [chain];
    for (const c of targets) {
      if (!RPCS[c]) throw new Error(`Unknown chain: ${c}. Options: ${VALID_CHAINS.join(", ")}`);
    }

    const [prices, gasResults] = await Promise.all([
      fetchPrices(),
      Promise.allSettled(targets.map(c => getGas(c).then(g => ({ chain: c, ...g })))),
    ]);

    const result = {};
    for (const r of gasResults) {
      if (r.status !== "fulfilled") continue;
      const { chain: c, baseFeeGwei, priorityFeeGwei, totalGwei } = r.value;
      const nativeUsd = prices[c] || 3000;
      const toUsd = (gwei) => {
        const costEth = (gwei * 1e9 * GAS_TRANSFER) / 1e18;
        return Math.round(costEth * nativeUsd * 10000) / 10000;
      };
      result[c] = {
        baseFeeGwei,
        priorityFeeGwei,
        totalGwei,
        transferCostUSD: {
          slow:     toUsd(totalGwei.slow),
          standard: toUsd(totalGwei.standard),
          fast:     toUsd(totalGwei.fast),
        },
      };
    }

    if (Object.keys(result).length === 0) {
      throw new Error("All chain RPCs failed — retry");
    }

    return result;
  },
};
