// solana-tx-explainer.js
//
// Decodes and explains a Solana transaction in one call.
// signal-intel signal: api.oatp.cc/tools/tx_explainer — 25 calls, 6 distinct
// payer wallets, $0.10/call (100,000 USDC micro-units), 30-day window ending
// 2026-06-01. Gap: their cap covers Solana; MYRIAD tx-explainer covers EVM only.
// Priced at $0.07 (70% of OATP's $0.10 per signal-intel pricing doctrine).
//
// Free upstream: api.mainnet-beta.solana.com (public, no API key).
// SOL/USD: price.jup.ag/v6/price (public, no API key).

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const SOL_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const LAMPORTS_PER_SOL = 1_000_000_000;

const KNOWN_PROGRAMS = {
  "11111111111111111111111111111111":            "System Program",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bKo": "Associated Token Account",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Account",
  "ComputeBudget111111111111111111111111111111":  "ComputeBudget",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA": "PumpSwap AMM",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ": "PumpSwap Fee",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB":  "Jupiter v4",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": "Orca Whirlpool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
  "RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr":  "Raydium v4",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P":  "Pump.fun",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s":  "Metaplex Metadata",
  "cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ":  "Candy Machine",
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY":  "Phoenix DEX",
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX":  "Serum DEX",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr":  "Memo",
  "Vote111111111111111111111111111111111111111":   "Vote Program",
  "Stake11111111111111111111111111111111111111":   "Stake Program",
};

