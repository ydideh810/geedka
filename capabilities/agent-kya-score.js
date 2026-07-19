// agent-kya-score.js
//
// Know Your Agent (KYA) trust score for any EVM wallet address.
// Returns AsterPay's official 0-100 trust score, tier, sanctions status,
// spending limits, score breakdown, and on-chain attestations.
//
// Seam: x402.asterpay.io/v2/x402/agent/trust-score ($0.005) — 40% undercut.
// Free upstream: AsterPay KYA API v1 (unauthenticated, 300s TTL cache).
// Priced at $0.003/call.
//
// Score dimensions: wallet age, activity, sanctions clean, ERC-8004 identity,
// operator KYB, tx history, trust bond, endpoint quality, endpoint signals.
// Attestation covers: Coinbase KYC, Coinbase country, Gitcoin Passport, USDC balance.
//
// [REDACTED]3, growth hook — Data category, 2026-06-07.

const ASTERPAY_BASE = "https://x402.asterpay.io";
const TIMEOUT = 12_000;
const UA = "Mozilla/5.0 (compatible; myriad/1.0; +https://synaptiic.org)";

async function kyaFetch(address) {
  const url = `${ASTERPAY_BASE}/v1/agent/trust-score/${encodeURIComponent(address)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`AsterPay KYA HTTP ${resp.status} for ${address}`);
  const body = await resp.json();
  if (!body.success) throw new Error(`AsterPay KYA error: ${JSON.stringify(body)}`);
  return body.data;
}

export default {
  name: "agent-kya-score",
  price: "$0.136",

  description:
    "Know Your Agent (KYA) trust score for any EVM wallet. Returns a 0–100 score, tier (trusted/verified/unknown), sanctions screening result, per-dimension score breakdown (wallet age, activity, sanctions, ERC-8004 identity, KYB, tx history, trust bond, endpoint quality), on-chain attestations (Coinbase KYC, Gitcoin Passport, USDC balance), wallet stats (balance, tx count, estimated age), and per-transaction spending limits. Use before accepting payment from an agent or before dispatching a sub-agent with funds. Answers: is this agent wallet sanctioned? how established is it? has it passed KYC?",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      address: {
        type: "string",
        description:
          "EVM wallet address to score (0x-prefixed, 42 chars). Works on any EVM chain — score is chain-agnostic.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      address:     { type: "string" },
      trust_score: { type: "integer", minimum: 0, maximum: 100 },
      tier:        { type: "string", description: "trusted | verified | unknown | suspended" },
      sanctioned:  { type: "boolean" },
      blacklisted: { type: "boolean" },
      allowed:     { type: "boolean", description: "Whether AsterPay would allow transactions from this wallet" },
      limits: {
        type: "object",
        properties: {
          max_per_tx_usd:  { type: "number" },
          max_daily_usd:   { type: "number" },
        },
      },
      breakdown: {
        type: "object",
        properties: {
          wallet_age:         { type: "integer" },
          wallet_activity:    { type: "integer" },
          sanctions_clean:    { type: "integer" },
          erc8004_identity:   { type: "integer" },
          operator_kyb:       { type: "integer" },
          tx_history:         { type: "integer" },
          trust_bond:         { type: "integer" },
          endpoint_quality:   { type: "integer" },
          endpoint_signals:   { type: "integer" },
        },
      },
      wallet: {
        type: "object",
        properties: {
          native_balance_eth: { type: "number" },
          usdc_balance:       { type: "number" },
          tx_count:           { type: "integer" },
          estimated_age_days: { type: "integer" },
          has_activity:       { type: "boolean" },
        },
      },
      identity: {
        type: "object",
        properties: {
          erc8004_registered: { type: "boolean" },
          agent_id:           { type: "string", nullable: true },
          owner:              { type: "string", nullable: true },
        },
      },
      attestations: {
        type: "object",
        properties: {
          coinbase_kyc:      { type: "boolean" },
          coinbase_country:  { type: "boolean" },
          gitcoin_passport:  { type: "boolean" },
          usdc_balance_100:  { type: "boolean" },
        },
      },
      flags:        { type: "array", items: { type: "string" } },
      score_cached: { type: "boolean" },
      ttl_seconds:  { type: "integer" },
      checked_at:   { type: "string" },
    },
  },

  async handler(query) {
    const raw = (query.address || "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw))
      throw new Error("address must be a 42-character 0x EVM address");

    const d = await kyaFetch(raw.toLowerCase());

    const ins = d.insumerAttestation ?? {};
    const breakdown = d.breakdown ?? {};

    return {
      address:     d.address,
      trust_score: d.trustScore ?? 0,
      tier:        d.tier ?? "unknown",
      sanctioned:  d.screening?.sanctioned ?? false,
      blacklisted: d.screening?.blacklisted ?? false,
      allowed:     d.screening?.allowed ?? false,
      limits: {
        max_per_tx_usd:  d.maxPerTx ?? null,
        max_daily_usd:   d.maxDaily ?? null,
      },
      breakdown: {
        wallet_age:        breakdown.walletAge ?? 0,
        wallet_activity:   breakdown.walletActivity ?? 0,
        sanctions_clean:   breakdown.sanctionsClean ?? 0,
        erc8004_identity:  breakdown.erc8004Identity ?? 0,
        operator_kyb:      breakdown.operatorKyb ?? 0,
        tx_history:        breakdown.transactionHistory ?? 0,
        trust_bond:        breakdown.trustBond ?? 0,
        endpoint_quality:  breakdown.endpointQuality ?? 0,
        endpoint_signals:  breakdown.endpointSignals ?? 0,
      },
      wallet: {
        native_balance_eth: d.wallet?.nativeBalance ?? 0,
        usdc_balance:       d.wallet?.usdcBalance ?? 0,
        tx_count:           d.wallet?.txCount ?? 0,
        estimated_age_days: d.wallet?.estimatedAgeDays ?? 0,
        has_activity:       d.wallet?.hasActivity ?? false,
      },
      identity: {
        erc8004_registered: d.identity?.registered ?? false,
        agent_id:           d.identity?.agentId ?? null,
        owner:              d.identity?.owner ?? null,
      },
      attestations: {
        coinbase_kyc:     ins.coinbaseKyc?.pass ?? false,
        coinbase_country: ins.coinbaseCountry?.pass ?? false,
        gitcoin_passport: ins.gitcoinPassport?.pass ?? false,
        usdc_balance_100: ins.tokenBalance?.pass ?? false,
      },
      flags:        d.flags ?? [],
      score_cached: false,
      ttl_seconds:  d.ttlSeconds ?? 300,
      checked_at:   d.checkedAt ?? new Date().toISOString(),
    };
  },
};
