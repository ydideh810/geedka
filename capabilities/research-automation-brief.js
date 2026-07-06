// research-automation-brief.js
//
// Scheduled intelligence brief: deep research synthesis + automation schedule.
// Combines research-synthesis (HN, OpenAlex, Reddit, arXiv, DDG → LLM) with
// cron-parser (schedule validation/generation) into a single call — returns
// a structured research report AND a cron schedule for recurring research runs.
//
// Seam signal (cy_hb_3321, 2026-07-06): 13x co-call — 13 distinct payers called
// both cron-parser and research-synthesis in the 30-day window. They are building
// scheduled intelligence pipelines that need recurring research synthesis.
//
// Price: $3.00 — above research-synthesis ($2.50) because it delivers research
// PLUS automation setup (schedule + cadence recommendation + freshness guidance).
//
// Upstream: HN Algolia (free), OpenAlex (free), Reddit JSON (free),
//           arXiv (free), DDG Instant Answer (free)
//           + gpt-4o-mini via OPENAI_API_KEY.

const UA          = "Mozilla/5.0 (compatible; the-stall/4.87; +https://intuitek.ai)";
const SRC_TIMEOUT = 8_000;
const SYN_TIMEOUT = 25_000;
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";

// ── cron resolution (mirrors cron-parser logic) ──────────────────────────────

const SHORTCUTS = {
  "@yearly":   { cron: "0 0 1 1 *",    desc: "Once a year (Jan 1 at midnight)" },
  "@annually": { cron: "0 0 1 1 *",    desc: "Once a year (Jan 1 at midnight)" },
  "@monthly":  { cron: "0 0 1 * *",    desc: "Once a month (1st at midnight)" },
  "@weekly":   { cron: "0 0 * * 0",    desc: "Once a week (Sunday at midnight)" },
  "@daily":    { cron: "0 0 * * *",    desc: "Once a day at midnight" },
  "@midnight": { cron: "0 0 * * *",    desc: "Once a day at midnight" },
  "@hourly":   { cron: "0 * * * *",    desc: "Every hour at the top of the hour" },
};

const NATURAL_MAP = {
  "realtime":        { cron: "* * * * *",    desc: "Every minute (use a queue for true real-time)" },
  "every minute":    { cron: "* * * * *",    desc: "Every minute" },
  "minutely":        { cron: "* * * * *",    desc: "Every minute" },
  "hourly":          { cron: "0 * * * *",    desc: "Every hour" },
  "every hour":      { cron: "0 * * * *",    desc: "Every hour" },
  "daily":           { cron: "0 0 * * *",    desc: "Every day at midnight" },
  "every day":       { cron: "0 0 * * *",    desc: "Every day at midnight" },
  "weekly":          { cron: "0 0 * * 0",    desc: "Every week on Sunday" },
  "every week":      { cron: "0 0 * * 0",    desc: "Every week on Sunday" },
  "monthly":         { cron: "0 0 1 * *",    desc: "Every month on the 1st" },
  "every month":     { cron: "0 0 1 * *",    desc: "Every month on the 1st" },
  "every 5 minutes": { cron: "*/5 * * * *",  desc: "Every 5 minutes" },
  "every 15 minutes":{ cron: "*/15 * * * *", desc: "Every 15 minutes" },
  "every 30 minutes":{ cron: "*/30 * * * *", desc: "Every 30 minutes" },
  "every 2 hours":   { cron: "0 */2 * * *",  desc: "Every 2 hours" },
  "every 4 hours":   { cron: "0 */4 * * *",  desc: "Every 4 hours" },
  "every 6 hours":   { cron: "0 */6 * * *",  desc: "Every 6 hours" },
  "every 12 hours":  { cron: "0 */12 * * *", desc: "Every 12 hours" },
};

const CRON_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;
const FIELD_RANGES = [[0,59],[0,23],[1,31],[1,12],[0,6]];