async function rpc(method, params) {
  const resp = await fetch(SOLANA_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Solana RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC error ${d.error.code}: ${d.error.message}`);
  return d.result;
}

async function solPrice() {
  try {
    const resp = await fetch(SOL_PRICE_URL, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return null;
    const d = await resp.json();
    return d?.solana?.usd ?? null;
  } catch {
    return null;
  }
}

function shortAddr(addr) {
  if (!addr || addr.length < 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function resolveProgramName(programId) {
  if (!programId) return "Unknown";
  if (KNOWN_PROGRAMS[programId]) return KNOWN_PROGRAMS[programId];
  // Some programs use short names in parsed responses
  return shortAddr(programId);
}

function extractTokenChanges(pre, post) {
  const changes = [];
  const postMap = {};
  for (const p of (post || [])) {
    const key = `${p.accountIndex}:${p.mint}`;
    postMap[key] = p;
  }
  for (const p of (pre || [])) {
    const key = `${p.accountIndex}:${p.mint}`;
    const postEntry = postMap[key];
    if (!postEntry) continue;
    const preAmt  = p.uiTokenAmount?.uiAmount ?? 0;
    const postAmt = postEntry.uiTokenAmount?.uiAmount ?? 0;
    const delta   = postAmt - preAmt;
    if (Math.abs(delta) < 1e-9) continue;
    changes.push({
      mint:    p.mint,
      account: p.accountIndex,
      delta:   parseFloat(delta.toFixed(9)),
    });
  }
  return changes;
}

const PROGRAM_PRIORITY = [
  "Jupiter", "Raydium", "Orca", "Phoenix", "Serum", "Pump.fun", "PumpSwap",
  "SPL Token", "Token-2022", "System Program", "Stake Program",
  "Associated Token Account", "Metaplex", "Candy Machine", "Vote Program",
];

function buildSummary(signerShort, programs, tokenChanges, status, feeSol) {
  // Prefer high-priority named programs over short address fallbacks
  const ranked = [...programs].sort((a, b) => {
    const ai = PROGRAM_PRIORITY.findIndex(p => a.includes(p.split(" ")[0]));
    const bi = PROGRAM_PRIORITY.findIndex(p => b.includes(p.split(" ")[0]));
    const aRank = ai === -1 ? 999 : ai;
    const bRank = bi === -1 ? 999 : bi;
    return aRank - bRank;
  });
  const meaningful = ranked.filter(p => p !== "ComputeBudget" && p !== "Memo");
  const mainProg = meaningful[0] || programs[0] || "Unknown";

  let action = "transaction";
  if (mainProg.includes("Jupiter") || mainProg.includes("Raydium") ||
      mainProg.includes("Orca") || mainProg.includes("Phoenix") ||
      mainProg.includes("Serum")) {
    action = "swap";
  } else if (mainProg.includes("System")) {
    action = "SOL transfer";
  } else if (mainProg.includes("SPL Token") || mainProg.includes("Token-2022")) {
    action = "token transfer";
  } else if (mainProg.includes("Pump.fun") || mainProg.includes("PumpSwap")) {
    action = "PumpSwap trade";
  } else if (mainProg.includes("Associated Token")) {
    action = "token account creation";
  } else if (mainProg.includes("Stake")) {
    action = "stake operation";
  } else if (mainProg.includes("Vote")) {
    action = "vote";
  }

  const tc = tokenChanges.length;
  const suffix = tc > 0 ? ` (${tc} token balance change${tc > 1 ? "s" : ""})` : "";
  const statusStr = status === "success" ? "" : ` [${status}]`;
  return `${action} by ${signerShort} via ${mainProg}${suffix}${statusStr} — fee ${feeSol.toFixed(6)} SOL`;
}

export default {
  name:  "solana-tx-explainer",
  price: "$0.07",

  description:
    "Given a Solana transaction signature, returns a decoded breakdown: fee payer, programs invoked (Jupiter, Raydium, Pump.fun, SPL Token, etc.), SPL token balance changes with deltas, transaction fee in SOL and USD, block time, and a one-sentence human-readable summary. Uses public Solana mainnet RPC — no API key required. $0.07/call.",

  inputSchema: {
    type: "object",
    properties: {
      signature: {
        type:        "string",
        description: "Solana transaction signature (base58, 87–88 characters).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      signature:      { type: "string",          description: "Transaction signature queried." },
      status:         { type: "string", enum: ["success","failed"], description: "Transaction execution status." },
      block_slot:     { type: ["integer","null"], description: "Slot number containing this transaction." },
      block_time:     { type: ["string","null"],  description: "ISO-8601 timestamp of the block." },
      fee_payer:      { type: "string",           description: "Address that paid the transaction fee." },
      fee_sol:        { type: "number",           description: "Transaction fee in SOL." },
      fee_usd:        { type: ["number","null"],  description: "Transaction fee in USD (null if SOL price unavailable)." },
      programs:       { type: "array", items: { type: "string" }, description: "Unique programs invoked (outer + inner instructions), resolved to human-readable names." },
      token_changes:  { type: "array", items: { type: "object", properties: {
        mint:    { type: "string", description: "SPL token mint address." },
        account: { type: "integer", description: "Account index in the transaction." },
        delta:   { type: "number",  description: "Token amount change (positive = received, negative = sent)." },
      }}, description: "SPL token balance changes for all affected token accounts." },
      summary:        { type: "string", description: "One-sentence human-readable explanation of what this transaction did." },
      queried_at:     { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const sig = (query.signature || "").trim();
    if (!sig) return { error: "no_signature", note: "Provide a Solana transaction signature to analyze.", demo: true };
    if (sig.length < 80 || sig.length > 90) {
      throw new Error("signature must be 87–88 base58 characters");
    }

    const [txResult, solUsd] = await Promise.all([
      rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]),
      solPrice(),
    ]);

    if (txResult === null) {
      throw new Error("Transaction not found — signature may be invalid, not yet finalized, or older than the RPC history window (~2–3 days)");
    }

    const meta    = txResult.meta    || {};
    const tx      = txResult.transaction || {};
    const msg     = tx.message        || {};
    const keys    = msg.accountKeys   || [];

    const status    = meta.err ? "failed" : "success";
    const feeLamports = meta.fee ?? 0;
    const feeSol    = feeLamports / LAMPORTS_PER_SOL;
    const feeUsd    = solUsd != null ? parseFloat((feeSol * solUsd).toFixed(6)) : null;
    const slot      = txResult.slot ?? null;
    const blockTime = txResult.blockTime ? new Date(txResult.blockTime * 1000).toISOString() : null;

    // Fee payer is always accountKeys[0] for legacy + versioned transactions
    const feePayer  = (keys[0]?.pubkey) || (keys[0]) || "unknown";

    // Collect all program IDs (outer instructions)
    const programSet = new Set();
    for (const inst of (msg.instructions || [])) {
      const pid = inst.programId || inst.program;
      if (pid) programSet.add(pid);
    }
    // Inner / CPI instructions
    for (const inner of (meta.innerInstructions || [])) {
      for (const inst of (inner.instructions || [])) {
        const pid = inst.programId || inst.program;
        if (pid) programSet.add(pid);
      }
    }
    const programs = [...programSet].map(resolveProgramName).filter(Boolean);
    // Deduplicate resolved names
    const uniquePrograms = [...new Set(programs)];

    const tokenChanges = extractTokenChanges(
      meta.preTokenBalances,
      meta.postTokenBalances
    );

    const summary = buildSummary(
      shortAddr(feePayer),
      uniquePrograms,
      tokenChanges,
      status,
      feeSol
    );

    return {
      signature:     sig,
      status,
      block_slot:    slot,
      block_time:    blockTime,
      fee_payer:     feePayer,
      fee_sol:       parseFloat(feeSol.toFixed(9)),
      fee_usd:       feeUsd,
      programs:      uniquePrograms,
      token_changes: tokenChanges,
      summary,
      queried_at:    new Date().toISOString(),
    };
  },
};
