// eth-block.js
//
// Returns an Ethereum block header + transaction hashes for any block number,
// tag (latest/pending/earliest/safe/finalized), or hex string.
// Collapses the onesource.io seat: skills.onesource.io/api/chain/block/$0.003/call
// — 14 distinct wallets, 1-day persistence, signal-intel signal 52194, strength 0.80.
// Priced at $0.004.
//
// Free upstream: DRPC.org public JSON-RPC — no API key required.

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://base.drpc.org",
  polygon:  "https://polygon.drpc.org",
  arbitrum: "https://arbitrum.drpc.org",
};

const TAGS = new Set(["latest", "pending", "earliest", "safe", "finalized"]);

async function rpc(url, method, params) {
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

function toBlockParam(number) {
  if (number === undefined || number === null || number === "") return "latest";
  const s = String(number).trim().toLowerCase();
  if (TAGS.has(s)) return s;
  if (s.startsWith("0x")) return s;
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0) return "0x" + n.toString(16);
  throw new Error(`invalid block number: ${number} — use an integer, hex string, or tag (latest/pending/earliest/safe/finalized)`);
}

export default {
  name:  "eth-block",
  price: "$0.039",

  description:
    "Returns an Ethereum block header and transaction hashes by block number, hex string, or tag (latest/pending/earliest/safe/finalized). Fields: block_number, hash, parent_hash, miner, timestamp_iso, gas_used, gas_limit, base_fee_gwei (EIP-1559), tx_count, transaction_hashes. Supports Ethereum (default), Base, Polygon, and Arbitrum. $0.004/call.",

  inputSchema: {
    type: "object",
    properties: {
      number: {
        description: "Block number as an integer, 0x-prefixed hex, or tag: latest/pending/earliest/safe/finalized. Defaults to latest.",
        oneOf: [
          { type: "integer", minimum: 0 },
          { type: "string" },
        ],
      },
      network: {
        type: "string",
        enum: ["ethereum", "base", "polygon", "arbitrum"],
        description: "Chain to query. Default: ethereum.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      network:            { type: "string",           description: "Chain queried." },
      block_number:       { type: "integer",          description: "Block number (decimal)." },
      hash:               { type: "string",           description: "Block hash." },
      parent_hash:        { type: "string",           description: "Parent block hash." },
      miner:              { type: "string",           description: "Block producer address." },
      timestamp_iso:      { type: "string",           description: "ISO-8601 block timestamp." },
      timestamp_unix:     { type: "integer",          description: "Unix timestamp of block." },
      gas_used:           { type: "integer",          description: "Gas used in this block." },
      gas_limit:          { type: "integer",          description: "Gas limit for this block." },
      base_fee_gwei:      { type: ["number","null"],  description: "EIP-1559 base fee in Gwei, null for pre-London blocks." },
      tx_count:           { type: "integer",          description: "Number of transactions in this block." },
      transaction_hashes: { type: "array", items: { type: "string" }, description: "Array of transaction hashes in this block." },
      ts:                 { type: "string",           description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const network  = (query.network || "ethereum").toLowerCase();
    const rpcUrl   = CHAINS[network];
    if (!rpcUrl) throw new Error(`unsupported network: ${network}`);

    const blockParam = toBlockParam(query.number);

    const block = await rpc(rpcUrl, "eth_getBlockByNumber", [blockParam, false]);
    if (!block) throw new Error(`block not found: ${blockParam}`);

    const h = (hex) => hex ? parseInt(hex, 16) : null;

    const timestamp_unix = h(block.timestamp);
    const base_fee_raw   = block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : null;

    return {
      network,
      block_number:       h(block.number),
      hash:               block.hash,
      parent_hash:        block.parentHash,
      miner:              block.miner,
      timestamp_iso:      timestamp_unix ? new Date(timestamp_unix * 1000).toISOString() : null,
      timestamp_unix,
      gas_used:           h(block.gasUsed),
      gas_limit:          h(block.gasLimit),
      base_fee_gwei:      base_fee_raw !== null ? Math.round(base_fee_raw / 1e9 * 1e4) / 1e4 : null,
      tx_count:           Array.isArray(block.transactions) ? block.transactions.length : 0,
      transaction_hashes: Array.isArray(block.transactions) ? block.transactions : [],
      ts:                 new Date().toISOString(),
    };
  },
};
