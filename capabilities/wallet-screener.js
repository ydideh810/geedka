// wallet-screener.js
//
// Wallet address risk screening: phishing, sanctions, cybercrime, mixer,
// darkweb transactions, and 15+ other risk flags across EVM chains.
// Sourced from GoPlusLabs public API (free, no key required).
//
// Seam origin: defi.hugen.tokyo/defi/address observed with 41 organic payers
// ($0.011/call, signal-intel archive 2026-06-05). Distinct from evm-token-security
// (which screens TOKEN contracts) — this screens WALLET ADDRESSES.

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1/address_security";
const UA         = "Mozilla/5.0 (compatible; myriad/1.7; +https://synaptiic.org)";
const TIMEOUT_MS = 10000;

const RISK_FLAGS = [
  "cybercrime", "money_laundering", "phishing_activities", "stealing_attack",
  "blackmail_activities", "sanctioned", "malicious_mining_activities", "mixer",
  "fake_token", "honeypot_related_address", "darkweb_transactions", "gas_abuse",
  "financial_crime", "reinit", "fake_kyc", "fake_standard_interface",
  "blacklist_doubt", "number_of_malicious_contracts_created",
];

// Flag severity weights for composite score
const WEIGHTS = {
  sanctioned:                          100,
  phishing_activities:                  80,
  stealing_attack:                      75,
  cybercrime:                           70,
  darkweb_transactions:                 65,
  blackmail_activities:                 60,
  money_laundering:                     55,
  mixer:                                50,
  fake_token:                           45,
  honeypot_related_address:             40,
  financial_crime:                      40,
  malicious_mining_activities:          35,
  gas_abuse:                            20,
  fake_kyc:                             20,
  reinit:                               15,
  fake_standard_interface:              15,
  blacklist_doubt:                      10,
  number_of_malicious_contracts_created: 30,
};

function riskLabel(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  if (score >= 5)  return "LOW";
  return "CLEAN";
}

export default {
  name:  "wallet-screener",
  price: "$0.136",

  description:
    "Risk screening for EVM wallet addresses. Returns a 0–100 risk score and individual flags: sanctions (OFAC/other), phishing activity, cybercrime, money laundering, darkweb transactions, mixer usage, stolen funds, fake KYC, and 12 more categories. Sourced from GoPlusLabs (free, no key, chain_id optional — defaults to checking cross-chain). Use before sending funds to an unknown address, before accepting a payment, or when validating a counterparty wallet in a DeFi workflow. Distinct from evm-token-security (which screens TOKEN contracts — this screens WALLETS).",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      address: {
        type: "string",
        description: "Wallet address to screen (EVM hex address, e.g. '0x1234...'). Does not need to be a contract — any wallet address.",
      },
      chain_id: {
        type: "string",
        description: "Chain ID for context (optional, numeric or chain name). If omitted, GoPlus checks cross-chain records.",
        default: "1",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:       { type: "string" },
      risk_score:    { type: "integer", description: "0 (clean) to 100 (critical). Composite of weighted flag scores." },
      risk_label:    { type: "string",  description: "CLEAN | LOW | MEDIUM | HIGH | CRITICAL" },
      active_flags:  {
        type: "array",
        description: "List of risk flags that are active (value=1) for this address.",
        items: { type: "string" },
      },
      all_flags: {
        type: "object",
        description: "Full flag map. true = risk detected, false = clean for that category.",
      },
      is_contract:   { type: "boolean", description: "Whether this address is a contract (contract_address flag)." },
      data_source:   { type: ["string", "null"] },
      ts:            { type: "string" },
    },
  },

  async handler(query) {
    const address  = (query.address || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").trim();
    const chainId  = (query.chain_id || "1").toString().trim();

    if (!address) throw new Error("address is required");

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

    // Compute score and active flags
    let score = 0;
    const activeFlags = [];
    const allFlags    = {};

    for (const flag of RISK_FLAGS) {
      const val = d[flag];
      const isActive = val && val !== "0" && val !== "";
      allFlags[flag] = isActive ? true : false;
      if (isActive) {
        activeFlags.push(flag);
        score += WEIGHTS[flag] || 10;
      }
    }
    score = Math.min(score, 100);

    // Special: number_of_malicious_contracts_created is numeric
    const malCount = parseInt(d.number_of_malicious_contracts_created || "0", 10);
    if (malCount > 0 && !allFlags.number_of_malicious_contracts_created) {
      allFlags.number_of_malicious_contracts_created = true;
      activeFlags.push("number_of_malicious_contracts_created");
      score = Math.min(score + (WEIGHTS.number_of_malicious_contracts_created * Math.min(malCount, 3)), 100);
    }

    return {
      address,
      risk_score:   score,
      risk_label:   riskLabel(score),
      active_flags: activeFlags,
      all_flags:    allFlags,
      is_contract:  d.contract_address === "1",
      data_source:  d.data_source || null,
      ts: new Date().toISOString(),
    };
  },
};
