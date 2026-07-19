// fact-check.js
//
// AI-powered claim verification against multiple independent public sources.
// Searches DuckDuckGo, Wikipedia, HN Algolia, and arXiv in parallel, then
// uses GPT-4o-mini to assess the claim against gathered evidence and return
// a structured verdict.
//
// Seam: agents building verification pipelines currently chain web-search +
// multiple knowledge-base lookups + LLM synthesis in 3-5 sequential calls.
// This collapses the chain into one paid endpoint at $0.150.
//
// Upstreams: DuckDuckGo Instant Answer (free), Wikipedia REST API (free),
//            HN Algolia (free), arXiv (free)
//            + gpt-4o-mini synthesis via OPENAI_API_KEY.

const UA          = "Mozilla/5.0 (compatible; myriad/3.61; +https://synaptiic.org)";
const SRC_TIMEOUT = 8_000;
const SYN_TIMEOUT = 25_000;
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";

// ── source fetchers ──────────────────────────────────────────────────────────

async function fetchDDG(claim) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(claim)}&format=json&no_html=1&no_redirect=1`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`DDG ${r.status}`);
  const d = await r.json();
  const items = [];
  if (d.AbstractText) {
    items.push({
      source:  "DuckDuckGo Abstract",
      title:   d.Heading || "Instant Answer",
      url:     d.AbstractURL || null,
      snippet: d.AbstractText.slice(0, 500),
    });
  }
  (d.RelatedTopics || []).slice(0, 4).forEach(t => {
    if (t.Text && t.FirstURL) {
      items.push({
        source:  "DuckDuckGo",
        title:   t.Text.slice(0, 80),
        url:     t.FirstURL,
        snippet: t.Text.slice(0, 400),
      });
    }
  });
  return items;
}

async function fetchWikipedia(claim) {
  // Step 1: find the most relevant article title
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(claim)}&limit=2&format=json`;
  const sr = await fetch(searchUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!sr.ok) throw new Error(`Wikipedia search ${sr.status}`);
  const [, titles,, urls] = await sr.json();
  if (!titles || titles.length === 0) return [];

  // Step 2: fetch summaries for top results
  const items = [];
  await Promise.all(titles.slice(0, 2).map(async (title, i) => {
    try {
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const resp = await fetch(summaryUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
      if (!resp.ok) return;
      const d = await resp.json();
      if (d.extract) {
        items.push({
          source:  "Wikipedia",
          title:   d.title || title,
          url:     d.content_urls?.desktop?.page || (urls?.[i] || null),
          snippet: d.extract.slice(0, 500),
        });
      }
    } catch (_) {}
  }));
  return items;
}

async function fetchHN(claim) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(claim)}&tags=story&hitsPerPage=4`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const d = await r.json();
  return (d.hits || []).map(h => ({
    source:  "Hacker News",
    title:   h.title,
    url:     h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    snippet: h.story_text ? h.story_text.replace(/<[^>]+>/g, "").slice(0, 400) : null,
  }));
}

async function fetchArxiv(claim) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(claim)}&max_results=3&sortBy=relevance`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`arXiv ${r.status}`);
  const text = await r.text();
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const block   = m[1];
    const title   = (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || "").trim().replace(/\n/g, " ");
    const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1] || "").trim().slice(0, 400);
    const link    = /<id>(.*?)<\/id>/.exec(block)?.[1]?.trim() || null;
    if (title) entries.push({ source: "arXiv (Preprint)", title, url: link, snippet: summary });
  }
  return entries;
}

// ── synthesis ────────────────────────────────────────────────────────────────

async function verify(claim, context, sourceGroups) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const allItems = sourceGroups.flatMap(g => g.items || []);
  const sourceBlock = allItems.slice(0, 18).map((s, i) =>
    `[${i + 1}] ${s.source}: "${s.title}"` +
    (s.snippet ? `\n    Excerpt: ${s.snippet}` : "") +
    (s.url ? `\n    URL: ${s.url}` : "")
  ).join("\n\n");

  const contextClause = context ? `\n\nAdditional context provided by caller: ${context}` : "";

  const prompt = `You are a rigorous fact-verification analyst. Your job is to assess the following claim against the evidence gathered from multiple independent sources.

CLAIM TO VERIFY: "${claim}"${contextClause}

EVIDENCE GATHERED:
${sourceBlock}

Assess the claim carefully. Consider:
- Does the evidence directly confirm the claim?
- Does any evidence contradict the claim?
- Is the evidence ambiguous, incomplete, or only partially relevant?
- What is the reliability of each source?

Respond ONLY with a JSON object (no markdown, no prose outside the JSON) with this exact structure:
{
  "verdict": "confirmed" | "contradicted" | "uncertain",
  "confidence": 0.0 to 1.0,
  "supporting_evidence": [{"source": "...", "excerpt": "...", "url": "..." }],
  "contradicting_evidence": [{"source": "...", "excerpt": "...", "url": "..."}],
  "key_entities": ["entity1", "entity2"],
  "reasoning": "Step-by-step explanation of your verdict, 2-4 sentences.",
  "caveats": "Any important limitations, missing evidence, or scope notes."
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:           MODEL,
      max_tokens:      1200,
      messages:        [
        { role: "system", content: "You are a rigorous fact-verification analyst. Always respond with valid JSON only. Never make up sources." },
        { role: "user",   content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status);
    throw new Error(`OpenAI API ${resp.status}: ${String(err).slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) return JSON.parse(m[0]);
    throw new Error("Synthesis did not return valid JSON");
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

