// address-security.js
//
// Wallet/address reputation and security check for EVM addresses.
// Detects phishing wallets, sanctions, cybercrime links, money laundering,
// blacklisted entities, dark-web activity, and more.
//
// Seam: defi.hugen.tokyo/defi/address — 1,010 settlements / 41 payers / 7d,
// ~$0.011/call. Priced at $0.010.
//
// Free upstream: GoPlusLabs address_security API (no key required).
// Data sources: SlowMist, BlockSec, GoPlus internal.
//
// [REDACTED]5, 2026-06-06.

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1/address_security";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.73; +https://intuitek.ai)";
const TIMEOUT_MS = 10000;

const CHAIN_ALIASES = {
  ethereum: "1", eth: "1",
  bsc: "56", bnb: "56",
  polygon: "137", matic: "137",
  arbitrum: "42161", arb: "42161",
  base: "8453",
  optimism: "10", op: "10",
  avalanche: "43114", avax: "43114",
  linea: "59144",
  scroll: "534352",
  zksync: "324",
};

function flag(val) {
  if (val === undefined || val === null || val === "") return null;
  return val === "1";
}

function riskScore(d) {
  let score = 0;
  if (d.sanctioned === "1")                        score += 100;
  if (d.phishing_activities === "1")               score += 80;
  if (d.cybercrime === "1")                        score += 70;
  if (d.stealing_attack === "1")                   score += 60;
  if (d.money_laundering === "1")                  score += 60;
  if (d.darkweb_transactions === "1")              score += 50;
  if (d.blackmail_activities === "1")              score += 50;
  if (d.financial_crime === "1")                   score += 40;
  if (d.mixer === "1")                             score += 35;
  if (d.fake_kyc === "1")                          score += 30;
  if (d.blacklist_doubt === "1")                   score += 25;
  if (d.malicious_mining_activities === "1")       score += 20;
  if (d.gas_abuse === "1")                         score += 10;
  const malCount = parseInt(d.number_of_malicious_contracts_created || "0", 10);
  if (malCount > 0)                                score += Math.min(malCount * 15, 60);
  return Math.min(score, 100);
}

function riskLabel(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  if (score >= 5)  return "LOW";
  return "CLEAN";
}

export default {
  name:  "address-security",
  price: "$0.136",

  description:
    "Wallet/address security and reputation check. Detects phishing, sanctions, cybercrime, money laundering, dark-web activity, and blacklisted wallets using GoPlus Labs + SlowMist + BlockSec data. Returns risk score (0-100) and per-flag breakdown. Supports Ethereum, Base, BSC, Polygon, Arbitrum, Optimism, Avalanche, and more.",

  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description: "EVM wallet address (0x...)",
      },
      chain: {
        type: "string",
        description: "Chain name or EIP-155 chain ID. Supported names: ethereum, base, bsc, polygon, arbitrum, optimism, avalanche. Default: ethereum",
        default: "ethereum",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      address:      { type: "string" },
      chain_id:     { type: "string" },
      risk_score:   { type: "integer", description: "0 = clean, 100 = critical risk" },
      risk_label:   { type: "string",  description: "CLEAN | LOW | MEDIUM | HIGH | CRITICAL" },
      is_contract:  { type: ["boolean", "null"] },
      flags: {
        type: "object",
        properties: {
          sanctioned:                       { type: ["boolean", "null"] },
          phishing_activities:              { type: ["boolean", "null"] },
          cybercrime:                       { type: ["boolean", "null"] },
          stealing_attack:                  { type: ["boolean", "null"] },
          money_laundering:                 { type: ["boolean", "null"] },
          darkweb_transactions:             { type: ["boolean", "null"] },
          blackmail_activities:             { type: ["boolean", "null"] },
          financial_crime:                  { type: ["boolean", "null"] },
          mixer:                            { type: ["boolean", "null"] },
          fake_kyc:                         { type: ["boolean", "null"] },
          blacklist_doubt:                  { type: ["boolean", "null"] },
          malicious_mining_activities:      { type: ["boolean", "null"] },
          gas_abuse:                        { type: ["boolean", "null"] },
          reinit:                           { type: ["boolean", "null"] },
          fake_token:                       { type: ["boolean", "null"] },
          fake_standard_interface:          { type: ["boolean", "null"] },
          honeypot_related_address:         { type: ["boolean", "null"] },
        },
      },
      malicious_contracts_created:  { type: ["integer", "null"] },
      data_sources:                 { type: "string" },
      ts:                           { type: "string" },
    },
  },

  async handler(query) {
    const rawChain = (query.chain || "ethereum").toLowerCase().trim();
    const chainId  = CHAIN_ALIASES[rawChain] || rawChain;
    const address  = (query.address || "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Invalid EVM address format — expected 0x followed by 40 hex chars");

    const url = `${GOPLUS_URL}/${encodeURIComponent(address)}?chain_id=${encodeURIComponent(chainId)}`;
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

    const d = body.result || {};
    const score = riskScore(d);

    return {
      address,
      chain_id:    chainId,
      risk_score:  score,
      risk_label:  riskLabel(score),
      is_contract: flag(d.contract_address),
      flags: {
        sanctioned:                  flag(d.sanctioned),
        phishing_activities:         flag(d.phishing_activities),
        cybercrime:                  flag(d.cybercrime),
        stealing_attack:             flag(d.stealing_attack),
        money_laundering:            flag(d.money_laundering),
        darkweb_transactions:        flag(d.darkweb_transactions),
        blackmail_activities:        flag(d.blackmail_activities),
        financial_crime:             flag(d.financial_crime),
        mixer:                       flag(d.mixer),
        fake_kyc:                    flag(d.fake_kyc),
        blacklist_doubt:             flag(d.blacklist_doubt),
        malicious_mining_activities: flag(d.malicious_mining_activities),
        gas_abuse:                   flag(d.gas_abuse),
        reinit:                      flag(d.reinit),
        fake_token:                  flag(d.fake_token),
        fake_standard_interface:     flag(d.fake_standard_interface),
        honeypot_related_address:    flag(d.honeypot_related_address),
      },
      malicious_contracts_created: parseInt(d.number_of_malicious_contracts_created || "0", 10),
      data_sources: d.data_source || "GoPlusLabs",
      ts: new Date().toISOString(),
    };
  },
};
