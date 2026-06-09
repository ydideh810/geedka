// content-moderation.js
//
// AI content moderation: classify text for harmful categories, return risk level,
// flagged category list, per-category confidence scores, and optionally generate
// a safe rewrite of flagged content.
//
// Covers: hate speech, harassment, self-harm, sexual content (incl. minors),
// violence, and illicit/dangerous instruction detection.
//
// Seam: orbisapi.com/proxy/content-moderation-api-4fa8a6/
//   2,573 settlements/48h, 3 payers, $0.005/call (PROSPECTOR 2026-06-09)
//
// Upstream: OpenAI Moderation API (api.openai.com/v1/moderations)
//   Free-tier endpoint — not billed as tokens. Available to all API users.
//   Model: omni-moderation-latest (text + image multimodal).
//   + GPT-4o-mini (only invoked when rewrite=true AND content is flagged).

"use strict";

const MODERATION_URL = "https://api.openai.com/v1/moderations";
const CHAT_URL       = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MOD    = 12_000;
const TIMEOUT_REWRITE = 20_000;

function riskLevel(scores) {
  const max = Math.max(...Object.values(scores));
  if (max >= 0.8) return "HIGH";
  if (max >= 0.4) return "MEDIUM";
  if (max >= 0.1) return "LOW";
  return "NONE";
}

function topCategories(categories, scores, topN = 5) {
  const flagged = Object.entries(categories)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const top = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([k, v]) => ({ category: k, score: +v.toFixed(4) }));
  return { flagged_categories: flagged, top_scores: top };
}

async function runModeration(apiKey, input) {
  const body = Array.isArray(input)
    ? { model: "omni-moderation-latest", input }
    : { model: "omni-moderation-latest", input };
  const resp = await fetch(MODERATION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MOD),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => String(resp.status));
    throw new Error(`OpenAI moderation ${resp.status}: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function generateSafeRewrite(apiKey, text) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 512,
      messages: [
        {
          role: "system",
          content:
            "You are a content safety editor. Rewrite the user's text to remove all harmful, offensive, or policy-violating content while preserving the core communicative intent as much as possible. Return only the rewritten text, nothing else.",
        },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_REWRITE),
  });
  if (!resp.ok) throw new Error(`Safe rewrite ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

export default {
  name:        "content-moderation",
  price:       "$0.003",
  description:
    "Classify text (and optional image URLs) for harmful content — hate speech, harassment, self-harm, sexual content, violence, and illicit instructions. Returns flagged status, risk level (NONE/LOW/MEDIUM/HIGH), flagged categories, per-category confidence scores, and an optional AI-generated safe rewrite.",

  inputSchema: {
    type: "object",
    properties: {
      text: {
        type:        "string",
        description: "Text content to moderate (required unless image_url provided).",
      },
      image_url: {
        type:        "string",
        description: "Optional public image URL to moderate alongside text.",
      },
      rewrite: {
        type:        "boolean",
        description: "If true and content is flagged, return an AI-generated safe rewrite. Adds ~1s latency.",
        default:     false,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      flagged:            { type: "boolean", description: "True if any harmful category was detected." },
      risk_level:         { type: "string",  description: "NONE | LOW | MEDIUM | HIGH — based on highest category score." },
      flagged_categories: { type: "array",   description: "List of violated category names." },
      top_scores:         { type: "array",   description: "Top 5 category scores [{ category, score }]." },
      safe_rewrite:       { type: "string",  description: "Safe rewrite of flagged content (only present if rewrite=true and flagged=true)." },
      model:              { type: "string",  description: "Moderation model used." },
    },
    required: ["flagged", "risk_level", "flagged_categories", "top_scores"],
  },

  async handler(params) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const text       = (params.text || "").trim();
    const image_url  = (params.image_url || "").trim();
    const doRewrite  = !!params.rewrite;

    if (!text && !image_url) {
      throw new Error("Provide at least one of: text, image_url");
    }

    // Build multi-modal input if image provided
    let input;
    if (image_url && text) {
      input = [{ type: "text", text }, { type: "image_url", image_url: { url: image_url } }];
    } else if (image_url) {
      input = [{ type: "image_url", image_url: { url: image_url } }];
    } else {
      input = text;
    }

    const data   = await runModeration(apiKey, input);
    const result = data.results?.[0];
    if (!result) throw new Error("Empty moderation response");

    const { flagged, categories, category_scores } = result;
    const level    = riskLevel(category_scores);
    const { flagged_categories, top_scores } = topCategories(categories, category_scores);

    const out = {
      flagged,
      risk_level:         level,
      flagged_categories,
      top_scores,
      model:              data.model ?? "omni-moderation-latest",
    };

    if (doRewrite && flagged && text) {
      try {
        out.safe_rewrite = await generateSafeRewrite(apiKey, text);
      } catch (_) {
        out.safe_rewrite = null;
      }
    }

    return out;
  },
};
