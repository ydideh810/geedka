// defi-state-pack.js
//
// Seam: eth-block → yield-farming-active (+ stablecoin-watch) in one call.
// signal-intel signal_id 64812 (seam, strength 1.0) — observed agents running
// block/0x1212D00 → yield-farming-active chain in the wild.
// Also collapses signal_id 60977 (stablecoin-watch seam, strength 1.0).
// Priced at $0.015.
//
// Free upstreams: DRPC.org public RPC + DeFiLlama stablecoins + DeFiLlama yields (no keys).

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://base.drpc.org",
  polygon:  "https://polygon.drpc.org",
  arbitrum: "https://arbitrum.drpc.org",
};
const BLOCK_TAGS   = new Set(["latest", "pending", "earliest", "safe", "finalized"]);
const STABLE_URL   = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
const YIELDS_URL   = "https://yields.llama.fi/pools";
const UA           = "Mozilla/5.0 (compatible; myriad/defi-state-pack; +https://synaptiic.org)";

async function rpc(url, method, params) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

function toBlockParam(number) {
  if (number === undefined || number === null || number === "") return "latest";
  const s = String(number).trim().toLowerCase();
  if (BLOCK_TAGS.has(s)) return s;
  if (s.startsWith("0x")) return s;
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0) return "0x" + n.toString(16);
  throw new Error(`invalid block: ${number} — use an integer, 0x hex, or tag`);
}

function depegStatus(price) {
  const dev = Math.abs(price - 1.0);
  if (dev < 0.001) return "PARITY";
  if (dev < 0.005) return "MILD_DEPEG";
  if (dev < 0.01)  return "MODERATE_DEPEG";
  return "SEVERE_DEPEG";
}

function compositeAlert(coins) {
  if (coins.some(c => c.depeg_status === "SEVERE_DEPEG"))   return "RED";
  if (coins.some(c => c.depeg_status === "MODERATE_DEPEG")) return "ORANGE";
  if (coins.some(c => c.depeg_status === "MILD_DEPEG"))     return "YELLOW";
  return "GREEN";
}

