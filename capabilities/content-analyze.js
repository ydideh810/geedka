// content-analyze.js
//
// AI-powered URL content analysis. Fetches a URL, extracts the readable text,
// and returns structured intelligence: summary, key points, named entities,
// sentiment, topics, content type, and credibility signals.
//
// Seam: content.hugen.tokyo/content/analyze — 182 calls / 14 payers on day 1
// (2026-06-09), $0.0200/call. STALL prices at $0.008 (60% undercut).
//
// Upstreams:
//   r.jina.ai  — free URL-to-Markdown reader (proven in readable-content.js)
//   gpt-4o-mini — structured analysis via OPENAI_API_KEY (~$0.001 per call)

const JINA_BASE    = "https://r.jina.ai";
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const MODEL        = "gpt-4o-mini";
const UA           = "Mozilla/5.0 (compatible; the-stall/3.47; +https://intuitek.ai)";
const FETCH_TIMEOUT = 18_000;
const AI_TIMEOUT   = 30_000;
const MAX_CHARS    = 8_000;

async function fetchContent(url) {
  const jinaUrl = `${JINA_BASE}/${url}`;
  const resp = await fetch(jinaUrl, {
    headers: { "User-Agent": UA, Accept: "text/markdown, text/plain", "X-Timeout": "16" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Content fetch HTTP ${resp.status} for ${url}`);
  const text = await resp.text();
  return text.slice(0, MAX_CHARS);
}

async function analyzeContent(url, content, focus) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const focusLine = focus ? `\nFocus on: ${focus}` : "";

  const prompt = `You are a precise content intelligence extractor. Analyze the following web content and return ONLY valid JSON (no markdown, no commentary).${focusLine}

URL: ${url}
Content:
---
${content}
---

Return this exact JSON structure:
{
  "summary": "2-3 sentence summary of the main content",
  "key_points": ["point 1", "point 2", "point 3"],
  "sentiment": {"label": "positive|negative|neutral|mixed", "score": 0.0},
  "entities": [{"name": "entity name", "type": "person|org|place|product|concept|date|number"}],
  "topics": ["topic1", "topic2"],
  "content_type": "news|blog|research|product|documentation|social|forum|other",
  "credibility_signals": {
    "has_author": true,
    "has_date": true,
    "has_sources": true,
    "word_count_adequate": true
  }
}

Rules:
- key_points: 3–7 most important takeaways
- entities: top 5–10 named entities only
- topics: 2–5 topic tags (kebab-case)
- sentiment score: 0.0 (very negative) to 1.0 (very positive), 0.5 = neutral
- word_count_adequate: true if content has 150+ substantive words`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

export default {
  name:  "content-analyze",
  price: "$0.012",

  description:
    "AI-powered URL content analysis. Fetches a URL, extracts the readable article text, and returns structured intelligence: 2–3 sentence summary, key points, named entities with types, sentiment score, topic tags, content type classification, and credibility signals (has author/date/sources). Use for content intelligence pipelines, research synthesis, or automated brief generation. $0.008/call.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL to analyze (article, blog post, news page, documentation, product page, etc.).",
      },
      focus: {
        type: "string",
        description: "Optional focus instruction. E.g. 'focus on financial claims', 'extract regulatory implications', 'identify risk factors'. Narrows the analysis.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:              { type: "string" },
      summary:          { type: "string",  description: "2–3 sentence summary of the main content." },
      key_points:       { type: "array",   description: "3–7 key takeaways." },
      sentiment:        { type: "object",  description: "label (positive/negative/neutral/mixed) + score (0–1)." },
      entities:         { type: "array",   description: "Named entities: name + type." },
      topics:           { type: "array",   description: "Topic tags in kebab-case." },
      content_type:     { type: "string",  description: "news | blog | research | product | documentation | social | forum | other" },
      credibility_signals: { type: "object", description: "has_author, has_date, has_sources, word_count_adequate." },
    },
  },

  async handler({ url, focus }) {
    if (!url || typeof url !== "string") throw new Error("url is required");

    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    const content = await fetchContent(normalizedUrl);
    if (!content || content.trim().length < 50) {
      throw new Error("Could not extract readable content from URL (page may require JavaScript or authentication)");
    }

    const analysis = await analyzeContent(normalizedUrl, content, focus);

    return {
      url: normalizedUrl,
      summary:             analysis.summary          || "Summary unavailable.",
      key_points:          analysis.key_points        || [],
      sentiment:           analysis.sentiment         || { label: "neutral", score: 0.5 },
      entities:            analysis.entities          || [],
      topics:              analysis.topics            || [],
      content_type:        analysis.content_type      || "other",
      credibility_signals: analysis.credibility_signals || {
        has_author: false,
        has_date:   false,
        has_sources: false,
        word_count_adequate: false,
      },
    };
  },
};
