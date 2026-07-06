// model-research-brief.js
//
// AI/ML domain intelligence: HuggingFace model discovery + multi-source
// research synthesis in one call. Returns top HF models for a domain
// alongside a synthesized research brief from HN, OpenAlex, Reddit, and arXiv.
//
// Seam signal (cy_hb_3325, 2026-07-06): 11x co-call hf-model-search +
// research-synthesis (distinct organic payers); 13x cron-parser + hf-model-search.
// Serves pipeline builders who query both caps per session — one payment instead of two.
//
// Upstream: huggingface.co/api/models (free, no auth) + HN Algolia (free) +
//           OpenAlex (free) + Reddit JSON (free) + arXiv (free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.

const HF_API      = "https://huggingface.co/api/models";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; the-stall/4.89; +https://intuitek.ai)";
const SRC_TIMEOUT = 10_000;
const SYN_TIMEOUT = 25_000;

const VALID_TASKS = new Set([
  "text-classification", "token-classification", "question-answering",
  "translation", "summarization", "text-generation", "text2text-generation",
  "fill-mask", "zero-shot-classification", "feature-extraction",
  "sentence-similarity", "image-classification", "object-detection",
  "image-segmentation", "text-to-image", "image-to-text",
  "automatic-speech-recognition", "audio-classification", "text-to-speech",
  "tabular-classification", "tabular-regression", "reinforcement-learning",
]);

// ── HuggingFace model search ─────────────────────────────────────────────────

async function fetchHFModels(query, task, sort, limit) {
  const params = new URLSearchParams({
    search: query || "language model",
    sort:   sort || "downloads",
    limit:  String(limit || 8),
    full:   "false",
  });
  if (task && VALID_TASKS.has(task)) {
    params.set("pipeline_tag", task);
  }
  const url = `${HF_API}?${params}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(SRC_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HF API ${resp.status}`);
  const models = await resp.json();
  if (!Array.isArray(models)) throw new Error("unexpected HF API response");
  return models.map(m => ({
    id:           m.id || m.modelId || "",
    author:       m.author || (m.id ? m.id.split("/")[0] : null) || null,
    pipeline_tag: m.pipeline_tag || null,
    library:      m.library_name || null,
    downloads:    m.downloads    ?? null,
    likes:        m.likes        ?? null,
    last_modified:m.lastModified || m.last_modified || null,
    url:          `https://huggingface.co/${m.id || m.modelId || ""}`,
    tags:         Array.isArray(m.tags) ? m.tags.slice(0, 6) : [],
  }));
}

// ── research source fetchers ─────────────────────────────────────────────────

async function fetchHN(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const d = await r.json();
  return (d.hits || []).map(h => ({
    source:  "Hacker News",
    title:   h.title,
    url:     h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    snippet: h.story_text ? h.story_text.slice(0, 300) : null,
  }));
}

async function fetchOpenAlex(query) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=5&mailto=kyle@intuitek.ai&select=title,abstract_inverted_index,publication_year,cited_by_count,primary_location`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const d = await r.json();
  return (d.results || []).map(w => ({
    source:  "OpenAlex (Academic)",
    title:   w.title,
    year:    w.publication_year,
    cited:   w.cited_by_count,
    url:     w.primary_location?.landing_page_url || null,
    snippet: decodeInvIdx(w.abstract_inverted_index)?.slice(0, 300) || null,
  }));
}

function decodeInvIdx(inv) {
  if (!inv) return null;
  return Object.entries(inv)
    .flatMap(([w, ps]) => ps.map(p => ({ w, p })))
    .sort((a, b) => a.p - b.p)
    .map(x => x.w)
    .join(" ");
}

async function fetchReddit(query) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5&t=month`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`Reddit ${r.status}`);
  const d = await r.json();
  return ((d.data?.children) || []).map(c => c.data).map(p => ({
    source:    "Reddit",
    title:     p.title,
    url:       `https://reddit.com${p.permalink}`,
    subreddit: p.subreddit,
    score:     p.score,
    snippet:   p.selftext ? p.selftext.slice(0, 300) : null,
  }));
}

async function fetchArxiv(query) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=4&sortBy=relevance`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`arXiv ${r.status}`);
  const text = await r.text();
  const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map(m => {
    const e = m[1];
    const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, " ").trim();
    const s = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, " ").trim();
    const l = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim();
    if (!t) return null;
    return { source: "arXiv", title: t, url: l || null, snippet: s ? s.slice(0, 300) : null };
  }).filter(Boolean);
}

// ── GPT synthesis ─────────────────────────────────────────────────────────────

async function synthesize(domain, models, articles) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const modelSummary = models.slice(0, 6).map(m =>
    `• ${m.id} (${m.pipeline_tag || "?"}) — ${(m.downloads || 0).toLocaleString()} downloads, ${m.likes || 0} likes`
  ).join("\n");

  const articleSnippets = articles.slice(0, 8).map(a =>
    `[${a.source}] ${a.title}${a.snippet ? ": " + a.snippet.slice(0, 150) : ""}`
  ).join("\n");

  const prompt = `You are an AI/ML research analyst. Synthesize the following into a concise intelligence brief for the domain: "${domain}"

