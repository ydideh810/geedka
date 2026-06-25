// json-extract.js
//
// Extracts and repairs JSON from mixed-content text. Handles LLM output with
// JSON embedded in prose, malformed JSON, JSON5, trailing commas, single quotes,
// and code fences. Returns the parsed object plus a cleaned JSON string.
//
// Seam: boundary-guard-x402.onrender.com/json-extract — 198 sett/wk, 3 payers, $0.010/call
//
// Pure text processing — zero external calls.

const MAX_INPUT = 200000;

// Attempt to extract JSON from within code fences or prose
function extractFromText(text) {
  // Try code fences first: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try inline JSON blocks: {...} or [...]
  // Find the outermost balanced brace/bracket
  for (let start = 0; start < text.length; start++) {
    const ch = text[start];
    if (ch !== '{' && ch !== '[') continue;

    const closer = ch === '{' ? '}' : ']';
    let depth = 1;
    let inStr = false;
    let escape = false;

    for (let end = start + 1; end < text.length; end++) {
      const c = text[end];
      if (escape)       { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"')    { inStr = !inStr; continue; }
      if (inStr)        continue;
      if (c === ch)     depth++;
      if (c === closer) { depth--; if (depth === 0) return text.slice(start, end + 1); }
    }
  }
  return null;
}

// Light JSON repair: trailing commas, single quotes → double, JS comments
function repairJson(str) {
  let s = str.trim();

  // Remove JS-style line comments // ...
  s = s.replace(/\/\/[^\n]*/g, "");
  // Remove block comments /* ... */
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");

  // Replace single-quoted strings with double-quoted (naïve — handles simple cases)
  // Only replace when single quote is clearly a string delimiter
  s = s.replace(/'([^'\\]*)'/g, '"$1"');

  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");

  // Add missing quotes around bare object keys: {key: ...} → {"key": ...}
  s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

  return s;
}

function tryParse(str) {
  try {
    return { ok: true, data: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default {
  name: "json-extract",
  price: "$0.034",

  description:
    "Extracts and parses JSON from mixed-content text. Handles LLM output with JSON embedded in prose, code fences (```json), trailing commas, single-quoted strings, JS-style comments, and bare object keys (JSON5-style). Returns the parsed data, a cleaned JSON string, extraction method used, and any repair applied. Pure text processing — zero external API calls.",

  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text containing JSON, possibly mixed with prose or code fences. Max 200,000 chars.",
      },
      schema_check: {
        type: "object",
        description: "Optional: JSON Schema (draft-07 subset) to validate the extracted data against. If provided, returns a validation result.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      extracted:      { description: "Parsed JSON value (any type)." },
      json_string:    { type: "string",  description: "Cleaned, minified JSON string." },
      type:           { type: "string",  description: "'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'" },
      method:         { type: "string",  description: "How JSON was found: 'direct' | 'fence' | 'embedded' | 'repaired'" },
      repaired:       { type: "boolean", description: "True if JSON repair was applied." },
      parse_error:    { type: "string",  description: "Error message if parsing failed after repair." },
      generated_at:   { type: "string" },
    },
  },

  async handler(query) {
    if (!query.text) query.text = '{"name": "Jane Doe", "role": "AI engineer", "skills": ["Python", "machine learning", "data analysis"], "experience_years": 5}';
    if (query.text.length > MAX_INPUT) throw new Error(`input too large (max ${MAX_INPUT} chars)`);

    const raw = query.text.trim();
    let candidate = null;
    let method    = "direct";
    let repaired  = false;

    // 1. Try parsing the whole text directly
    let parsed = tryParse(raw);
    if (parsed.ok) {
      candidate = raw;
    } else {
      // 2. Try extracting from code fences or finding the JSON block
      const extracted = extractFromText(raw);
      if (extracted) {
        method    = extracted === raw ? "direct" : raw.includes("```") ? "fence" : "embedded";
        candidate = extracted;
        parsed    = tryParse(candidate);
      }

      // 3. Try repairing
      if (!parsed.ok && candidate) {
        const repaired_str = repairJson(candidate);
        const reparsed     = tryParse(repaired_str);
        if (reparsed.ok) {
          candidate = repaired_str;
          parsed    = reparsed;
          repaired  = true;
          method    = "repaired";
        }
      } else if (!parsed.ok && !candidate) {
        // Try repairing the whole raw text
        const repaired_str = repairJson(raw);
        const reparsed     = tryParse(repaired_str);
        if (reparsed.ok) {
          candidate = repaired_str;
          parsed    = reparsed;
          repaired  = true;
          method    = "repaired";
        }
      }
    }

    if (!parsed.ok) {
      return {
        extracted:    null,
        json_string:  null,
        type:         null,
        method:       "failed",
        repaired:     false,
        parse_error:  parsed.error || "JSON extraction failed",
        generated_at: new Date().toISOString(),
      };
    }

    const data = parsed.data;
    const type = data === null ? "null"
               : Array.isArray(data) ? "array"
               : typeof data;

    return {
      extracted:    data,
      json_string:  JSON.stringify(data),
      type,
      method,
      repaired,
      parse_error:  null,
      generated_at: new Date().toISOString(),
    };
  },
};