export default {
  name:  "defi-state-pack",
  price: "$0.059",

  description:
    "Returns Ethereum block header + stablecoin depeg status + top DeFi yield farming pools in one call. Collapses the 3-hop eth-block → stablecoin-watch → yield-farming chain into a single call. All three upstreams fetched in parallel. Supports Ethereum, Base, Polygon, Arbitrum. Filter yield pools by chain, protocol, min TVL, min APY. Free upstreams — DRPC + DeFiLlama — no API key required.",

  inputSchema: {
    type: "object",
    properties: {
      block: {
        description: "Block number (integer or 0x hex) or tag: latest/pending/earliest/safe/finalized. Default: latest.",
        oneOf: [
          { type: "integer", minimum: 0 },
          { type: "string" },
        ],
      },
      network: {
        type: "string",
        enum: ["ethereum", "base", "polygon", "arbitrum"],
        description: "Chain to query for block data. Default: ethereum.",
      },
      stablecoin_symbol: {
        type: "string",
        description: "Filter stablecoins to a specific symbol (e.g. USDT, USDC, DAI). Omit to return top 10 by market cap.",
      },
      alert_only: {
        type: "boolean",
        description: "If true, only return stablecoins that are depegged (MILD_DEPEG or worse).",
      },
      yield_chain: {
        type: "string",
        description: "Filter yield pools by blockchain (e.g. 'Ethereum', 'Base', 'Arbitrum'). Case-insensitive. Omit for all chains.",
      },
      yield_protocol: {
        type: "string",
        description: "Filter yield pools by protocol name (e.g. 'aave-v3', 'uniswap-v3'). Case-insensitive substring.",
      },
      min_apy: {
        type: "number",
        description: "Minimum 30-day mean APY (%) for yield pool inclusion. Default 0.",
        default: 0,
        minimum: 0,
      },
      min_tvl_usd: {
        type: "number",
        description: "Minimum TVL in USD for yield pool inclusion. Default 1000000 ($1M).",
        default: 1000000,
        minimum: 0,
      },
      stablecoin_pools_only: {
        type: "boolean",
        description: "If true, only return stablecoin-only yield pools.",
      },
      top_pools: {
        type: "integer",
        description: "Max number of yield pools to return, sorted by 30-day mean APY desc. Default 10, max 25.",
        default: 10,
        minimum: 1,
        maximum: 25,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      block: {
        type: "object",
        description: "Block header from the requested chain.",
        properties: {
          network:        { type: "string" },
          block_number:   { type: "integer" },
          hash:           { type: "string" },
          miner:          { type: "string" },
          timestamp_iso:  { type: "string" },
          timestamp_unix: { type: "integer" },
          gas_used:       { type: "integer" },
          gas_limit:      { type: "integer" },
          base_fee_gwei:  { type: ["number", "null"] },
          tx_count:       { type: "integer" },
        },
      },
      stablecoins: {
        type: "object",
        properties: {
          alert_level: { type: "string", description: "GREEN | YELLOW | ORANGE | RED" },
          coins: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol:         { type: "string" },
                price:          { type: "number" },
                peg_deviation:  { type: "number" },
                depeg_status:   { type: "string" },
                circulating_bn: { type: "number" },
              },
            },
          },
          count: { type: "integer" },
        },
      },
      yield_pools: {
        type: "object",
        properties: {
          pools: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rank:          { type: "integer" },
                protocol:      { type: "string" },
                chain:         { type: "string" },
                symbol:        { type: "string" },
                tvl_usd:       { type: "number" },
                apy_current:   { type: "number" },
                apy_30d_mean:  { type: "number" },
                il_risk:       { type: "string" },
                stablecoin:    { type: "boolean" },
              },
            },
          },
          total_returned: { type: "integer" },
          total_matching: { type: "integer" },
        },
      },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const network     = (query.network || "ethereum").toLowerCase();
    const rpcUrl      = CHAINS[network];
    if (!rpcUrl) throw new Error(`unsupported network: ${network}`);
    const blockParam  = toBlockParam(query.block);
    const filterSym   = query.stablecoin_symbol ? String(query.stablecoin_symbol).toUpperCase().trim() : null;
    const alertOnly   = !!query.alert_only;
    const yChain      = (query.yield_chain    || "").trim().toLowerCase();
    const yProtocol   = (query.yield_protocol || "").trim().toLowerCase();
    const minTvl      = Number(query.min_tvl_usd   ?? 1_000_000);
    const minApy      = Number(query.min_apy        ?? 0);
    const stabOnly    = !!query.stablecoin_pools_only;
    const topPools    = Math.min(Math.max(parseInt(query.top_pools || "10", 10), 1), 25);

    // Three parallel fetches
    const [blockRaw, stableResp, yieldsResp] = await Promise.all([
      rpc(rpcUrl, "eth_getBlockByNumber", [blockParam, false]),
      fetch(STABLE_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) }),
      fetch(YIELDS_URL, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }),
    ]);

    if (!blockRaw)       throw new Error(`block not found: ${blockParam}`);
    if (!stableResp.ok)  throw new Error(`DeFiLlama stablecoins HTTP ${stableResp.status}`);
    if (!yieldsResp.ok)  throw new Error(`DeFiLlama yields HTTP ${yieldsResp.status}`);

    const [stableData, yieldsData] = await Promise.all([stableResp.json(), yieldsResp.json()]);

    // Block
    const h = (hex) => hex ? parseInt(hex, 16) : null;
    const tsUnix     = h(blockRaw.timestamp);
    const baseFeeRaw = blockRaw.baseFeePerGas ? parseInt(blockRaw.baseFeePerGas, 16) : null;
    const block = {
      network,
      block_number:   h(blockRaw.number),
      hash:           blockRaw.hash,
      miner:          blockRaw.miner,
      timestamp_iso:  tsUnix ? new Date(tsUnix * 1000).toISOString() : null,
      timestamp_unix: tsUnix,
      gas_used:       h(blockRaw.gasUsed),
      gas_limit:      h(blockRaw.gasLimit),
      base_fee_gwei:  baseFeeRaw !== null ? Math.round(baseFeeRaw / 1e9 * 1e4) / 1e4 : null,
      tx_count:       Array.isArray(blockRaw.transactions) ? blockRaw.transactions.length : 0,
    };

    // Stablecoins
    let assets = (stableData.peggedAssets || []).filter(
      a => a.pegType === "peggedUSD" && typeof a.price === "number"
    );
    assets.sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0));
    if (filterSym) {
      assets = assets.filter(a => a.symbol.toUpperCase() === filterSym);
    } else {
      assets = assets.slice(0, 10);
    }
    let coins = assets.map(a => ({
      symbol:         a.symbol,
      price:          Math.round(a.price * 1e6) / 1e6,
      peg_deviation:  Math.round(Math.abs(a.price - 1.0) * 1e6) / 1e6,
      depeg_status:   depegStatus(a.price),
      circulating_bn: Math.round(((a.circulating?.peggedUSD || 0) / 1e9) * 100) / 100,
    }));
    if (alertOnly) coins = coins.filter(c => c.depeg_status !== "PARITY");

    // Yield pools
    const allPools = Array.isArray(yieldsData.data) ? yieldsData.data : [];
    let pools = allPools.filter(p => {
      if (!p || typeof p.apy !== "number") return false;
      const tvl   = p.tvlUsd ?? 0;
      const apy30 = p.apyMean30d ?? p.apy;
      if (tvl < minTvl)   return false;
      if (apy30 < minApy) return false;
      if (stabOnly && !p.stablecoin) return false;
      if (yChain    && (p.chain   || "").toLowerCase() !== yChain)        return false;
      if (yProtocol && !(p.project || "").toLowerCase().includes(yProtocol)) return false;
      return true;
    });
    pools.sort((a, b) => ((b.apyMean30d ?? b.apy ?? 0) - (a.apyMean30d ?? a.apy ?? 0)));
    const totalMatching = pools.length;
    pools = pools.slice(0, topPools);

    return {
      block,
      stablecoins: {
        alert_level: compositeAlert(coins),
        coins,
        count: coins.length,
      },
      yield_pools: {
        pools: pools.map((p, i) => ({
          rank:         i + 1,
          protocol:     p.project  ?? "unknown",
          chain:        p.chain    ?? "unknown",
          symbol:       p.symbol   ?? "unknown",
          tvl_usd:      Math.round(p.tvlUsd ?? 0),
          apy_current:  Number((p.apy ?? 0).toFixed(4)),
          apy_30d_mean: Number((p.apyMean30d ?? p.apy ?? 0).toFixed(4)),
          il_risk:      p.ilRisk  ?? "unknown",
          stablecoin:   Boolean(p.stablecoin),
        })),
        total_returned: pools.length,
        total_matching: totalMatching,
      },
      ts: new Date().toISOString(),
    };
  },
};
