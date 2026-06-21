// wallet-balance.js
//
// Native token balance for any EVM wallet address.
// Seam: api.x402node.dev/chain/eth-balance — 16 payers, 34 settlements, $0.005/call.
// Priced at $0.002 (60% below x402node).
//
// Free upstreams: DRPC.org public JSON-RPC (no key) + CoinGecko public API (no key).

const CHAINS = {
  ethereum: { rpc: "https://eth.drpc.org",      native: "ETH",   cgId: "ethereum"    },
  base:     { rpc: "https://base.drpc.org",     native: "ETH",   cgId: "ethereum"    },
  polygon:  { rpc: "https://polygon.drpc.org",  native: "POL",   cgId: "matic-network" },
  arbitrum: { rpc: "https://arbitrum.drpc.org", native: "ETH",   cgId: "ethereum"    },
  optimism: { rpc: "https://optimism.drpc.org", native: "ETH",   cgId: "ethereum"    },
  bsc:      { rpc: "https://bsc.drpc.org",      native: "BNB",   cgId: "binancecoin" },
};

const CG_URL = "https://api.coingecko.com/api/v3/simple/price";
const UA = "Mozilla/5.0 (compatible; the-stall/wallet-balance; +https://intuitek.ai)";

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

async function fetchUsdPrice(cgId) {
  const url = `${CG_URL}?ids=${cgId}&vs_currencies=usd`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const d = await resp.json();
  return d?.[cgId]?.usd ?? null;
}

export default {
  name:  "wallet-balance",
  price: "$0.039",

  description:
    "Returns the native token balance (ETH, POL, BNB) for any EVM wallet address. Supports Ethereum, Base, Polygon, Arbitrum, Optimism, and BSC. Includes optional USD value. $0.010/call. Free upstreams: DRPC + CoinGecko, no API key required.",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      address: {
        type: "string",
        description: "EVM wallet address (0x-prefixed, 42 characters).",
      },
      network: {
        type: "string",
        enum: ["ethereum", "base", "polygon", "arbitrum", "optimism", "bsc"],
        description: "Chain to query. Default: ethereum.",
      },
      with_usd: {
        type: "boolean",
        description: "If true, fetches live USD price and returns USD value. Default: false.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:       { type: "string",  description: "Address queried." },
      network:       { type: "string",  description: "Chain queried." },
      native_token:  { type: "string",  description: "Symbol of the native token (ETH, POL, BNB)." },
      balance_wei:   { type: "string",  description: "Raw balance in smallest unit (wei/gwei-equivalent)." },
      balance:       { type: "number",  description: "Balance in native token units (up to 18 decimal places)." },
      balance_usd:   { type: ["number", "null"], description: "USD value at current price, or null if with_usd was false or price unavailable." },
      price_usd:     { type: ["number", "null"], description: "Native token USD price used for conversion, or null." },
      block_number:  { type: "integer", description: "Block number at which balance was read." },
      ts:            { type: "string",  description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const addr = (query.address || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr))
      throw new Error(`invalid address: ${addr} — must be 0x-prefixed 42-char hex`);

    const network = (query.network || "ethereum").toLowerCase();
    const chain   = CHAINS[network];
    if (!chain) throw new Error(`unsupported network: ${network}`);

    const withUsd = !!query.with_usd;

    const fetches = [
      rpc(chain.rpc, "eth_getBalance", [addr, "latest"]),
      rpc(chain.rpc, "eth_blockNumber", []),
    ];
    if (withUsd) fetches.push(fetchUsdPrice(chain.cgId));

    const [balanceHex, blockHex, priceUsd] = await Promise.all(fetches);

    const balanceWei = BigInt(balanceHex);
    const balanceNum = Number(balanceWei) / 1e18;
    const blockNum   = parseInt(blockHex, 16);

    const balanceUsd = (withUsd && priceUsd != null)
      ? Math.round(balanceNum * priceUsd * 100) / 100
      : null;

    return {
      address:      addr,
      network,
      native_token: chain.native,
      balance_wei:  balanceWei.toString(),
      balance:      Math.round(balanceNum * 1e8) / 1e8,
      balance_usd:  balanceUsd,
      price_usd:    withUsd ? priceUsd : null,
      block_number: blockNum,
      ts:           new Date().toISOString(),
    };
  },
};
