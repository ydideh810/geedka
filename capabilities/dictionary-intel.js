// dictionary-intel.js
//
// English word lookup: definitions, phonetics, part of speech, synonyms,
// antonyms, and usage examples via the Free Dictionary API (no auth, no key).
//
// Free upstream: api.dictionaryapi.dev (open data).
// Useful for: writing agents, NLP pipelines, vocabulary tools, content
// generation, semantic similarity pre-flight, and educational bots.

const BASE    = "https://api.dictionaryapi.dev/api/v2/entries";
const UA      = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";
const TIMEOUT = 8_000;

function shapeMeaning(m) {
  const defs = (m.definitions ?? []).slice(0, 4).map(d => ({
    definition: d.definition ?? null,
    example:    d.example    ?? null,
    synonyms:   (d.synonyms  ?? []).slice(0, 5),
    antonyms:   (d.antonyms  ?? []).slice(0, 5),
  }));
  return {
    part_of_speech: m.partOfSpeech ?? null,
    definitions: defs,
    synonyms:    (m.synonyms ?? []).slice(0, 8),
    antonyms:    (m.antonyms ?? []).slice(0, 8),
  };
}

export default {
  name:  "dictionary-intel",
  price: "$0.001",

  description:
    "English word lookup: definitions (up to 4 per part of speech), phonetic transcription, audio pronunciation URL, synonyms, antonyms, and example sentences. Supports multiple parts of speech per word (noun, verb, adjective, etc.). Useful for writing agents, NLP preprocessing, vocabulary enrichment, content generation, and semantic pre-flight checks. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      word: {
        type: "string",
        description: "English word to look up (e.g. 'serendipity', 'run', 'ephemeral'). Single word or compound (e.g. 'machine learning').",
      },
      lang: {
        type: "string",
        default: "en",
        description: "Language code. Currently 'en' is best supported. Default: en.",
      },
    },
    required: ["word"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      word:       { type: "string" },
      phonetic:   { type: "string", description: "IPA phonetic transcription." },
      audio_url:  { type: "string", description: "MP3 pronunciation URL (when available)." },
      etymology:  { type: "string", description: "Word origin/etymology (when available)." },
      meanings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            part_of_speech: { type: "string" },
            definitions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  definition: { type: "string" },
                  example:    { type: "string" },
                  synonyms:   { type: "array", items: { type: "string" } },
                  antonyms:   { type: "array", items: { type: "string" } },
                },
              },
            },
            synonyms: { type: "array", items: { type: "string" } },
            antonyms: { type: "array", items: { type: "string" } },
          },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const word = String(input.word ?? "").trim().toLowerCase();
    const lang = String(input.lang ?? "en").toLowerCase().trim();

    if (!word) throw new Error("'word' is required");

    const url  = `${BASE}/${encodeURIComponent(lang)}/${encodeURIComponent(word)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (resp.status === 404) {
      return {
        word,
        phonetic:     null,
        audio_url:    null,
        etymology:    null,
        meanings:     [],
        not_found:    true,
        generated_at: new Date().toISOString(),
      };
    }
    if (!resp.ok) throw new Error(`Dictionary API HTTP ${resp.status}`);

    const data = await resp.json();
    if (!Array.isArray(data) || !data.length) {
      return { word, phonetic: null, audio_url: null, etymology: null, meanings: [], generated_at: new Date().toISOString() };
    }

    const entry = data[0];

    // Pick best phonetic + audio
    const phonetics = entry.phonetics ?? [];
    const phonetic  = phonetics.find(p => p.text)?.text ?? entry.phonetic ?? null;
    const audioUrl  = phonetics.find(p => p.audio && p.audio.startsWith("https"))?.audio ?? null;

    // Etymology (not always present — some entries embed it in first definition)
    const etymology = entry.origin ?? null;

    const meanings = (entry.meanings ?? []).slice(0, 6).map(shapeMeaning);

    return {
      word:         entry.word ?? word,
      phonetic,
      audio_url:    audioUrl,
      etymology,
      meanings,
      generated_at: new Date().toISOString(),
    };
  },
};
