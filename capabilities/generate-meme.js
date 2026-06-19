// generate-meme.js
//
// Generates a meme image via memegen.link (free, open-source, 211 templates).
// Returns a direct PNG URL and embed-ready markdown.
//
// Collapses the ottoai.services/generate-meme seam:
//   5 days observation, strength 1.0, Media category growth 8→25→85/day.
//   signal-intel signal_id 53879 (seam) — priced at $0.005 vs ottoai's higher rate.
//
// Free upstream: api.memegen.link — no API key, no rate limit, MIT license.

const BASE = "https://api.memegen.link";

function encodeText(text) {
  if (!text || text.trim() === "") return "_";
  return text
    .replace(/_/g, "__")
    .replace(/\//g, "~s")
    .replace(/%/g, "~p")
    .replace(/\[/g, "~b")
    .replace(/\]/g, "~B")
    .replace(/\?/g, "~q")
    .replace(/&/g, "~a")
    .replace(/ /g, "_");
}

export default {
  name: "generate-meme",
  price: "$0.005",

  description:
    "Generates a meme image from 211 built-in templates. Returns a direct PNG URL and embed-ready markdown. Input: template ID (default: drake), top line, optional bottom line, optional middle line (for 3-line templates like panik-kalm-panik). Popular templates: drake, buzz (X Everywhere), fry, fine (This Is Fine), success, panik-kalm-panik, boat (I Should Buy a Boat), aag (Ancient Aliens), blb (Bad Luck Brian). $0.005/call — free upstream, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        description:
          "Meme template ID. Popular options: drake, buzz, fry, fine, success, panik-kalm-panik, boat, aag, bad, blb, yuno. Call /cap/list-templates (free) for the full 211. Default: drake.",
        default: "drake",
      },
      top: {
        type: "string",
        description: "Top / first line text. Required.",
      },
      bottom: {
        type: "string",
        description: "Bottom / second line text. Optional.",
        default: "",
      },
      middle: {
        type: "string",
        description:
          "Middle / third line text. Only used if the template has 3+ lines (e.g. panik-kalm-panik). Ignored otherwise.",
        default: "",
      },
      width: {
        type: "integer",
        description: "Output image width in pixels (100–800). Default 600.",
        default: 600,
        minimum: 100,
        maximum: 800,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      image_url:      { type: "string", description: "Direct PNG URL (stable, cacheable)." },
      image_url_jpg:  { type: "string", description: "JPEG variant (smaller file size)." },
      embed_markdown: { type: "string", description: "Ready-to-paste Markdown image embed." },
      template_id:    { type: "string", description: "Template ID used." },
      template_name:  { type: "string", description: "Human-readable template name." },
      template_lines: { type: "integer", description: "Number of text lines this template supports." },
      ts:             { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const template   = (query.template || "drake").toLowerCase().trim();
    const topText    = String(query.top    || "").trim();
    const bottomText = String(query.bottom || "").trim();
    const middleText = String(query.middle || "").trim();
    const width      = Math.min(Math.max(parseInt(query.width || 600, 10), 100), 800);

    if (!topText) throw new Error("top text is required");

    const infoResp = await fetch(`${BASE}/templates/${template}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!infoResp.ok) {
      throw new Error(
        `unknown template '${template}' (HTTP ${infoResp.status}). Check ${BASE}/templates for valid IDs.`
      );
    }
    const info = await infoResp.json();
    const lines = info.lines || 2;

    const parts = [encodeText(topText)];
    if (lines >= 2) parts.push(encodeText(bottomText || " "));
    if (lines >= 3) parts.push(encodeText(middleText || " "));

    const path          = `${template}/${parts.join("/")}`;
    const image_url     = `${BASE}/images/${path}.png?width=${width}`;
    const image_url_jpg = `${BASE}/images/${path}.jpg?width=${width}`;
    const altText       = [topText, bottomText].filter(Boolean).join(" / ");
    const embed_markdown = `![${info.name}: ${altText}](${image_url})`;

    return {
      image_url,
      image_url_jpg,
      embed_markdown,
      template_id:    template,
      template_name:  info.name || template,
      template_lines: lines,
      ts:             new Date().toISOString(),
    };
  },
};
