// block-intel.js
//
// Returns block header data (number, hash, timestamp, gas metrics, tx count,
// validator) from Base, Ethereum, or Arbitrum mainnet via free public RPCs.
//
// Priced at $0.002 — 33% below skills.onesource.io's $0.003/call for the same
// eth_getBlockByNumber data. Targeted at the tx-explainer → block-context seam
// observed in signal-intel archive: 7-day signal, 6 distinct wallets (2026-06-06).
//
// Free RPCs used (no API key):
//   Base:      https://mainnet.base.org         (Coinbase official)
//   Ethereum:  https://ethereum.publicnode.com  (PublicNode)
//   Arbitrum:  https://arb1.arbitrum.io/rpc     (Offchain Labs official)

const RPCS = {
  base:     "https://mainnet.base.org",
  ethereum: "https://ethereum.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

function hexToDec(hex) {
  if (!hex || hex === "0x0") return 0;
  return parseInt(hex, 16);
}

function normalizeBlockParam(raw) {
  if (!raw || raw === "latest") return "latest";
  if (["earliest", "pending", "safe", "finalized"].includes(raw)) return raw;
  // decimal integer string
  if (/^\d+$/.test(raw)) return "0x" + parseInt(raw, 10).toString(16);
  // already hex
  if (/^0x[0-9a-fA-F]+$/.test(raw)) return raw;
  return "latest";
}

export default {
  name: "block-intel",
  price: "$0.034",

  description:
    "Returns block header data (number, hash, timestamp, gas used/limit, base fee, tx count, validator address) for any block on Base, Ethereum, or Arbitrum. Accepts block tag (latest/safe/finalized) or number. Free-RPC alternative to skills.onesource.io at 33% lower price — $0.002 vs $0.003.",

  inputSchema: {
    type: "object",
    properties: {
      network: {
        type: "string",
        description: "Chain to query: 'base' (default), 'ethereum', or 'arbitrum'.",
      },
      block: {
        type: "string",
        description:
          "Block identifier: 'latest' (default), 'safe', 'finalized', 'earliest', decimal block number, or 0x-prefixed hex number.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      network:       { type: "string",  description: "Chain queried." },
      number:        { type: "integer", description: "Block number (decimal)." },
      hash:          { type: "string",  description: "Block hash (0x-prefixed)." },
      parent_hash:   { type: "string",  description: "Parent block hash." },
      timestamp:     { type: "string",  description: "Block timestamp as ISO-8601 UTC." },
      timestamp_unix:{ type: "integer", description: "Block timestamp as Unix epoch seconds." },
      gas_used:      { type: "integer", description: "Gas used in this block (decimal)." },
      gas_limit:     { type: "integer", description: "Block gas limit (decimal)." },
      gas_used_pct:  { type: "number",  description: "Gas used as % of gas limit (0–100)." },
      base_fee_gwei: { type: "number",  description: "Base fee per gas in gwei (EIP-1559; null for pre-London blocks)." },
      tx_count:      { type: "integer", description: "Number of transactions in the block." },
      validator:     { type: "string",  description: "Block proposer / miner address." },
      ts:            { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const network   = (query.network || "base").toLowerCase().trim();
    const blockParam = normalizeBlockParam((query.block || "latest").trim());

    const rpcUrl = RPCS[network];
    if (!rpcUrl) {
      throw new Error(`unsupported network "${network}" — use: base, ethereum, arbitrum`);
    }

    let resp;
    try {
      resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBlockByNumber",
          params: [blockParam, false],
          id: 1,
        }),
        signal: AbortSignal.timeout(9000),
      });
    } catch (err) {
      throw new Error(`RPC fetch failed for ${network}: ${err.message}`);
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      throw new Error(`non-JSON response from ${network} RPC`);
    }

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const b = data.result;
    if (!b) {
      throw new Error(`block not found: ${blockParam} on ${network}`);
    }

    const gasUsed  = hexToDec(b.gasUsed);
    const gasLimit = hexToDec(b.gasLimit);
    const tsUnix   = hexToDec(b.timestamp);
    const baseFeeHex = b.baseFeePerGas;
    const baseFeeGwei = baseFeeHex
      ? Math.round((hexToDec(baseFeeHex) / 1e9) * 1e6) / 1e6
      : null;

    return {
      network,
      number:         hexToDec(b.number),
      hash:           b.hash,
      parent_hash:    b.parentHash,
      timestamp:      new Date(tsUnix * 1000).toISOString(),
      timestamp_unix: tsUnix,
      gas_used:       gasUsed,
      gas_limit:      gasLimit,
      gas_used_pct:   gasLimit > 0 ? Math.round((gasUsed / gasLimit) * 10000) / 100 : 0,
      base_fee_gwei:  baseFeeGwei,
      tx_count:       Array.isArray(b.transactions) ? b.transactions.length : 0,
      validator:      b.miner || null,
      ts:             new Date().toISOString(),
    };
  },
};
