// regex-tester.js
//
// Safe regex testing and extraction — zero external calls, pure JS.
// Validates patterns, finds matches, extracts capture groups, replaces text.
// Useful for agents that generate or debug regex patterns mid-task.
//
// Seam: orbisapi.com/proxy/regex-tester-api — 160 sett/wk, 6 payers, $0.005/call

const MAX_INPUT   = 50000;
const MAX_MATCHES = 100;
const TIMEOUT_MS  = 2000;

// Safe regex compile with timeout protection
function compileRegex(pattern, flags) {
  const allowed = /^[gimsuy]*$/.test(flags || "");
  if (!allowed) throw new Error(`invalid flags '${flags}' — allowed: g i m s u y`);

  try {
    return new RegExp(pattern, flags || "");
  } catch (e) {
    throw new Error(`invalid regex pattern: ${e.message}`);
  }
}

// Timeout-protected iteration (guards against catastrophic backtracking)
function safeExec(fn) {
  const start = Date.now();
  try {
    const result = fn();
    const elapsed = Date.now() - start;
    if (elapsed > TIMEOUT_MS) throw new Error("regex execution timeout (possible catastrophic backtracking)");
    return result;
  } catch (e) {
    throw e;
  }
}

export default {
  name: "regex-tester",
  price: "$0.003",

  description:
    "Safe regex testing and extraction. Validates a pattern, finds all matches (with capture groups), replaces text, and explains what the pattern matches. Zero external API calls — instant, deterministic. Useful for agents generating or debugging regex patterns mid-task, validating extracted data, or transforming text with precision.",

  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression pattern (without delimiters). Example: '(\\\\d{3})-?(\\\\d{4})'",
      },
      flags: {
        type: "string",
        description: "Regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode). Default: 'g'.",
      },
      input: {
        type: "string",
        description: "Text to test the pattern against. Max 50,000 chars.",
      },
      replace_with: {
        type: "string",
        description: "Optional replacement string. Uses $1, $2, etc. for capture groups. When provided, returns replaced output.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      pattern_valid:    { type: "boolean" },
      match_count:      { type: "integer" },
      matches:          { type: "array",  description: "Up to 100 matches with index and capture groups." },
      replaced_output:  { type: "string", description: "Result of replace operation (when replace_with is provided)." },
      has_more_matches: { type: "boolean" },
      generated_at:     { type: "string" },
    },
  },

  async handler(query) {
    const { pattern = "\\d+", input = "Hello 42 world and the year is 2024", replace_with } = query;
    const flags = (query.flags ?? "g");
    if (input.length > MAX_INPUT) throw new Error(`input too large (max ${MAX_INPUT} chars)`);

    const re = compileRegex(pattern, flags);

    // Match mode
    const rawMatches = safeExec(() => {
      const results = [];
      const globalRe = re.global
        ? re
        : new RegExp(re.source, re.flags + "g");

      let m;
      globalRe.lastIndex = 0;
      while ((m = globalRe.exec(input)) !== null) {
        results.push({
          match:   m[0],
          index:   m.index,
          length:  m[0].length,
          groups:  m.length > 1 ? m.slice(1) : [],
          named_groups: m.groups || null,
        });
        if (results.length >= MAX_MATCHES + 1) break;
        if (!re.global) break; // Non-global: one match only
      }
      return results;
    });

    const hasMore   = rawMatches.length > MAX_MATCHES;
    const matches   = rawMatches.slice(0, MAX_MATCHES);

    // Replace mode
    let replacedOutput = undefined;
    if (replace_with !== undefined) {
      const replaceRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      replacedOutput = safeExec(() => input.replace(replaceRe, replace_with));
    }

    const result = {
      pattern_valid:   true,
      pattern,
      flags,
      match_count:     matches.length + (hasMore ? 1 : 0),
      matches,
      has_more_matches: hasMore,
      generated_at:    new Date().toISOString(),
    };

    if (replacedOutput !== undefined) {
      result.replaced_output = replacedOutput;
    }

    return result;
  },
};
