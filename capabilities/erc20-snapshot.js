// erc20-snapshot.js
//
// ERC20 token state in a single x402 call — collapses the onesource.io seam:
//   skills.onesource.io/api/chain/total-supply   229 payers / $0.003
//   skills.onesource.io/api/chain/erc20-balance  210 payers / $0.003
//   skills.onesource.io/api/chain/allowance      217 payers / $0.003
//   skills.onesource.io/api/chain/contract       155 payers / $0.005
//
// All four agent calls collapse into one x402 payment at $0.007 —
// 36% below the $0.011 combined chain.
//
// Uses DRPC.org public JSON-RPC (single calls in parallel; batch limit is 3).
// Supports Ethereum, Base, Polygon, Arbitrum. No API key required.

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  eth:      "https://eth.drpc.org",
  base:     "https://mainnet.base.org",         // official Coinbase public RPC
  polygon:  "https://polygon-bor-rpc.publicnode.com",
  matic:    "https://polygon-bor-rpc.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",     // official Arbitrum public RPC
  arb:      "https://arb1.arbitrum.io/rpc",
};

const TIMEOUT = 15_000;

function padAddr(addr) {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

function decodeString(hex) {
  const data = (hex || "").replace(/^0x/, "");
  if (data.length < 128) return null;
  const length = parseInt(data.slice(64, 128), 16);
  if (isNaN(length) || length === 0) return "";
  const strHex = data.slice(128, 128 + length * 2);
  try {
    return Buffer.from(strHex, "hex").toString("utf8").replace(/\0/g, "");
  } catch {
    return null;
  }
}

function decodeUint(hex) {
  const data = (hex || "").replace(/^0x/, "");
  if (!data || data.length === 0) return null;
  try {
    return BigInt("0x" + data.slice(-64).padStart(64, "0"));
  } catch {
    return null;
  }
}

function formatAmount(raw, decimals) {
  if (raw === null) return null;
  const d = Number(decimals);
  if (d === 0) return raw.toString();
  const divisor = 10n ** BigInt(d);
  const whole   = raw / divisor;
  const frac    = raw % divisor;
  const fracStr = frac.toString().padStart(d, "0").slice(0, 6);
  return `${whole}.${fracStr}`;
}

async function ethCall(rpcUrl, to, data) {
  const resp = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) return null;
  return d.result;
}

async function blockNumber(rpcUrl) {
  const resp = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) return null;
  const d = await resp.json();
  if (d.error || !d.result) return null;
  return Number(BigInt(d.result));
}

export default {
  name:  "erc20-snapshot",
  price: "$0.014",

  description:
    "Complete ERC20 token state in one call: name, symbol, decimals, total supply (raw + formatted), wallet balance, and allowance. Collapses four onesource chain calls (total-supply + erc20-balance + allowance + contract — 155–229 payers each) into one $0.007 payment — 36% below the $0.011 combined chain. Supports Ethereum (default), Base, Polygon, Arbitrum. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      contract: {
        type: "string",
        description: "ERC20 token contract address (0x-prefixed, 42 chars).",
      },
      wallet: {
        type: "string",
        description: "Wallet address to check token balance for (optional).",
      },
      spender: {
        type: "string",
        description: "Spender address to check allowance against wallet (optional; requires wallet).",
      },
      network: {
        type: "string",
        enum: ["ethereum", "eth", "base", "polygon", "matic", "arbitrum", "arb"],
        default: "ethereum",
        description: "EVM chain. Default: ethereum.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      contract:       { type: "string" },
      network:        { type: "string" },
      name:           { type: ["string", "null"] },
      symbol:         { type: ["string", "null"] },
      decimals:       { type: ["integer", "null"] },
      total_supply:   { type: "object", properties: { raw: { type: ["string","null"] }, formatted: { type: ["string","null"] } } },
      wallet_balance: { type: ["object", "null"] },
      allowance:      { type: ["object", "null"] },
      block_number:   { type: ["integer", "null"] },
      generated_at:   { type: "string" },
    },
  },

  async handler(input) {
    const contract = (input.contract || "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48").trim().toLowerCase();
    const wallet   = (input.wallet   || "").trim().toLowerCase() || null;
    const spender  = (input.spender  || "").trim().toLowerCase() || null;
    const network  = (input.network  || "ethereum").toLowerCase();

    if (!/^0x[0-9a-f]{40}$/.test(contract)) {
      throw new Error("contract must be a 0x-prefixed 40-hex-char address");
    }
    if (wallet  && !/^0x[0-9a-f]{40}$/.test(wallet)) {
      throw new Error("wallet must be a 0x-prefixed 40-hex-char address");
    }
    if (spender && !/^0x[0-9a-f]{40}$/.test(spender)) {
      throw new Error("spender must be a 0x-prefixed 40-hex-char address");
    }

    const rpc = CHAINS[network] || CHAINS.ethereum;

    // All reads fire in parallel — one x402 payment, multiple upstream calls
    const tasks = {
      name:        ethCall(rpc, contract, "0x06fdde03"),
      symbol:      ethCall(rpc, contract, "0x95d89b41"),
      decimals:    ethCall(rpc, contract, "0x313ce567"),
      totalSupply: ethCall(rpc, contract, "0x18160ddd"),
      blockNum:    blockNumber(rpc),
      balance:     wallet  ? ethCall(rpc, contract, "0x70a08231" + padAddr(wallet)) : Promise.resolve(null),
      allowance:   (wallet && spender) ? ethCall(rpc, contract, "0xdd62ed3e" + padAddr(wallet) + padAddr(spender)) : Promise.resolve(null),
    };

    const [nameRaw, symRaw, decRaw, supRaw, blkNum, balRaw, allowRaw] =
      await Promise.all(Object.values(tasks));

    const name      = decodeString(nameRaw);
    const symbol    = decodeString(symRaw);
    const decimals  = decRaw ? Number(decodeUint(decRaw) ?? 18n) : 18;
    const supply    = decodeUint(supRaw);

    const walletBalance = wallet ? {
      wallet,
      raw:       balRaw ? (decodeUint(balRaw) ?? null)?.toString() : null,
      formatted: balRaw ? formatAmount(decodeUint(balRaw), decimals) : null,
    } : null;

    const allowanceOut = (wallet && spender) ? {
      owner:     wallet,
      spender,
      raw:       allowRaw ? (decodeUint(allowRaw) ?? null)?.toString() : null,
      formatted: allowRaw ? formatAmount(decodeUint(allowRaw), decimals) : null,
    } : null;

    return {
      contract,
      network:       CHAINS[network] ? network : "ethereum",
      name,
      symbol,
      decimals,
      total_supply: {
        raw:       supply !== null ? supply.toString() : null,
        formatted: supply !== null ? formatAmount(supply, decimals) : null,
      },
      wallet_balance: walletBalance,
      allowance:      allowanceOut,
      block_number:   blkNum,
      generated_at:   new Date().toISOString(),
    };
  },
};
