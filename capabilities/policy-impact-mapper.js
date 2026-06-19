// policy-impact-mapper.js
//
// Analyzes regulatory and policy text to map impact across sectors and entities.
// Extracts compliance requirements, affected parties, effective dates, and
// assigns sector-level impact scores. Pure NLP/pattern analysis — no LLM.
//
// Seam: orbisapi.com/proxy/policy-change-impact-mapper-api — 2,158 sett/wk, 10 payers, $0.005/call

const SECTOR_KEYWORDS = {
  finance:       ["bank", "credit", "loan", "investment", "securities", "fintech", "payment", "insurance", "mortgage", "fund", "capital", "trading", "financial institution"],
  healthcare:    ["hospital", "physician", "medical", "patient", "drug", "pharmaceutical", "medicare", "medicaid", "health plan", "clinical", "provider", "healthcare"],
  technology:    ["software", "algorithm", "ai ", "artificial intelligence", "data", "cybersecurity", "cloud", "platform", "digital", "internet", "encryption", "privacy"],
  energy:        ["oil", "gas", "electricity", "utility", "renewable", "emissions", "carbon", "power plant", "grid", "fossil fuel", "solar", "wind energy"],
  real_estate:   ["property", "landlord", "tenant", "housing", "mortgage", "rent", "real estate", "zoning", "construction", "building"],
  transportation:["vehicle", "transport", "airline", "railroad", "shipping", "truck", "aviation", "autonomous vehicle", "maritime"],
  agriculture:   ["farm", "food", "agriculture", "crop", "pesticide", "organic", "livestock", "usda", "fda food", "gmo"],
  labor:         ["worker", "employee", "employer", "wage", "union", "overtime", "workplace", "labor", "hiring", "discrimination", "osha"],
  environment:   ["environmental", "pollution", "epa", "waste", "clean air", "clean water", "habitat", "endangered", "recycling"],
  education:     ["school", "student", "university", "teacher", "education", "curriculum", "grant", "loan forgiveness"],
  retail:        ["consumer", "retail", "ecommerce", "product", "supply chain", "manufacturer", "advertising", "warranty"],
  crypto:        ["cryptocurrency", "blockchain", "token", "stablecoin", "defi", "nft", "digital asset", "virtual currency", "exchange"],
};

const COMPLIANCE_SIGNALS = [
  /must\s+(comply|implement|establish|maintain|report|disclose|file|register)/i,
  /required?\s+to\s+(comply|implement|establish|maintain)/i,
  /shall\s+(ensure|maintain|provide|submit|notify)/i,
  /\bprohibited?\b/i,
  /penalty\s+of/i,
  /\bfine\b|\bsanction\b/i,
  /effective\s+(date|immediately|upon)/i,
  /by\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i,
  /within\s+\d+\s+(days?|months?|years?)/i,
];

const DATE_PATTERNS = [
  /effective\s+(?:as\s+of\s+|date\s+of\s+)?([A-Z][a-z]+ \d{1,2},? \d{4})/gi,
  /by\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/gi,
  /no\s+later\s+than\s+([A-Z][a-z]+ \d{1,2},? \d{4})/gi,
  /(\d{1,2}\/\d{1,2}\/\d{4})/g,
];

const CHANGE_TYPES = {
  new_requirement: /\bnew\s+(requirement|rule|standard|obligation|mandate)\b/i,
  prohibition:     /\bprohibit|forbid|ban\b/i,
  exemption:       /\bexempt|exception\s+for|waiver\b/i,
  reporting:       /\bmust\s+report|required\s+reporting|disclosure\s+requirement\b/i,
  registration:    /\bmust\s+register|registration\s+required\b/i,
  amendment:       /\bamend|modif(y|ies|ication)\b/i,
  repeal:          /\brepeal|rescind|revoke\b/i,
};

function extractDates(text) {
  const found = new Set();
  for (const p of DATE_PATTERNS) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(text)) !== null) {
      if (m[1]) found.add(m[1].trim());
    }
  }
  return [...found].slice(0, 10);
}

function scoreSectors(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      // Count occurrences
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = lower.match(re);
      if (matches) hits += matches.length;
    }
    if (hits > 0) scores[sector] = hits;
  }

  // Rank and normalize
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [];

  const max = sorted[0][1];
  return sorted.slice(0, 8).map(([sector, hits]) => ({
    sector,
    impact_level: hits / max >= 0.7 ? "HIGH" : hits / max >= 0.3 ? "MEDIUM" : "LOW",
    mention_count: hits,
  }));
}