function validateCronField(field, min, max) {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    const [range, step] = part.split("/");
    if (step && (isNaN(parseInt(step)) || parseInt(step) < 1)) return false;
    if (range === "*") continue;
    if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) return false;
    } else {
      const v = parseInt(range, 10);
      if (isNaN(v) || v < min || v > max) return false;
    }
  }
  return true;
}

function resolveSchedule(raw) {
  if (!raw) return null;  // null = no schedule provided; recommend one from LLM
  const trimmed = raw.trim().toLowerCase();
  if (SHORTCUTS[trimmed]) return { cron: SHORTCUTS[trimmed].cron, desc: SHORTCUTS[trimmed].desc, valid: true, source: "shortcut" };
  for (const [key, val] of Object.entries(NATURAL_MAP)) {
    if (trimmed === key || trimmed.startsWith(key)) return { cron: val.cron, desc: val.desc, valid: true, source: "natural" };
  }
  const everyMatch = trimmed.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    if (unit.startsWith("minute") && n >= 1 && n <= 30)
      return { cron: `*/${n} * * * *`, desc: `Every ${n} minute${n>1?"s":""}`, valid: true, source: "dynamic" };
    if (unit.startsWith("hour") && n >= 1 && n <= 12)
      return { cron: `0 */${n} * * *`, desc: `Every ${n} hour${n>1?"s":""}`, valid: true, source: "dynamic" };
    if (unit.startsWith("day") && n >= 1 && n <= 7)
      return { cron: `0 0 */${n} * *`, desc: `Every ${n} day${n>1?"s":""}`, valid: true, source: "dynamic" };
  }
  if (CRON_RE.test(raw.trim())) {
    const parts = raw.trim().split(/\s+/);
    const valid = parts.every((f, i) => validateCronField(f, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
    return { cron: raw.trim(), desc: valid ? "Custom cron expression (valid)" : "Custom cron expression (check fields)", valid, source: "raw" };
  }
  return { cron: "0 * * * *", desc: "Defaulted to hourly (unrecognized schedule input)", valid: false, source: "fallback", original: raw };
}

// ── source fetchers (mirrors research-synthesis) ─────────────────────────────

async function fetchHN(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const d = await r.json();
  return (d.hits || []).map(h => ({ source: "Hacker News", title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, snippet: h.story_text ? h.story_text.slice(0, 300) : null }));
}

async function fetchOpenAlex(query) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=5&mailto=kyle@intuitek.ai&select=title,abstract_inverted_index,publication_year,cited_by_count,primary_location`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const d = await r.json();
  function decodeInv(inv) {
    if (!inv) return null;
    return Object.entries(inv).flatMap(([w,pos]) => pos.map(p => ({w,p}))).sort((a,b)=>a.p-b.p).map(x=>x.w).join(" ");
  }
  return (d.results || []).map(w => ({ source: "OpenAlex (Academic)", title: w.title, year: w.publication_year, cited: w.cited_by_count, url: w.primary_location?.landing_page_url || null, snippet: decodeInv(w.abstract_inverted_index)?.slice(0, 300) || null }));
}

async function fetchReddit(query) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5&t=month`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`Reddit ${r.status}`);
  const d = await r.json();
  return ((d.data?.children) || []).map(c => c.data).map(p => ({ source: "Reddit", title: p.title, url: `https://reddit.com${p.permalink}`, subreddit: p.subreddit, score: p.score, snippet: p.selftext ? p.selftext.slice(0, 300) : null }));
}

