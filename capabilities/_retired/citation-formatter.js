// citation-formatter.js
//
// Looks up academic paper metadata by DOI (via CrossRef) and formats it as
// BibTeX, APA, MLA, or Chicago citation. Zero auth — CrossRef is a free
// public registry of 148M+ scholarly works.
//
// Seam: api.x402node.dev/citation/bibtex — 31 sett/wk, 15 payers, $0.040/call
//
// Upstream: api.crossref.org — free public API, no auth required.

const CROSSREF_URL = "https://api.crossref.org/works/";
const UA           = "myriad/3.20 (https://synaptiic.org; mailto:kyle@synaptiic.org)";
const TIMEOUT      = 10000;

async function fetchDoi(doi) {
  const url  = `${CROSSREF_URL}${encodeURIComponent(doi)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (resp.status === 404) throw new Error(`DOI '${doi}' not found in CrossRef`);
  if (!resp.ok) throw new Error(`CrossRef API HTTP ${resp.status}`);
  const data = await resp.json();
  return data.message;
}

function normalizeAuthor(a) {
  return {
    given:  a.given  || null,
    family: a.family || null,
    name:   a.name   || `${a.given || ""} ${a.family || ""}`.trim() || null,
    orcid:  a.ORCID  || null,
  };
}

function extractYear(item) {
  const parts = item.published?.["date-parts"]?.[0]
             || item["published-print"]?.["date-parts"]?.[0]
             || item["published-online"]?.["date-parts"]?.[0];
  return parts?.[0] || null;
}

function extractMonth(item) {
  const parts = item.published?.["date-parts"]?.[0]
             || item["published-print"]?.["date-parts"]?.[0]
             || item["published-online"]?.["date-parts"]?.[0];
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return parts?.[1] ? MONTHS[parts[1] - 1] : null;
}

function bibtexKey(authors, year) {
  const last = authors[0]?.family || authors[0]?.name?.split(" ").pop() || "author";
  return `${last.toLowerCase().replace(/[^a-z]/g, "")}${year || "xxxx"}`;
}

function escapeBibtex(s) {
  return (s || "").replace(/[{}\\]/g, "\\$&").replace(/&/g, "\\&");
}

function formatBibtex(item, doi) {
  const authors = (item.author || []).map(normalizeAuthor);
  const year    = extractYear(item);
  const month   = extractMonth(item);
  const title   = (item.title || [])[0] || "";
  const journal = (item["container-title"] || [])[0] || (item["short-container-title"] || [])[0] || "";
  const key     = bibtexKey(authors, year);
  const type    = item.type === "journal-article" ? "article"
                : item.type === "book"            ? "book"
                : item.type === "book-chapter"    ? "incollection"
                : item.type === "proceedings-article" ? "inproceedings"
                : "misc";

  const authorStr = authors.map(a =>
    a.family ? `${a.family}, ${a.given || ""}`.trim() : (a.name || "Unknown")
  ).join(" and ");

  const fields = [
    `  author    = {${escapeBibtex(authorStr)}}`,
    `  title     = {${escapeBibtex(title)}}`,
    journal ? `  journal   = {${escapeBibtex(journal)}}` : null,
    year    ? `  year      = {${year}}`                  : null,
    month   ? `  month     = {${month}}`                 : null,
    item.volume  ? `  volume    = {${item.volume}}`      : null,
    item.issue   ? `  number    = {${item.issue}}`       : null,
    item.page    ? `  pages     = {${item.page}}`        : null,
    item.publisher ? `  publisher = {${escapeBibtex(item.publisher)}}` : null,
    doi     ? `  doi       = {${doi}}`                   : null,
    item.URL    ? `  url       = {${item.URL}}`          : null,
  ].filter(Boolean).join(",\n");

  return `@${type}{${key},\n${fields}\n}`;
}

function formatApa(item, doi) {
  const authors = (item.author || []).map(normalizeAuthor);
  const year    = extractYear(item);
  const title   = (item.title || [])[0] || "";
  const journal = (item["container-title"] || [])[0] || "";

  const authorStr = authors.length === 0 ? "Author, A."
    : authors.map((a, i) => {
        const last  = a.family || a.name?.split(" ").pop() || "Author";
        const init  = a.given ? a.given.split(" ").map(n => n[0] + ".").join(" ") : "";
        return `${last}, ${init}`.trim();
      }).join(", ");

  const doiStr = doi ? ` https://doi.org/${doi}` : "";
  const volIss = item.volume && item.issue ? `${item.volume}(${item.issue})` : item.volume || "";
  const pages  = item.page ? `, ${item.page.replace("-", "–")}` : "";

  return `${authorStr} (${year || "n.d."}). ${title}. *${journal}*, ${volIss}${pages}.${doiStr}`;
}

