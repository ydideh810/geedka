// breadcrumb-extractor.js
//
// Extracts structured breadcrumb navigation from a URL path.
// Returns domain, path segments, query parameters, and a human-readable
// breadcrumb trail. Pure URL parsing — zero external calls.
//
// Seam: orbisapi.com/proxy/breadcrumb-extractor-api — 222 sett/wk, 9 payers, $0.050/call

function titleCase(str) {
  return str
    .replace(/[-_+]/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
}

function cleanSegment(seg) {
  // Strip file extension
  return seg.replace(/\.[a-z0-9]{1,6}$/i, "");
}

function isNumericId(seg) {
  return /^\d+$/.test(seg) || /^[0-9a-f-]{8,36}$/i.test(seg);
}

function formatSegment(seg) {
  const clean = cleanSegment(decodeURIComponent(seg));
  if (isNumericId(clean)) return { raw: seg, label: `#${clean}`, type: "id" };
  return { raw: seg, label: titleCase(clean), type: "path" };
}

export default {
  name: "breadcrumb-extractor",
  price: "$0.003",

  description:
    "Extracts structured breadcrumb navigation from a URL. Returns domain, ordered path segments with human-readable labels, query parameters as key-value pairs, and a formatted breadcrumb trail string. Identifies numeric IDs vs. named path segments. Pure URL parsing — zero external calls. Useful for agents that process sitemaps, navigation menus, or need to understand page hierarchy.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL to extract breadcrumbs from (e.g. 'https://docs.example.com/api/v2/users/123/profile').",
      },
      separator: {
        type: "string",
        description: "Breadcrumb separator string (default: ' > ').",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:             { type: "string" },
      protocol:        { type: "string" },
      domain:          { type: "string" },
      subdomain:       { type: "string"  },
      path:            { type: "string" },
      segments:        { type: "array",  description: "Ordered path segments with labels." },
      breadcrumb_trail: { type: "string", description: "Formatted breadcrumb string." },
      query_params:    { type: "object",  description: "Query string parameters as key-value pairs." },
      fragment:        { type: "string"  },
      depth:           { type: "integer", description: "Path depth (number of segments)." },
      generated_at:    { type: "string" },
    },
  },

  async handler(query) {
    if (!query.url?.trim()) throw new Error("'url' is required");

    let rawUrl = query.url.trim();
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      rawUrl = "https://" + rawUrl;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_) {
      throw new Error(`invalid URL: '${query.url}'`);
    }

    const sep       = query.separator || " > ";
    const hostname  = parsed.hostname;
    const parts     = hostname.split(".");
    const subdomain = parts.length > 2 ? parts.slice(0, -2).join(".") : null;
    const domain    = parts.length > 2 ? parts.slice(-2).join(".") : hostname;

    // Parse path segments
    const rawSegments = parsed.pathname.split("/").filter(s => s.length > 0);
    const segments    = rawSegments.map(formatSegment);

    // Build breadcrumb trail
    const trailParts = [titleCase(domain.split(".")[0]), ...segments.map(s => s.label)];
    const trail      = trailParts.join(sep);

    // Parse query params
    const queryParams = {};
    parsed.searchParams.forEach((val, key) => { queryParams[key] = val; });

    return {
      url:              rawUrl,
      protocol:         parsed.protocol.replace(":", ""),
      domain,
      subdomain,
      path:             parsed.pathname,
      segments,
      breadcrumb_trail: trail,
      query_params:     Object.keys(queryParams).length > 0 ? queryParams : null,
      fragment:         parsed.hash ? parsed.hash.slice(1) : null,
      depth:            segments.length,
      generated_at:     new Date().toISOString(),
    };
  },
};
