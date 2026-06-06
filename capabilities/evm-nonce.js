// evm-nonce.js
//
// Returns the current nonce (transaction count) for any EVM address.
// Seam: skills.onesource.io/api/chain/nonce — 396 distinct payers, 2,865 settlements,
// $0.003/call. Priced at $0.002 (33% below onesource).
//
// Free upstream: DRPC.org public JSON-RPC — no API key required.

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://base.drpc.org",
  polygon:  "https://polygon.drpc.org",
  arbitrum: "https://arbitrum.drpc.org",
  optimism: "https://optimism.drpc.org",
};

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

export default {
  name:  "evm-nonce",
  price: "$0.002",

  description:
    "Returns the current nonce (confirmed transaction count) and pending nonce for any EVM wallet address. Supports Ethereum, Base, Polygon, Arbitrum, and Optimism. Use the pending nonce when building new transactions. $0.002/call — 33% below comparable market rate.",

  inputSchema: {
    type: "object",
    required: ["address"],
    properties: {
      address: {
        type: "string",
        description: "EVM wallet address (0x-prefixed, 42 characters).",
      },
      network: {
        type: "string",
        enum: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
        description: "Chain to query. Default: base.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:       { type: "string",  description: "Address queried (checksummed)." },
      network:       { type: "string",  description: "Chain queried." },
      nonce:         { type: "integer", description: "Confirmed nonce — number of mined transactions sent from this address." },
      pending_nonce: { type: "integer", description: "Pending nonce — includes transactions in the mempool; use this when building new transactions." },
      ts:            { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const addr    = (query.address || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr))
      throw new Error(`invalid address: ${addr} — must be 0x-prefixed 42-char hex`);

    const network = (query.network || "base").toLowerCase();
    const rpcUrl  = CHAINS[network];
    if (!rpcUrl) throw new Error(`unsupported network: ${network}`);

    const [confirmedHex, pendingHex] = await Promise.all([
      rpc(rpcUrl, "eth_getTransactionCount", [addr, "latest"]),
      rpc(rpcUrl, "eth_getTransactionCount", [addr, "pending"]),
    ]);

    return {
      address:       addr,
      network,
      nonce:         parseInt(confirmedHex, 16),
      pending_nonce: parseInt(pendingHex, 16),
      ts:            new Date().toISOString(),
    };
  },
};
