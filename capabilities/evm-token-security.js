// evm-token-security.js
//
// Honeypot, rug-pull, and scam detection for EVM tokens.
// Sourced from GoPlusLabs public API (free, no key required).
// Supports 40+ chains: Ethereum, Base, BSC, Arbitrum, Polygon, Solana, etc.
//
// Seam origin: x402.ottoai.services/token-security observed with 54 organic
// payers ($0.007/call, signal-intel archive 2026-06-05). Complements the
// existing solana-token-risk capability with EVM/multi-chain coverage.

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1/token_security";
const UA         = "Mozilla/5.0 (compatible; the-stall/1.5; +https://intuitek.ai)";
const TIMEOUT_MS = 10000;

// Canonical chain IDs by common name
const CHAIN_ALIASES = {
  ethereum: "1", eth: "1",
  bsc: "56", bnb: "56",
  polygon: "137", matic: "137",
  arbitrum: "42161", arb: "42161",
  base: "8453",
  optimism: "10", op: "10",
  avalanche: "43114", avax: "43114",
  solana: "solana", sol: "solana",
  linea: "59144",
  scroll: "534352",
  zksync: "324",
  sonic: "146",
};

function riskScore(d) {
  let score = 0;
  if (d.is_honeypot === "1")             score += 100;
  if (d.hidden_owner === "1")            score += 30;
  if (d.can_take_back_ownership === "1") score += 25;
  if (d.is_mintable === "1")             score += 15;
  if (d.selfdestruct === "1")            score += 20;
  if (parseFloat(d.buy_tax  || "0") > 0.10) score += 10;
  if (parseFloat(d.sell_tax || "0") > 0.10) score += 20;
  if (d.honeypot_with_same_creator === "1") score += 15;
  if (d.is_open_source !== "1")          score += 10;
  const creatorPct = parseFloat(d.creator_percent || "0");
  if (creatorPct > 0.20)                 score += 20;
  if (creatorPct > 0.50)                 score += 30;
  return Math.min(score, 100);
}

function riskLabel(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  if (score >= 10) return "LOW";
  return "SAFE";
}

export default {
  name:  "evm-token-security",
  price: "$0.010",

  description:
    "Honeypot, rug-pull, and scam detection for any EVM token. Returns a 0–100 risk score with labeled flags: honeypot status, hidden ownership, mint authority, self-destruct, buy/sell tax rates, creator wallet concentration, and open-source status. Covers 40+ chains (Ethereum, Base, BSC, Arbitrum, Polygon, Solana, etc.) via GoPlusLabs. Useful pre-trade before buying unknown tokens, before routing payments through new contracts, or when validating DeFi protocol addresses. Pairs with solana-token-risk (Solana-native rug detection) and market-intelligence (endpoint verification).",

  inputSchema: {
    type: "object",
    required: ["address"],
    properties: {
      address: {
        type: "string",
        description: "Token contract address to screen (e.g. '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' for USDC on Base).",
      },
      chain: {
        type: "string",
        description: "Chain name or numeric chain ID. Common: ethereum, base, bsc, arbitrum, polygon, solana, optimism, avalanche. Default: base.",
        default: "base",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:        { type: "string" },
      chain_id:       { type: "string" },
      token_name:     { type: "string" },
      token_symbol:   { type: "string" },
      risk_score:     { type: "integer", description: "0 (safest) to 100 (critical risk). Composite of all flag weights." },
      risk_label:     { type: "string",  description: "SAFE | LOW | MEDIUM | HIGH | CRITICAL" },
      flags: {
        type: "object",
        description: "Individual risk flags. true = risk present, false = safe, null = not available for this chain.",
        properties: {
          is_honeypot:              { type: ["boolean", "null"] },
          hidden_owner:             { type: ["boolean", "null"] },
          can_take_back_ownership:  { type: ["boolean", "null"] },
          is_mintable:              { type: ["boolean", "null"] },
          selfdestruct:             { type: ["boolean", "null"] },
          is_open_source:           { type: ["boolean", "null"] },
          is_proxy:                 { type: ["boolean", "null"] },
          is_in_cex:                { type: ["boolean", "null"] },
          honeypot_with_same_creator: { type: ["boolean", "null"] },
        },
      },
      taxes: {
        type: "object",
        properties: {
          buy_tax_pct:  { type: ["number", "null"], description: "Buy tax as percent (0–100)." },
          sell_tax_pct: { type: ["number", "null"], description: "Sell tax as percent (0–100)." },
        },
      },
      ownership: {
        type: "object",
        properties: {
          creator_address:    { type: ["string", "null"] },
          creator_supply_pct: { type: ["number", "null"], description: "% of total supply held by creator wallet." },
          holder_count:       { type: ["integer", "null"] },
        },
      },
      raw_goplus:  { type: "object",  description: "Full GoPlusLabs response for the token (raw, for advanced consumers)." },
      ts:          { type: "string" },
    },
  },

  async handler(query) {
    const rawChain  = (query.chain || "base").toLowerCase().trim();
    const chainId   = CHAIN_ALIASES[rawChain] || rawChain;
    const address   = (query.address || "").trim();

    if (!address) throw new Error("address is required");

    const url  = `${GOPLUS_URL}/${encodeURIComponent(chainId)}?contract_addresses=${encodeURIComponent(address)}`;
    let body;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`GoPlusLabs HTTP ${resp.status}`);
      body = await resp.json();
    } catch (err) {
      throw new Error(`GoPlusLabs fetch failed: ${err.message}`);
    }

    if (body.code !== 1) throw new Error(`GoPlusLabs error: ${body.message}`);

    const resultKey = Object.keys(body.result || {})[0];
    if (!resultKey) throw new Error("Token not found on this chain — verify contract address and chain ID");
    const d = body.result[resultKey];

    function flag(val) {
      if (val === undefined || val === null || val === "") return null;
      return val === "1";
    }

    function taxPct(val) {
      if (val === undefined || val === null || val === "") return null;
      return Math.round(parseFloat(val) * 10000) / 100; // decimal → %
    }

    const score = riskScore(d);

    return {
      address:      resultKey,
      chain_id:     chainId,
      token_name:   d.token_name   || null,
      token_symbol: d.token_symbol || null,
      risk_score:   score,
      risk_label:   riskLabel(score),
      flags: {
        is_honeypot:               flag(d.is_honeypot),
        hidden_owner:              flag(d.hidden_owner),
        can_take_back_ownership:   flag(d.can_take_back_ownership),
        is_mintable:               flag(d.is_mintable),
        selfdestruct:              flag(d.selfdestruct),
        is_open_source:            flag(d.is_open_source),
        is_proxy:                  flag(d.is_proxy),
        is_in_cex:                 flag(d.is_in_cex),
        honeypot_with_same_creator: flag(d.honeypot_with_same_creator),
      },
      taxes: {
        buy_tax_pct:  taxPct(d.buy_tax),
        sell_tax_pct: taxPct(d.sell_tax),
      },
      ownership: {
        creator_address:    d.creator_address    || null,
        creator_supply_pct: d.creator_percent != null
          ? Math.round(parseFloat(d.creator_percent) * 10000) / 100
          : null,
        holder_count: d.holder_count != null ? parseInt(d.holder_count, 10) : null,
      },
      raw_goplus: d,
      ts: new Date().toISOString(),
    };
  },
};
