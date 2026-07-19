// ai-pipeline-brief.js
//
// AI pipeline architecture brief: model selection + cron schedule + deployment guide.
// Searches HuggingFace Hub for the best ML models for a given task, generates
// or validates a cron schedule, then synthesizes a pipeline architecture brief
// via gpt-4o-mini — all in one payment instead of two.
//
// Seam signal (cy_hb_3317, 2026-07-06): 14w co-call — 100% of hf-model-search
// payers also call cron-parser. They are building scheduled AI pipelines that
// need model selection + schedule validation together.
//
// Upstream: HuggingFace API (free) + gpt-4o-mini via OPENAI_API_KEY.
// No external call for cron — pure JS computation.

const HF_API     = "https://huggingface.co/api/models";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "myriad/4.85 (https://synaptiic.org)";
const HF_TIMEOUT = 10_000;
const SYN_TIMEOUT = 20_000;

// ── cron schedule helpers ────────────────────────────────────────────────────

const SHORTCUTS = {
  "@yearly":   { cron: "0 0 1 1 *",   desc: "Once a year (Jan 1 at midnight)" },
  "@annually": { cron: "0 0 1 1 *",   desc: "Once a year (Jan 1 at midnight)" },
  "@monthly":  { cron: "0 0 1 * *",   desc: "Once a month (1st at midnight)" },
  "@weekly":   { cron: "0 0 * * 0",   desc: "Once a week (Sunday at midnight)" },
  "@daily":    { cron: "0 0 * * *",   desc: "Once a day at midnight" },
  "@midnight": { cron: "0 0 * * *",   desc: "Once a day at midnight" },
  "@hourly":   { cron: "0 * * * *",   desc: "Every hour at the top of the hour" },
};

const NATURAL_MAP = {
  "realtime":       { cron: "* * * * *",    desc: "Every minute (use a queue for true real-time)" },
  "every minute":   { cron: "* * * * *",    desc: "Every minute" },
  "minutely":       { cron: "* * * * *",    desc: "Every minute" },
  "hourly":         { cron: "0 * * * *",    desc: "Every hour" },
  "every hour":     { cron: "0 * * * *",    desc: "Every hour" },
  "daily":          { cron: "0 0 * * *",    desc: "Every day at midnight" },
  "every day":      { cron: "0 0 * * *",    desc: "Every day at midnight" },
  "weekly":         { cron: "0 0 * * 0",    desc: "Every week on Sunday" },
  "every week":     { cron: "0 0 * * 0",    desc: "Every week on Sunday" },
  "monthly":        { cron: "0 0 1 * *",    desc: "Every month on the 1st" },
  "every month":    { cron: "0 0 1 * *",    desc: "Every month on the 1st" },
  "every 5 minutes":  { cron: "*/5 * * * *", desc: "Every 5 minutes" },
  "every 10 minutes": { cron: "*/10 * * * *", desc: "Every 10 minutes" },
  "every 15 minutes": { cron: "*/15 * * * *", desc: "Every 15 minutes" },
  "every 30 minutes": { cron: "*/30 * * * *", desc: "Every 30 minutes" },
  "every 2 hours":  { cron: "0 */2 * * *",  desc: "Every 2 hours" },
  "every 4 hours":  { cron: "0 */4 * * *",  desc: "Every 4 hours" },
  "every 6 hours":  { cron: "0 */6 * * *",  desc: "Every 6 hours" },
  "every 8 hours":  { cron: "0 */8 * * *",  desc: "Every 8 hours" },
  "every 12 hours": { cron: "0 */12 * * *", desc: "Every 12 hours" },
};

const CRON_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;
const FIELD_RANGES = [[0,59],[0,23],[1,31],[1,12],[0,6]];