async function fetchArxiv(query) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=4&sortBy=relevance`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`arXiv ${r.status}`);
  const text = await r.text();
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const b = m[1];
    const title = (/<title>([\s\S]*?)<\/title>/.exec(b)?.[1] || "").trim().replace(/\n/g, " ");
    const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(b)?.[1] || "").trim().slice(0, 300);
    const link = /<id>(.*?)<\/id>/.exec(b)?.[1]?.trim() || null;
    if (title) entries.push({ source: "arXiv (Preprint)", title, url: link, snippet: summary });
  }
  return entries;
}

async function fetchDDG(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`DDG ${r.status}`);
  const d = await r.json();
  const items = [];
  if (d.AbstractText) items.push({ source: "DuckDuckGo Abstract", title: d.Heading, url: d.AbstractURL, snippet: d.AbstractText.slice(0, 400) });
  (d.RelatedTopics || []).slice(0, 3).forEach(t => {
    if (t.Text && t.FirstURL) items.push({ source: "DuckDuckGo", title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 300) });
  });
  return items;
}

// ── synthesis with automation guidance ──────────────────────────────────────

async function synthesize(query, focus, schedule, results, apiKey) {
  const sources = results.flatMap(r => r.items || []);
  const sourceText = sources.slice(0, 20).map((s, i) =>
    `[${i + 1}] ${s.source}: ${s.title}` +
    (s.snippet ? `\n    → ${s.snippet}` : "") +
    (s.url ? `\n    URL: ${s.url}` : "")
  ).join("\n\n");

  const scheduleClause = schedule
    ? `The user intends to run this research on schedule: ${schedule.cron} (${schedule.desc}).`
    : "The user has not specified a schedule — recommend the optimal one.";

  const focusClause = focus ? ` Focus particularly on: ${focus}.` : "";

  const prompt = `You are an AI intelligence analyst specializing in automated research pipelines. Synthesize the following source snippets into a structured intelligence report for the query: "${query}".${focusClause}

${scheduleClause}

SOURCES GATHERED:
${sourceText}