export default {
  name:  "fact-check",
  price: "$0.150",

  description:
    "AI-powered claim verification. Searches DuckDuckGo, Wikipedia, Hacker News, and arXiv in parallel, then uses GPT-4o-mini to assess the claim and return a structured verdict: confirmed / contradicted / uncertain, with confidence score (0–1), supporting and contradicting evidence excerpts with source URLs, key entities, and step-by-step reasoning. Use before an agent acts on a factual assertion it received from another agent or user. $0.150/call.",

  inputSchema: {
    type: "object",
    properties: {
      claim: {
        type: "string",
        description: "The factual assertion to verify (e.g. 'Bitcoin was created in 2008' or 'TypeScript is a superset of JavaScript'). Be specific — vague claims return uncertain verdicts.",
      },
      context: {
        type: "string",
        description: "Optional background context that helps interpret the claim (e.g. domain, time period, known related facts). Narrows the verification scope.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      claim:                  { type: "string" },
      verdict:                { type: "string", enum: ["confirmed", "contradicted", "uncertain"] },
      confidence:             { type: "number", description: "0.0 (no evidence) to 1.0 (strong corroborating evidence)" },
      supporting_evidence:    { type: "array", items: { type: "object", properties: { source: { type: "string" }, excerpt: { type: "string" }, url: { type: ["string", "null"] } } } },
      contradicting_evidence: { type: "array", items: { type: "object", properties: { source: { type: "string" }, excerpt: { type: "string" }, url: { type: ["string", "null"] } } } },
      key_entities:           { type: "array", items: { type: "string" } },
      reasoning:              { type: "string" },
      caveats:                { type: "string" },
      sources_queried:        { type: "integer" },
      sources_responded:      { type: "integer" },
      timestamp:              { type: "string" },
    },
  },

  async handler({ claim = "The Eiffel Tower is located in Paris, France.", context }) {
    const c = claim.trim().slice(0, 400);
    const ctx = context ? context.trim().slice(0, 200) : null;

    const fetchers = [
      fetchDDG(c).then(items => ({ name: "ddg",       ok: true,  items })).catch(e => ({ name: "ddg",       ok: false, items: [], error: e.message })),
      fetchWikipedia(c).then(items => ({ name: "wikipedia", ok: true,  items })).catch(e => ({ name: "wikipedia", ok: false, items: [], error: e.message })),
      fetchHN(c).then(items => ({ name: "hn",         ok: true,  items })).catch(e => ({ name: "hn",         ok: false, items: [], error: e.message })),
      fetchArxiv(c).then(items => ({ name: "arxiv",   ok: true,  items })).catch(e => ({ name: "arxiv",     ok: false, items: [], error: e.message })),
    ];

    const groups = await Promise.all(fetchers);
    const responded = groups.filter(g => g.ok && g.items.length > 0);

    if (responded.length === 0) {
      return { error: "no_sources", message: "All source fetches failed. Try a more specific claim or check network connectivity." };
    }

    let result;
    try {
      result = await verify(c, ctx, responded);
    } catch (err) {
      return { error: "verification_failed", message: err.message };
    }

    return {
      claim:                  c,
      verdict:                result.verdict                || "uncertain",
      confidence:             typeof result.confidence === "number" ? Math.min(1, Math.max(0, result.confidence)) : 0,
      supporting_evidence:    Array.isArray(result.supporting_evidence)    ? result.supporting_evidence    : [],
      contradicting_evidence: Array.isArray(result.contradicting_evidence) ? result.contradicting_evidence : [],
      key_entities:           Array.isArray(result.key_entities)           ? result.key_entities           : [],
      reasoning:              result.reasoning || "",
      caveats:                result.caveats   || "",
      sources_queried:        4,
      sources_responded:      responded.length,
      timestamp:              new Date().toISOString(),
    };
  },
};
