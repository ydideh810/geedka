// arxiv-intel.js
//
// arXiv preprint search via the free arXiv API (no auth, no key).
// Returns titles, authors, abstracts, arXiv IDs, categories, and PDF links.
//
// arXiv is the canonical source for AI/ML, CS, physics, math, and quantitative
// biology preprints — typically 2–12 months ahead of peer-reviewed publication.
//
// Free upstream: export.arxiv.org/api/query (open data, no key).
// Useful for: AI research agents, literature scouts, paper trackers,
// grant-writing support, competitive intelligence on emerging techniques.

const BASE    = "https://export.arxiv.org/api/query";
const UA      = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";
const TIMEOUT = 15_000;

// arXiv field prefixes for structured search
const FIELD_MAP = {
  title:    "ti",
  abstract: "abs",
  author:   "au",
  all:      "all",
};

// Parse arXiv Atom XML without external dependencies
function parseAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    entries.push(block);
  }
  return entries.map(parseEntry).filter(Boolean);
}

function text(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m  = re.exec(block);
  return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : null;
}

function attr(block, tag, attrName) {
  const re = new RegExp(`<${tag}[^>]*${attrName}="([^"]*)"`, "i");
  const m  = re.exec(block);
  return m ? m[1] : null;
}

function parseEntry(block) {
  // arxiv ID is the last segment of the <id> URL
  const rawId  = text(block, "id") ?? "";
  const arxivId = rawId.replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "").trim();

  // Authors
  const authorRe  = /<author>([\s\S]*?)<\/author>/g;
  const authors   = [];
  let am;
  while ((am = authorRe.exec(block)) !== null) {
    const name = text(am[1], "name");
    if (name) authors.push(name);
  }

  // PDF link — arxiv link with type="application/pdf"
  const linkRe  = /<link[^>]*type="application\/pdf"[^>]*href="([^"]*)"/i;
  const pdfM    = linkRe.exec(block);
  const pdfUrl  = pdfM ? pdfM[1] : (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null);

  // Categories
  const catRe = /<category[^>]*term="([^"]*)"/g;
  const cats  = [];
  let cm;
  while ((cm = catRe.exec(block)) !== null) cats.push(cm[1]);

  const abstract = text(block, "summary") ?? null;
  const published = text(block, "published") ?? null;
  const updated   = text(block, "updated") ?? null;
  const title     = text(block, "title") ?? null;

  if (!arxivId || !title) return null;

  return {
    arxiv_id:   arxivId,
    title:      title.replace(/\n/g, " "),
    authors:    authors.slice(0, 6),
    abstract:   abstract ? abstract.replace(/\n/g, " ").slice(0, 600) : null,
    categories: cats.slice(0, 5),
    primary_category: cats[0] ?? null,
    published:  published ? published.slice(0, 10) : null,
    updated:    updated   ? updated.slice(0, 10)   : null,
    arxiv_url:  arxivId ? `https://arxiv.org/abs/${arxivId}` : null,
    pdf_url:    pdfUrl,
  };
}

function buildQuery(input) {
  const field = FIELD_MAP[input.field ?? "all"] ?? "all";
  const base  = `${field}:${encodeURIComponent(input.query)}`;

  const filters = [];
  if (input.category) {
    filters.push(`cat:${encodeURIComponent(input.category)}`);
  }
  return filters.length ? `${base}+AND+${filters.join("+AND+")}` : base;
}

export default {
  name:  "arxiv-intel",
  price: "$0.010",

  description:
    "Search arXiv preprints by query, filtered by field (title/abstract/author/all) and category. Returns title, authors (up to 6), abstract (first 600 chars), arXiv ID, PDF link, publish date, and subject categories. arXiv is the canonical source for AI/ML, CS, physics, math, and quantitative biology preprints — typically months ahead of peer-reviewed journals. Useful for AI research agents, literature scouts, competitive technique tracking, and grant-writing support. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search terms (e.g. 'diffusion models image generation', 'transformer attention mechanism', 'graph neural networks'). Natural language or keywords.",
      },
      field: {
        type: "string",
        enum: ["all", "title", "abstract", "author"],
        default: "all",
        description: "Which field to search. 'all' searches title+abstract+authors. Default: all.",
      },
      category: {
        type: "string",
        description: "arXiv category filter (e.g. 'cs.AI', 'cs.LG', 'stat.ML', 'quant-ph', 'math.CO'). Optional.",
      },
      sort: {
        type: "string",
        enum: ["relevance", "lastUpdatedDate", "submittedDate"],
        default: "relevance",
        description: "Sort order. relevance = arXiv relevance score; lastUpdatedDate = most recently updated; submittedDate = newest submissions first. Default: relevance.",
      },
      limit: {
        type: "integer",
        default: 5,
        minimum: 1,
        maximum: 10,
        description: "Number of papers to return (1–10). Default: 5.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:        { type: "string" },
      total_results: { type: "integer" },
      papers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            arxiv_id:         { type: "string" },
            title:            { type: "string" },
            authors:          { type: "array", items: { type: "string" } },
            abstract:         { type: "string" },
            categories:       { type: "array", items: { type: "string" } },
            primary_category: { type: "string" },
            published:        { type: "string" },
            updated:          { type: "string" },
            arxiv_url:        { type: "string" },
            pdf_url:          { type: "string" },
          },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    if (!input.query) input.query = "AI agents 2024";
    const query    = String(input.query ?? "").trim();
    const sortBy   = input.sort ?? "relevance";
    const maxResults = Math.min(10, Math.max(1, parseInt(input.limit ?? 5)));

    const searchQuery = buildQuery(input);

    const params = new URLSearchParams({
      search_query: searchQuery,
      start:        "0",
      max_results:  String(maxResults),
      sortBy,
      sortOrder: "descending",
    });

    const url  = `${BASE}?${params}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/atom+xml" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`arXiv API HTTP ${resp.status}`);

    const xml = await resp.text();

    // Extract total results count
    const totalM = /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i.exec(xml);
    const totalResults = totalM ? parseInt(totalM[1]) : 0;

    const papers = parseAtom(xml);

    return {
      query,
      total_results: totalResults,
      papers,
      generated_at: new Date().toISOString(),
    };
  },
};