function detectChangeTypes(text) {
  const found = [];
  for (const [type, pattern] of Object.entries(CHANGE_TYPES)) {
    if (pattern.test(text)) found.push(type);
  }
  return found;
}

function extractComplianceItems(text) {
  const sentences = text.split(/[.!?]\s+/);
  return sentences
    .filter(s => COMPLIANCE_SIGNALS.some(p => p.test(s)))
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length > 20 && s.length < 300)
    .slice(0, 10);
}

function extractEntities(text) {
  const entities = new Set();

  // Capitalized proper nouns that appear 2+ times (rough NER)
  const words = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || [];
  const counts = {};
  for (const w of words) {
    counts[w] = (counts[w] || 0) + 1;
  }

  // Agency names
  const agencies = text.match(/\b(?:the\s+)?([A-Z]{2,}\s*(?:[A-Z]{2,}\s*)*)(?:\s+Act|\s+Agency|\s+Commission|\s+Bureau|\s+Department|\s+Office)?\b/g) || [];
  agencies.forEach(a => { if (a.length > 3) entities.add(a.trim()); });

  // Threshold: mentioned 3+ times and looks like an entity
  for (const [w, c] of Object.entries(counts)) {
    if (c >= 3 && w.split(" ").length <= 4 && !/^(The|This|That|These|Those|Such|Which|Where|When|How|All|Any|Each|Both)$/.test(w)) {
      entities.add(w);
    }
  }

  return [...entities].slice(0, 15);
}

export default {
  name: "policy-impact-mapper",
  price: "$0.007",

  description:
    "Analyzes regulatory and policy text to map its impact across industry sectors. Extracts compliance requirements, change types (new mandates, prohibitions, exemptions), effective dates, affected entities, and assigns sector-level impact scores (HIGH/MEDIUM/LOW). Pure pattern analysis — no LLM, instant results. Useful for compliance agents, regulatory monitoring workflows, and policy change digests.",

  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Policy, regulation, or legislative text to analyze. Can be a full document, a section, or a press release summarizing a policy change. Max 100,000 chars.",
      },
      title: {
        type: "string",
        description: "Optional title or name of the policy/regulation (e.g. 'EU AI Act Article 13').",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      title:              { type: "string" },
      word_count:         { type: "integer" },
      change_types:       { type: "array",  description: "Detected policy change categories." },
      affected_sectors:   { type: "array",  description: "Sectors with impact levels (HIGH/MEDIUM/LOW)." },
      effective_dates:    { type: "array",  description: "Extracted compliance deadlines and effective dates." },
      compliance_items:   { type: "array",  description: "Key sentences containing compliance obligations." },
      key_entities:       { type: "array",  description: "Agencies, organizations, and entities mentioned." },
      overall_impact:     { type: "string", description: "'HIGH' | 'MEDIUM' | 'LOW' — based on sector spread and compliance density." },
      generated_at:       { type: "string" },
    },
  },

  async handler(query) {
    if (!query.text?.trim()) query.text = "The Federal Reserve raised interest rates by 25 basis points to combat inflation, affecting borrowing costs for consumers and businesses nationwide.";
    if (query.text.length > 100000) throw new Error("text too large (max 100,000 chars)");

    const text = query.text;
    const words = text.split(/\s+/).length;

    const affectedSectors  = scoreSectors(text);
    const changeTypes      = detectChangeTypes(text);
    const effectiveDates   = extractDates(text);
    const complianceItems  = extractComplianceItems(text);
    const keyEntities      = extractEntities(text);

    // Overall impact: HIGH if 3+ HIGH-impact sectors or dense compliance items
    const highSectors = affectedSectors.filter(s => s.impact_level === "HIGH").length;
    const overallImpact = highSectors >= 3 || complianceItems.length >= 5 ? "HIGH"
                        : highSectors >= 1 || complianceItems.length >= 2 ? "MEDIUM"
                        : "LOW";

    return {
      title:            query.title || null,
      word_count:       words,
      change_types:     changeTypes,
      affected_sectors: affectedSectors,
      effective_dates:  effectiveDates,
      compliance_items: complianceItems,
      key_entities:     keyEntities,
      overall_impact:   overallImpact,
      generated_at:     new Date().toISOString(),
    };
  },
};