TOP HUGGINGFACE MODELS:
${modelSummary || "No models found."}

RECENT RESEARCH & COMMUNITY SIGNALS:
${articleSnippets || "No articles found."}

Return a JSON object:
{
  "landscape_summary": "2-3 sentence overview of the current state of ${domain} models and research",
  "top_model_recommendation": "Which HF model to start with and why (1-2 sentences)",
  "research_trends": ["trend1", "trend2", "trend3"],
  "use_case_fit": "Who this domain is best suited for and common deployment patterns",
  "maturity_assessment": "early_stage | growing | mature | consolidating"
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── export ───────────────────────────────────────────────────────────────────

export default {
  name: "model-research-brief",
  price: "$2.00",

  description:
    "AI/ML domain intelligence in one call: discover top HuggingFace models for a task or domain plus a synthesized research brief from HN, OpenAlex, Reddit, and arXiv. Returns model rankings, landscape summary, research trends, and a deployment recommendation.",

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "AI/ML domain or task to investigate (e.g. 'code generation', 'image segmentation', 'protein folding', 'multimodal reasoning').",
      },
      task_filter: {
        type: "string",
        description: "Optional HuggingFace pipeline task filter (e.g. 'text-generation', 'image-classification', 'token-classification').",
      },
      sort: {
        type: "string",
        enum: ["downloads", "likes", "lastModified"],
        description: "Model sort order. Default: downloads.",
      },
    },
    required: ["domain"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      domain:                   { type: "string" },
      task_filter:              { type: ["string", "null"] },
      top_models: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:           { type: "string" },
            author:       { type: ["string", "null"] },
            pipeline_tag: { type: ["string", "null"] },
            library:      { type: ["string", "null"] },
            downloads:    { type: ["integer", "null"] },
            likes:        { type: ["integer", "null"] },
            last_modified:{ type: ["string", "null"] },
            url:          { type: "string" },
            tags:         { type: "array", items: { type: "string" } },
          },
        },
      },
      model_count:              { type: "integer" },
      landscape_summary:        { type: "string" },
      top_model_recommendation: { type: "string" },
      research_trends:          { type: "array", items: { type: "string" } },
      use_case_fit:             { type: "string" },
      maturity_assessment:      { type: "string" },
      sources_queried:          { type: "integer" },
      sources_responded:        { type: "integer" },
      generated_at:             { type: "string" },
      error:                    { type: ["string", "null"] },
    },
  },

  async handler({ domain, task_filter, sort }) {
    if (!domain || typeof domain !== "string" || domain.trim().length === 0) {
      return { error: "domain is required — specify an AI/ML domain (e.g. 'code generation', 'image segmentation')" };
    }

    const d    = domain.trim().slice(0, 200);
    const task = (task_filter && VALID_TASKS.has(task_filter)) ? task_filter : null;

    // Parallel: HF models + research sources
    const [modelsResult, hnResult, oaResult, rdResult, axResult] = await Promise.allSettled([
      fetchHFModels(d, task, sort, 8),
      fetchHN(d + " machine learning"),
      fetchOpenAlex(d),
      fetchReddit(d + " AI model"),
      fetchArxiv(d),
    ]);

    const models = modelsResult.status === "fulfilled" ? modelsResult.value : [];

    const srcResults = [
      { name: "Hacker News",          res: hnResult },
      { name: "OpenAlex (Academic)",  res: oaResult },
      { name: "Reddit",               res: rdResult },
      { name: "arXiv",                res: axResult },
    ];

    const articles = srcResults
      .filter(s => s.res.status === "fulfilled")
      .flatMap(s => s.res.value);

    const sourcesQueried   = srcResults.length;
    const sourcesResponded = srcResults.filter(s => s.res.status === "fulfilled").length;

    if (models.length === 0 && articles.length === 0) {
      return {
        error: "no_data",
        message: "HuggingFace model search and all research sources failed. Try a broader domain query.",
        domain: d,
        generated_at: new Date().toISOString(),
      };
    }

    let synthesis = {};
    try {
      synthesis = await synthesize(d, models, articles);
    } catch (err) {
      synthesis = {
        landscape_summary:        `${models.length} models found on HuggingFace for ${d}. Research synthesis unavailable.`,
        top_model_recommendation: models[0] ? `Start with ${models[0].id} (${(models[0].downloads || 0).toLocaleString()} downloads).` : "No model data available.",
        research_trends:          [],
        use_case_fit:             "Synthesis unavailable.",
        maturity_assessment:      "unknown",
      };
    }

    return {
      domain:                   d,
      task_filter:              task || null,
      top_models:               models,
      model_count:              models.length,
      landscape_summary:        synthesis.landscape_summary        || "",
      top_model_recommendation: synthesis.top_model_recommendation || "",
      research_trends:          synthesis.research_trends          || [],
      use_case_fit:             synthesis.use_case_fit             || "",
      maturity_assessment:      synthesis.maturity_assessment      || "unknown",
      sources_queried:          sourcesQueried,
      sources_responded:        sourcesResponded,
      generated_at:             new Date().toISOString(),
      error:                    null,
    };
  },
};