Respond ONLY with a JSON object (no markdown, no prose outside the JSON):
{
  "summary": "2-3 sentence executive synthesis of the key findings",
  "key_findings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "sentiment": "positive | negative | neutral | mixed",
  "trends": ["trend 1", "trend 2", "trend 3"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "recommended_cron": "best cron expression for recurring this research (e.g. '0 8 * * 1' for weekly Monday 8am)",
  "recommended_cadence": "one sentence: how often this topic should realistically be researched and why",
  "freshness_window": "how long before this research goes stale (e.g. '1 day', '1 week', '1 month')",
  "schedule_fit": "if a schedule was provided — is it appropriate? if not, why not. if no schedule was provided, just confirm your recommendation",
  "automation_notes": "key notes for running this research unattended (data availability windows, rate limits, error handling)"
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [
        { role: "system", content: "You are an intelligence analyst. Always respond with valid JSON only." },
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

// ── export ───────────────────────────────────────────────────────────────────

export default {
  name:  "research-automation-brief",
  price: "$3.00",

  description:
    "Automated research intelligence: combines deep topic synthesis (Hacker News, OpenAlex academic papers, Reddit, arXiv, DuckDuckGo) with scheduling guidance in a single call. Returns a structured research report — executive summary, key findings, sentiment, emerging trends, and recommendations — plus a validated cron schedule, recommended cadence, freshness window, and automation notes for recurring unattended runs. Ideal for developers building scheduled intelligence pipelines, agent builders setting up recurring research feeds, and teams that need to monitor a topic on autopilot. Works across any domain: markets, technology, science, geopolitics, and more.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Research topic or question. Works across any domain: financial markets ('Fed rate policy impact on equities'), technology ('AI agent protocols 2025'), science ('CRISPR therapeutic applications'), geopolitics, and more. Omit for a default AI agents & autonomous systems report.",
      },
      focus: {
        type: "string",
        description: "Optional analytical focus direction (e.g. 'risks and challenges', 'market adoption', 'technical implementation'). Narrows the synthesis lens.",
      },
      schedule: {
        type: "string",
        description: "When to run this research recurringly. Accepts: named shortcuts (@hourly, @daily, @weekly, @monthly), natural language ('every 4 hours', 'daily', 'every 30 minutes'), or a raw cron expression (e.g. '0 8 * * 1'). Omit to get an AI-recommended cadence for your topic.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:               { type: "string" },
      focus:               { type: ["string", "null"] },
      summary:             { type: "string" },
      key_findings:        { type: "array",  items: { type: "string" } },
      sentiment:           { type: "string" },
      trends:              { type: "array",  items: { type: "string" } },
      recommendations:     { type: "array",  items: { type: "string" } },
      cron_schedule:       { type: ["object","null"], description: "Resolved cron schedule (if provided). null if none given." },
      recommended_cron:    { type: "string",  description: "AI-recommended cron expression for recurring runs." },
      recommended_cadence: { type: "string",  description: "Plain-English cadence recommendation with rationale." },
      freshness_window:    { type: "string",  description: "How long before this research goes stale." },
      schedule_fit:        { type: "string",  description: "Assessment of the provided schedule (or confirmation of recommendation)." },
      automation_notes:    { type: "string",  description: "Guidance for running this research unattended." },
      sources_queried:     { type: "integer" },
      sources_responded:   { type: "integer" },
      source_breakdown:    { type: "object" },
      synthesis_error:     { type: "string" },
      ts:                  { type: "string" },
    },
  },

  async handler({ query, focus, schedule }, _req, env) {
    const apiKey = env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw Object.assign(new Error("OPENAI_API_KEY not configured"), { status: 500 });

    const DEFAULT_QUERY = "AI agents autonomous systems 2025";
    const q = (query && query.trim().length >= 3 ? query.trim() : DEFAULT_QUERY).slice(0, 200);
    const f = focus ? focus.trim().slice(0, 100) : null;

    const resolvedSchedule = schedule ? resolveSchedule(schedule.trim()) : null;

    // Fetch all sources in parallel
    const sourceNames = ["hn", "openalex", "reddit", "arxiv", "ddg"];
    const results = await Promise.all([
      fetchHN(q).then(items => ({ name: "hn",       ok: true,  items })).catch(e => ({ name: "hn",       ok: false, items: [], error: e.message })),
      fetchOpenAlex(q).then(items => ({ name: "openalex", ok: true, items })).catch(e => ({ name: "openalex", ok: false, items: [], error: e.message })),
      fetchReddit(q).then(items => ({ name: "reddit",   ok: true,  items })).catch(e => ({ name: "reddit",   ok: false, items: [], error: e.message })),
      fetchArxiv(q).then(items => ({ name: "arxiv",    ok: true,  items })).catch(e => ({ name: "arxiv",    ok: false, items: [], error: e.message })),
      fetchDDG(q).then(items => ({ name: "ddg",      ok: true,  items })).catch(e => ({ name: "ddg",      ok: false, items: [], error: e.message })),
    ]);

    const responded = results.filter(r => r.ok && r.items.length > 0);
    if (responded.length === 0) {
      return { error: "no_sources", message: "All source fetches failed. Try again or use a broader query." };
    }

    let synthesis = null;
    let synthError = null;
    try {
      synthesis = await synthesize(q, f, resolvedSchedule, responded, apiKey);
    } catch (err) {
      synthError = err.message;
    }

    const breakdown = {};
    for (const r of results) breakdown[r.name] = r.ok ? r.items.length : `error: ${r.error}`;

    return {
      query:               q,
      focus:               f,
      summary:             synthesis?.summary             || "",
      key_findings:        synthesis?.key_findings        || [],
      sentiment:           synthesis?.sentiment           || "neutral",
      trends:              synthesis?.trends              || [],
      recommendations:     synthesis?.recommendations     || [],
      cron_schedule:       resolvedSchedule               || null,
      recommended_cron:    synthesis?.recommended_cron    || null,
      recommended_cadence: synthesis?.recommended_cadence || null,
      freshness_window:    synthesis?.freshness_window    || null,
      schedule_fit:        synthesis?.schedule_fit        || null,
      automation_notes:    synthesis?.automation_notes    || null,
      sources_queried:     sourceNames.length,
      sources_responded:   responded.length,
      source_breakdown:    breakdown,
      synthesis_error:     synthError || undefined,
      ts:                  new Date().toISOString(),
    };
  },
};
