// roast.js
//
// AI-generated witty roast of any target (person, company, product, code, or topic).
// Returns 3-5 sentences of sharp, clever humor.
//
// Seam: api.anchor-x402.com/v1/roast — 31 payers, $0.159/call (7d).
// MYRIAD prices at $0.125. Upstream cost: ~$0.0003 (gpt-4o-mini).
//
// Upstream: OpenAI gpt-4o-mini via OPENAI_API_KEY.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const TIMEOUT    = 18_000;

const STYLE_GUIDE = {
  dry:       "deadpan, understated wit, minimalist punchlines, British sensibility",
  savage:    "sharp and cutting — no mercy but keep it clever, not mean-spirited",
  sarcastic: "heavy sarcasm, backhanded compliments, ironic praise",
  gentle:    "affectionate ribbing, light teasing, warm but pointed",
};

export default {
  name: "roast",

  price: "$0.125",

  description:
    "Witty AI roast of any target — person, company, product, code snippet, or concept. " +
    "Returns 3-5 sentences of sharp, clever humor. Style: dry (default), savage, sarcastic, or gentle. " +
    "75% below anchor-x402.com/v1/roast.",

  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "What to roast: a name, company, product, code snippet, or brief description (max 500 chars).",
      },
      style: {
        type: "string",
        enum: ["dry", "savage", "sarcastic", "gentle"],
        description: "Roast style. Default: dry.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      roast:  { type: "string", description: "The roast (3-5 sentences)." },
      target: { type: "string" },
      style:  { type: "string" },
    },
  },

  async handler(query) {
    const { target = "spreadsheets", style = "dry" } = query;
    const trimmed = target.trim().slice(0, 500);

    const styleDesc = STYLE_GUIDE[style] || STYLE_GUIDE.dry;
    const prompt =
      `You are a professional roast writer. Write exactly 3-5 sentences roasting the following target.\n` +
      `Style: ${styleDesc}.\n` +
      `Rules: witty and clever; no profanity; no slurs; be specific to the target; end with a punchline.\n\n` +
      `Target: "${trimmed}"\n\n` +
      `Respond with only the roast text — no preamble, no labels.`;

    const resp = await fetch(OPENAI_URL, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:      MODEL,
        messages:   [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const data  = await resp.json();
    const roast = data.choices?.[0]?.message?.content?.trim();
    if (!roast) throw new Error("No roast generated");

    return { roast, target: trimmed, style };
  },
};