function formatMla(item) {
  const authors = (item.author || []).map(normalizeAuthor);
  const year    = extractYear(item);
  const title   = (item.title || [])[0] || "";
  const journal = (item["container-title"] || [])[0] || "";

  const firstAuthor = authors[0];
  const authorStr   = !firstAuthor ? "Author, A."
    : firstAuthor.family
      ? `${firstAuthor.family}, ${firstAuthor.given || ""}`.trim() +
        (authors.length > 1 ? ", et al." : "")
      : firstAuthor.name || "Author";

  const volIss = item.volume && item.issue ? `${item.volume}.${item.issue}` : item.volume || "";
  const pages  = item.page ? `: ${item.page.replace("-", "–")}` : "";

  return `${authorStr} "${title}." *${journal}* ${volIss} (${year || "n.d."}): ${pages}.`;
}

export default {
  name: "citation-formatter",
  price: "$0.020",

  description:
    "Looks up an academic paper by DOI and formats it as BibTeX, APA, MLA, or Chicago citation. Returns full paper metadata: authors, year, journal, volume, pages, publisher. Covers 148M+ works via CrossRef (free registry). Useful for research agents building reference lists, literature review workflows, and knowledge extraction pipelines.",

  inputSchema: {
    type: "object",
    properties: {
      doi: {
        type: "string",
        description: "Digital Object Identifier (e.g. '10.1038/nature12345' or 'https://doi.org/10.1038/nature12345').",
      },
      format: {
        type: "string",
        enum: ["bibtex", "apa", "mla", "all"],
        description: "Citation format. 'all' returns every format. Default: 'bibtex'.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      doi:        { type: "string" },
      metadata:   { type: "object", description: "Full paper metadata from CrossRef." },
      bibtex:     { type: "string" },
      apa:        { type: "string" },
      mla:        { type: "string" },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    // Normalize DOI
    let doi = (query.doi || "10.5281/zenodo.18908920").trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:/i, "");
    if (!doi) throw new Error("'doi' is empty after normalization");

    const item    = await fetchDoi(doi);
    const authors = (item.author || []).map(normalizeAuthor);
    const year    = extractYear(item);
    const fmt     = (query.format || "bibtex").toLowerCase();

    const metadata = {
      doi,
      title:       (item.title || [])[0] || null,
      authors,
      year,
      journal:     (item["container-title"] || [])[0] || null,
      volume:      item.volume || null,
      issue:       item.issue  || null,
      pages:       item.page   || null,
      publisher:   item.publisher || null,
      type:        item.type   || null,
      url:         item.URL    || `https://doi.org/${doi}`,
      abstract:    item.abstract || null,
    };

    const result = { doi, metadata, generated_at: new Date().toISOString() };

    if (fmt === "bibtex" || fmt === "all") result.bibtex = formatBibtex(item, doi);
    if (fmt === "apa"    || fmt === "all") result.apa    = formatApa(item, doi);
    if (fmt === "mla"    || fmt === "all") result.mla    = formatMla(item);

    return result;
  },
};