function validateCronField(field, min, max) {
  if (field === "*") return true;
  const parts = field.split(",");
  for (const part of parts) {
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
  if (!raw) return { cron: "0 * * * *", desc: "Every hour (default)", valid: true };
  const trimmed = raw.trim().toLowerCase();

  // Named shortcut
  if (SHORTCUTS[trimmed]) {
    const s = SHORTCUTS[trimmed];
    return { cron: s.cron, desc: s.desc, valid: true };
  }

  // Natural language
  for (const [key, val] of Object.entries(NATURAL_MAP)) {
    if (trimmed === key || trimmed.startsWith(key)) {
      return { cron: val.cron, desc: val.desc, valid: true };
    }
  }

  // Parse "every N <unit>" dynamically
  const everyMatch = trimmed.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    if (unit.startsWith("minute") && n >= 1 && n <= 30)
      return { cron: `*/${n} * * * *`, desc: `Every ${n} minute${n>1?"s":""}`, valid: true };
    if (unit.startsWith("hour") && n >= 1 && n <= 12)
      return { cron: `0 */${n} * * *`, desc: `Every ${n} hour${n>1?"s":""}`, valid: true };
    if (unit.startsWith("day") && n >= 1 && n <= 7)
      return { cron: `0 0 */${n} * *`, desc: `Every ${n} day${n>1?"s":""}`, valid: true };
  }

  // Validate raw cron expression
  if (CRON_RE.test(raw.trim())) {
    const parts = raw.trim().split(/\s+/);
    const valid = parts.every((f, i) => validateCronField(f, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
    return {
      cron: raw.trim(),
      desc: valid ? "Custom schedule (valid cron expression)" : "Custom schedule (validation warning — double-check fields)",
      valid,
    };
  }

  // Fallback
  return { cron: "0 * * * *", desc: "Defaulted to hourly (unrecognized schedule input)", valid: false, original: raw };
}

// ── HuggingFace model search ─────────────────────────────────────────────────

async function fetchHFModels(query, pipelineTag, limit) {
  const params = new URLSearchParams({
    search: query,
    sort:   "downloads",
    limit:  String(Math.min(limit, 10)),
    full:   "false",
  });
  if (pipelineTag) params.set("pipeline_tag", pipelineTag);

  const resp = await fetch(`${HF_API}?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(HF_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HuggingFace API ${resp.status}`);
  const models = await resp.json();

  return (Array.isArray(models) ? models : []).map(m => ({
    id:            m.modelId || m.id,
    author:        m.author       || (m.modelId || m.id || "").split("/")[0] || null,
    pipeline_task: m.pipeline_tag || null,
    library:       m.library_name || null,
    downloads:     m.downloads    || 0,
    likes:         m.likes        || 0,
    tags:          (m.tags        || []).slice(0, 6),
  }));
}

// ── OpenAI synthesis ─────────────────────────────────────────────────────────

async function synthesizePipeline(taskDesc, schedule, models, pipelineTag, env) {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const modelsSummary = models.slice(0, 5).map((m, i) =>
    `${i+1}. ${m.id} (${m.pipeline_task || "unknown task"}, ${m.downloads.toLocaleString()} downloads, ${m.likes} likes)`
  ).join("\n");

  const prompt = `You are an AI pipeline architect. A developer wants to build a scheduled AI pipeline for the following task:

TASK: ${taskDesc}
SCHEDULE: ${schedule.cron} (${schedule.desc})
HF TASK FILTER: ${pipelineTag || "not specified"}

TOP HUGGINGFACE MODELS FOUND:
${modelsSummary || "No models found for this query."}

Return a JSON object with these fields (keep each field concise — 1-3 sentences max):
{
  "top_model_recommendation": "Which model to use and why (cite the model ID)",
  "model_rationale": "Why this model fits the task (latency, size, quality tradeoff)",
  "runner_up": "Second-best option and when to prefer it",
  "schedule_fit": "Is the chosen schedule appropriate for this AI task? Any concerns?",
  "pipeline_steps": ["step1", "step2", "step3"],
  "deployment_notes": "Key notes on deploying this pipeline (hosting, auth, rate limits)",
  "cost_estimate": "Estimated HF inference cost per run if using cloud endpoints",
  "gotchas": "One key risk or gotcha to watch for"
}
Return ONLY valid JSON. No markdown fences.`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens:  600,
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON if model included extra text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("synthesis parse failed");
  }
}

// ── export ───────────────────────────────────────────────────────────────────

export default {
  name:  "ai-pipeline-brief",
  price: "$1.75",

  description:
    "AI pipeline architecture brief: finds the best HuggingFace models for your ML task, validates or generates your cron schedule, and synthesizes a deployment guide — all in one call. Serves AI developers and agent builders who need model selection + scheduling together. Input: task description (e.g. 'classify customer sentiment hourly from social media feeds') plus optional HuggingFace pipeline task filter and schedule. Returns: top model recommendations, validated cron expression, pipeline steps, deployment notes, and cost estimate.",

  inputSchema: {
    type: "object",
    properties: {
      task_description: {
        type: "string",
        description: "What the AI pipeline should do. Be specific (e.g. 'classify customer support tickets into 5 categories every 15 minutes' or 'generate daily summaries of earnings call transcripts'). Required.",
      },
      pipeline_task: {
        type: "string",
        description: "Optional HuggingFace pipeline task filter to narrow model search. Common values: text-classification, text-generation, summarization, token-classification, question-answering, sentence-similarity, image-classification, zero-shot-classification.",
      },
      schedule: {
        type: "string",
        description: "When to run the pipeline. Accepts: named shortcuts (@hourly, @daily, @weekly, @monthly), natural language ('every 4 hours', 'daily', 'every 30 minutes'), or a raw cron expression (e.g. '0 */4 * * *'). Defaults to hourly if omitted.",
      },
      model_limit: {
        type: "integer",
        minimum: 3,
        maximum: 10,
        description: "How many HuggingFace models to consider in the search (3–10). Default: 8.",
      },
    },
    required: ["task_description"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      task_description:        { type: "string" },
      cron_schedule:           { type: "object", description: "Resolved cron expression, human description, and validity flag." },
      candidate_models:        { type: "array",  description: "HuggingFace model results (id, task, downloads, likes, library)." },
      top_model_recommendation: { type: "string" },
      model_rationale:         { type: "string" },
      runner_up:               { type: "string" },
      schedule_fit:            { type: "string" },
      pipeline_steps:          { type: "array",  items: { type: "string" } },
      deployment_notes:        { type: "string" },
      cost_estimate:           { type: "string" },
      gotchas:                 { type: "string" },
      models_found:            { type: "integer" },
      synthesis_error:         { type: "string" },
      ts:                      { type: "string" },
    },
  },

  async handler(query, _req, env) {
    const taskDesc    = (query.task_description || "").trim().slice(0, 400);
    if (!taskDesc) throw Object.assign(new Error("task_description is required"), { status: 400 });

    const pipelineTag = query.pipeline_task ? query.pipeline_task.trim() : null;
    const scheduleRaw = query.schedule       ? query.schedule.trim()     : null;
    const modelLimit  = query.model_limit    || 8;

    const schedule = resolveSchedule(scheduleRaw);

    // Fetch HF models + run synthesis in parallel
    const [models, synthesisResult] = await Promise.all([
      fetchHFModels(taskDesc, pipelineTag, modelLimit)
        .catch(err => ({ error: err.message, models: [] })),
      // We'll synthesize after we have models, but kick off a quick description search meanwhile
      Promise.resolve(null),
    ]);

    const modelList = Array.isArray(models) ? models : (models.models || []);
    const hfError   = Array.isArray(models) ? null : models.error;

    let synthesis = null;
    let synthError = null;
    try {
      synthesis = await synthesizePipeline(taskDesc, schedule, modelList, pipelineTag, env);
    } catch (err) {
      synthError = err.message;
    }

    return {
      task_description:         taskDesc,
      cron_schedule:            schedule,
      candidate_models:         modelList,
      top_model_recommendation: synthesis?.top_model_recommendation || null,
      model_rationale:          synthesis?.model_rationale          || null,
      runner_up:                synthesis?.runner_up                || null,
      schedule_fit:             synthesis?.schedule_fit             || null,
      pipeline_steps:           synthesis?.pipeline_steps           || [],
      deployment_notes:         synthesis?.deployment_notes         || null,
      cost_estimate:            synthesis?.cost_estimate            || null,
      gotchas:                  synthesis?.gotchas                  || null,
      models_found:             modelList.length,
      hf_error:                 hfError   || undefined,
      synthesis_error:          synthError || undefined,
      ts:                       new Date().toISOString(),
    };
  },
};
