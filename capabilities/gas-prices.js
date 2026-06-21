// gas-prices.js
//
// Current gas prices and EIP-1559 fee recommendations across major EVM chains.
// Uses free public RPC endpoints — no API key required.
//
// Returns base fee, priority fee percentiles (slow/standard/fast), and
// estimated ETH cost for a simple 21k-gas transfer.

const CHAINS = {
  ethereum: {
    id: 1, name: "Ethereum",
    rpc: "https://ethereum.publicnode.com",
    symbol: "ETH", decimals: 18,
  },
  base: {
    id: 8453, name: "Base",
    rpc: "https://mainnet.base.org",
    symbol: "ETH", decimals: 18,
  },
  arbitrum: {
    id: 42161, name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    symbol: "ETH", decimals: 18,
  },
  optimism: {
    id: 10, name: "Optimism",
    rpc: "https://mainnet.optimism.io",
    symbol: "ETH", decimals: 18,
  },
  polygon: {
    id: 137, name: "Polygon",
    rpc: "https://polygon-rpc.com",
    symbol: "MATIC", decimals: 18,
  },
  bsc: {
    id: 56, name: "BNB Chain",
    rpc: "https://bsc-dataseed.binance.org",
    symbol: "BNB", decimals: 18,
  },
};

const UA         = "Mozilla/5.0 (compatible; the-stall/2.1; +https://intuitek.ai)";
const TIMEOUT_MS = 8000;
const TRANSFER_GAS = 21000;

async function rpcCall(url, method, params = []) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const body = await resp.json();
  if (body.error) throw new Error(`RPC error: ${body.error.message}`);
  return body.result;
}

async function getChainGas(chain) {
  const { rpc, name, symbol } = chain;

  try {
    // Fetch fee history (EIP-1559) + current gas price in parallel
    const [feeHistory, gasPrice] = await Promise.all([
      rpcCall(rpc, "eth_feeHistory", ["0xa", "latest", [10, 50, 90]]).catch(() => null),
      rpcCall(rpc, "eth_gasPrice", []).catch(() => null),
    ]);

    let baseFeeGwei  = null;
    let slowGwei     = null;
    let standardGwei = null;
    let fastGwei     = null;

    if (feeHistory) {
      const fees    = feeHistory.baseFeePerGas || [];
      const rewards = feeHistory.reward         || [];
      if (fees.length) baseFeeGwei = Math.round(parseInt(fees[fees.length - 1], 16) / 1e6) / 1e3;

      if (rewards.length) {
        const avg = (idx) =>
          Math.round(rewards.reduce((s, r) => s + parseInt(r[idx] || "0", 16), 0) / rewards.length / 1e6) / 1e3;
        slowGwei     = avg(0); // 10th pct
        standardGwei = avg(1); // 50th pct
        fastGwei     = avg(2); // 90th pct
      }
    }

    // Legacy gas price fallback
    const legacyGwei = gasPrice ? Math.round(parseInt(gasPrice, 16) / 1e6) / 1e3 : null;

    // Effective gas price for cost estimate
    const effectiveGwei = baseFeeGwei != null
      ? baseFeeGwei + (standardGwei ?? 0.5)
      : (legacyGwei ?? 1);

    const costGwei  = effectiveGwei * TRANSFER_GAS;
    const costWei   = costGwei * 1e9;
    const costToken = costWei / 1e18;

    return {
      network:       name,
      symbol,
      type:          feeHistory ? "EIP-1559" : "legacy",
      base_fee_gwei: baseFeeGwei,
      priority_fee: {
        slow_gwei:     slowGwei,
        standard_gwei: standardGwei,
        fast_gwei:     fastGwei,
      },
      legacy_gwei:   legacyGwei,
      estimated_transfer_cost: {
        gas_units: TRANSFER_GAS,
        effective_gwei: Math.round(effectiveGwei * 1000) / 1000,
        cost_in_token: Math.round(costToken * 1e10) / 1e10,
        token: symbol,
        note: "Cost = (base_fee + standard_priority) × 21000 gas",
      },
    };
  } catch (err) {
    return { network: name, symbol, error: err.message };
  }
}

export default {
  name:  "gas-prices",
  price: "$0.039",

  description:
    "Current gas prices and EIP-1559 fee recommendations across 6 major EVM chains: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain. Returns base fee, priority fee percentiles (slow/standard/fast), and estimated ETH/MATIC/BNB cost for a standard 21k-gas transfer. All sourced from free public RPC endpoints — no API key needed. Use before sending on-chain transactions, estimating agent operating costs, or comparing chain fees for routing decisions.",

  inputSchema: {
    type: "object",
    properties: {
      networks: {
        type: "array",
        items: {
          type: "string",
          enum: ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"],
        },
        description: "Which networks to query. Default: all 6. Specify a subset for faster response.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      chains: {
        type: "array",
        items: {
          type: "object",
          properties: {
            network:       { type: "string" },
            symbol:        { type: "string" },
            type:          { type: "string", description: "EIP-1559 | legacy" },
            base_fee_gwei: { type: ["number", "null"] },
            priority_fee:  {
              type: "object",
              properties: {
                slow_gwei:     { type: ["number", "null"] },
                standard_gwei: { type: ["number", "null"] },
                fast_gwei:     { type: ["number", "null"] },
              },
            },
            estimated_transfer_cost: { type: "object" },
            error: { type: "string" },
          },
        },
      },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const requestedNets = Array.isArray(query.networks) && query.networks.length > 0
      ? query.networks
      : Object.keys(CHAINS);

    const results = await Promise.all(
      requestedNets.map((net) => {
        const chain = CHAINS[net.toLowerCase()];
        if (!chain) return Promise.resolve({ network: net, error: `Unknown network "${net}"` });
        return getChainGas(chain);
      })
    );

    return {
      chains: results,
      ts: new Date().toISOString(),
    };
  },
};
