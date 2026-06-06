// meme-generator.js
//
// Generate meme images from text using memegen.link (free, no API key).
// Seam signal: x402.ottoai.services/generate-meme had 358 settlements at
// $0.007/call — this cap undercuts at $0.005 with a cleaner interface.

const BASE_URL   = "https://api.memegen.link";
const TIMEOUT_MS = 12000;

// Encode text per memegen.link conventions
function encodeText(text) {
  if (!text || String(text).trim() === "") return "_";
  return String(text)
    .trim()
    .replace(/%/g,   "~p")
    .replace(/#/g,   "~h")
    .replace(/\?/g,  "~q")
    .replace(/\//g,  "~s")
    .replace(/ /g,   "_")
    .replace(/__/g,  "~u")  // double underscore literal
    .replace(/--/g,  "~d"); // double hyphen literal
}

// Keyword → template heuristics
const TOPIC_MAP = {
  choice:      "drake",
  prefer:      "drake",
  vs:          "drake",
  comparison:  "drake",
  upgrade:     "drake",
  instead:     "drake",
  everywhere:  "buzz",
  always:      "astronaut",
  spy:         "spy",
  distracted:  "distracted",
  money:       "fine",
  fire:        "fine",
  okay:        "fine",
  fine:        "fine",
  problem:     "fry",
  sure:        "fry",
  unsure:      "fry",
  success:     "success",
  win:         "success",
  excited:     "success",
  brain:       "brain",
  expand:      "brain",
  big:         "brain",
  plan:        "gru",
  backfire:    "gru",
  surprise:    "buzz",
  need:        "ants",
  want:        "ants",
  crypto:      "doge",
  meme:        "doge",
  wow:         "doge",
  free:        "oprah",
  get:         "oprah",
  giving:      "oprah",
  evil:        "evil",
  laugh:       "evil",
  picard:      "picard",
  why:         "picard",
  clown:       "clown",
  meeting:     "meeting",
  ai:          "terminator",
  robot:       "terminator",
  agent:       "morpheus",
  matrix:      "morpheus",
  reality:     "morpheus",
};

function selectTemplate(topic) {
  if (!topic) return "drake";
  const lc = topic.toLowerCase();
  for (const [kw, tmpl] of Object.entries(TOPIC_MAP)) {
    if (lc.includes(kw)) return tmpl;
  }
  return "drake";
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

export default {
  name:  "meme-generator",
  price: "$0.005",

  description:
    "Generate a meme image URL from text. Provide text_top and text_bottom (the two lines of the meme), and optionally a template name. If no template is given, supply a topic keyword and a fitting template will be chosen automatically. Returns a direct image URL you can embed in messages, posts, or web pages. 211 templates available including drake, doge, distracted, buzz, fry, success, gru, oprah, and more. Free upstream: memegen.link (no API key, unlimited requests). Common agent use cases: social media content generation, reaction images, marketing copy, presentation humor.",

  inputSchema: {
    type: "object",
    properties: {
      text_top: {
        type:        "string",
        description: "Top line of the meme (the setup or rejected option). Max 120 chars.",
        maxLength:   120,
      },
      text_bottom: {
        type:        "string",
        description: "Bottom line of the meme (the punchline or preferred option). Max 120 chars.",
        maxLength:   120,
      },
      template: {
        type:        "string",
        description: "Meme template ID. Examples: drake, doge, distracted, buzz, fry, gru, success, oprah, astronaut, brain, fine, picard. Omit to auto-select from topic.",
      },
      topic: {
        type:        "string",
        description: "Topic keyword used to auto-select a template when 'template' is omitted. Examples: 'choice', 'crypto', 'success', 'fire', 'ai'. Ignored if template is specified.",
      },
      style: {
        type:        "string",
        description: "Optional style variant (e.g. 'animated', 'dark', 'no'). Only supported by some templates. Defaults to template default.",
      },
      width: {
        type:        "integer",
        description: "Output image width in pixels. Defaults to 600.",
        minimum:     100,
        maximum:     1200,
      },
      height: {
        type:        "integer",
        description: "Output image height in pixels. Defaults to 450.",
        minimum:     100,
        maximum:     1200,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      image_url:     { type: "string",  description: "Direct URL to the generated meme image (JPEG)." },
      template_id:   { type: "string",  description: "Template ID used." },
      template_name: { type: "string",  description: "Human-readable template name." },
      text_top:      { type: "string",  description: "Actual top text rendered." },
      text_bottom:   { type: "string",  description: "Actual bottom text rendered." },
      width:         { type: "integer", description: "Image width in pixels." },
      height:        { type: "integer", description: "Image height in pixels." },
      format:        { type: "string",  description: "Image format (jpeg or gif for animated)." },
      ts:            { type: "string",  description: "ISO-8601 generation timestamp." },
    },
    required: ["image_url", "template_id"],
  },

  async handler(query) {
    const templateId = query.template || selectTemplate(query.topic || "");
    const topText    = query.text_top    || "";
    const bottomText = query.text_bottom || "";
    const w          = query.width  || 600;
    const h          = query.height || 450;

    // Fetch template metadata (name + valid styles)
    let templateName = templateId;
    let isAnimated   = false;
    let fmt          = "jpeg";
    try {
      const meta = await fetchJson(`${BASE_URL}/templates/${templateId}`);
      templateName = meta.name || templateId;
      const styles = Array.isArray(meta.styles) ? meta.styles : [];
      if (query.style && !styles.includes(query.style)) {
        throw new Error(
          `Style "${query.style}" not supported for template "${templateId}". Available: ${styles.join(", ") || "none"}`
        );
      }
      if ((query.style === "animated" || (!query.style && styles.includes("animated") && styles[0] === "animated"))) {
        isAnimated = false; // don't default to animated — caller opts in
      }
    } catch (err) {
      if (err.message.includes("HTTP 404")) {
        throw new Error(
          `Template "${templateId}" not found. Browse available templates at https://api.memegen.link/templates/`
        );
      }
      if (err.message.includes("Style")) throw err; // re-throw style errors
      // Non-critical — proceed with templateId as-is
    }

    const topEnc    = encodeText(topText);
    const bottomEnc = encodeText(bottomText);
    const ext       = isAnimated ? "gif" : "jpg";
    fmt             = isAnimated ? "gif" : "jpeg";

    // Construct the image URL
    let imageUrl = `${BASE_URL}/images/${templateId}/${topEnc}/${bottomEnc}.${ext}?width=${w}&height=${h}`;
    if (query.style) {
      imageUrl += `&style=${encodeURIComponent(query.style)}`;
    }

    return {
      image_url:     imageUrl,
      template_id:   templateId,
      template_name: templateName,
      text_top:      topText,
      text_bottom:   bottomText,
      width:         w,
      height:        h,
      format:        fmt,
      ts:            new Date().toISOString(),
    };
  },
};
