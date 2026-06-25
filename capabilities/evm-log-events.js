// evm-log-events.js
//
// EVM contract event log query via eth_getLogs — collapses the onesource.io seam:
//   skills.onesource.io/api/chain/events  $0.005/call (24 uncovered endpoints)
//
// Priced at $0.004 (20% below onesource's $0.005).
// Free upstream: DRPC.org public JSON-RPC — no API key required.
// Supports Ethereum, Base, Polygon, Arbitrum.

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  eth:      "https://eth.drpc.org",
  base:     "https://mainnet.base.org",
  polygon:  "https://polygon-bor-rpc.publicnode.com",
  matic:    "https://polygon-bor-rpc.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  arb:      "https://arb1.arbitrum.io/rpc",
};

const TIMEOUT = 15_000;
const MAX_LOGS = 50;

function toBlockParam(val) {
  if (!val || val === "latest") return "latest";
  const s = String(val).trim().toLowerCase();
  if (["latest","earliest","pending","safe","finalized"].includes(s)) return s;
  if (s.startsWith("0x")) return s;
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0) return "0x" + n.toString(16);
  return "latest";
}

function normalizeAddr(a) {
  if (!a) return null;
  const s = a.trim();
  return s.startsWith("0x") ? s.toLowerCase() : "0x" + s.toLowerCase();
}

async function rpc(url, method, params) {
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

function hexToDecimal(hex) {
  if (!hex) return null;
  try { return parseInt(hex, 16); } catch { return null; }
}

export default {
  name:  "evm-log-events",
  price: "$0.059",

  description:
    "Query EVM contract event logs via eth_getLogs. Filter by contract address, event topic (signature hash), and block range. Returns up to 50 decoded log entries with topics, data, tx hash, block number. Supports Ethereum/Base/Polygon/Arbitrum via free DRPC. $0.004/call — 20% below comparable market rate.",

  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description: "Contract address to query logs from (e.g. '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' for WETH).",
      },
      topic0: {
        type: "string",
        description: "Event signature hash (topic[0]) to filter by. Common values: Transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', Approval = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', Swap (Uniswap V2) = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'.",
      },
      from_block: {
        type: "string",
        description: "Start block — integer, hex string, or tag (latest/earliest). Default: 100 blocks before latest.",
      },
      to_block: {
        type: "string",
        description: "End block — integer, hex string, or tag. Default: latest.",
      },
      chain: {
        type: "string",
        enum: ["ethereum", "eth", "base", "polygon", "matic", "arbitrum", "arb"],
        description: "Chain to query. Default: ethereum.",
      },
      limit: {
        type: "integer",
        description: "Max number of log entries to return (1–50). Default: 20.",
        minimum: 1,
        maximum: 50,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      chain:      { type: "string" },
      address:    { type: "string" },
      from_block: { type: "integer" },
      to_block:   { type: "integer" },
      log_count:  { type: "integer" },
      logs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            block_number:    { type: "integer" },
            tx_hash:         { type: "string" },
            log_index:       { type: "integer" },
            contract:        { type: "string" },
            topics:          { type: "array", items: { type: "string" } },
            data:            { type: "string" },
          },
        },
      },
      note: { type: "string" },
    },
  },

  async handler(query) {
    const chain   = (query.chain || "ethereum").toLowerCase();
    const rpcUrl  = CHAINS[chain];
    if (!rpcUrl) throw new Error(`Unsupported chain: ${chain}. Use ethereum, base, polygon, or arbitrum.`);

    const address = normalizeAddr(query.address);
    const topic0  = query.topic0 ? query.topic0.trim() : undefined;
    const limit   = Math.min(Math.max(parseInt(query.limit ?? 20, 10) || 20, 1), MAX_LOGS);

    // Resolve to_block first to compute from_block default
    const toBlock = toBlockParam(query.to_block);

    let fromBlock;
    if (query.from_block) {
      fromBlock = toBlockParam(query.from_block);
    } else {
      // Default: last 10 blocks — larger ranges without address+topic filters return
      // massive responses (16MB+) that cause JSON parse failures. Use from_block to
      // explicitly widen the range.
      const defaultRange = (address || topic0) ? 100 : 10;
      try {
        const latest = await rpc(rpcUrl, "eth_blockNumber", []);
        const latestNum = parseInt(latest, 16);
        const startNum = Math.max(0, latestNum - defaultRange);
        fromBlock = "0x" + startNum.toString(16);
      } catch {
        fromBlock = toBlock; // fallback to single-block query
      }
    }

    // Build filter object
    const filter = { fromBlock, toBlock };
    if (address) filter.address = address;
    if (topic0)  filter.topics  = [topic0];

    const rawLogs = await rpc(rpcUrl, "eth_getLogs", [filter]);

    if (!Array.isArray(rawLogs)) throw new Error("Unexpected RPC response format");

    const logs = rawLogs.slice(0, limit).map(log => ({
      block_number: hexToDecimal(log.blockNumber),
      tx_hash:      log.transactionHash,
      log_index:    hexToDecimal(log.logIndex),
      contract:     log.address,
      topics:       log.topics || [],
      data:         log.data,
    }));

    const fromNum = hexToDecimal(fromBlock);
    const toNum   = toBlock === "latest" ? null : hexToDecimal(toBlock);

    return {
      chain,
      address: address || "any",
      from_block: fromNum,
      to_block:   toNum,
      log_count:  logs.length,
      logs,
      ...(rawLogs.length > limit
        ? { note: `Showing ${limit} of ${rawLogs.length} total logs. Narrow range or increase limit.` }
        : {}),
    };
  },
};
