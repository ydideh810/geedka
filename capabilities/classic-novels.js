// classic-novels.js
//
// Looks up classic literature by title, author, or ISBN via Open Library.
// Returns full metadata: publication year, subjects/genres, page count,
// languages, cover image URL, and direct links to read online (Project Gutenberg).
//
// Seam: orbisapi.com/proxy/classic-novels-guide — 456 sett/wk, 3 payers, $0.005/call
//
// Upstream: openlibrary.org — Internet Archive / Open Library, free, no auth.

const OL_SEARCH  = "https://openlibrary.org/search.json";
const OL_WORKS   = "https://openlibrary.org";
const GUTENBERG  = "https://www.gutenberg.org/ebooks/search/?query=";
const TIMEOUT    = 18000;
const UA         = "the-stall/3.23 (https://intuitek.ai)";

async function searchBooks(params) {
  const url  = `${OL_SEARCH}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`Open Library HTTP ${resp.status}`);
  return resp.json();
}

function shapebook(doc) {
  const key        = doc.key || null;
  const coverBase  = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}` : null;
  const olUrl      = key ? `${OL_WORKS}${key}` : null;
  const gutUrl     = doc.title ? `${GUTENBERG}${encodeURIComponent(doc.title)}` : null;

  return {
    key,
    title:              doc.title         || null,
    authors:            doc.author_name   || [],
    first_published:    doc.first_publish_year || null,
    edition_count:      doc.edition_count || null,
    page_count:         doc.number_of_pages_median || null,
    languages:          (doc.language || []).slice(0, 5),
    subjects:           (doc.subject || []).slice(0, 10),
    subject_places:     (doc.subject_place || []).slice(0, 5),
    subject_times:      (doc.subject_time || []).slice(0, 5),
    isbn:               (doc.isbn || []).slice(0, 3),
    oclc:               (doc.oclc || []).slice(0, 2),
    ia_identifier:      (doc.ia || []).slice(0, 1)[0] || null,
    cover_sm:           coverBase ? `${coverBase}-S.jpg` : null,
    cover_md:           coverBase ? `${coverBase}-M.jpg` : null,
    cover_lg:           coverBase ? `${coverBase}-L.jpg` : null,
    open_library_url:   olUrl,
    gutenberg_search_url: gutUrl,
    read_online:        doc.ia ? `https://archive.org/details/${doc.ia[0]}` : null,
  };
}

export default {
  name: "classic-novels",
  price: "$0.014",

  description:
    "Looks up classic and contemporary books by title, author, or ISBN via Open Library (748M+ editions). Returns publication year, subjects/genres, page count, cover images, and links to read online via Project Gutenberg or Internet Archive. Useful for research agents, reading recommendation workflows, literature analysis, and bibliographic data enrichment.",

  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Book title to search (e.g. 'Pride and Prejudice', 'Moby-Dick').",
      },
      author: {
        type: "string",
        description: "Author name to search (e.g. 'Jane Austen', 'Herman Melville').",
      },
      isbn: {
        type: "string",
        description: "ISBN-10 or ISBN-13 for exact lookup.",
      },
      subject: {
        type: "string",
        description: "Subject/genre filter (e.g. 'science fiction', 'philosophy', 'Victorian literature').",
      },
      limit: {
        type: "integer",
        description: "Max results (default 5, max 20).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      books:        { type: "array",   description: "Matched books with full metadata." },
      count:        { type: "integer" },
      total_found:  { type: "integer" },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    if (!query.title && !query.author && !query.isbn && !query.subject) {
      query.title = "Pride and Prejudice";
    }

    const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 5), 20);
    const params = {
      limit,
      fields: "key,title,author_name,first_publish_year,edition_count,number_of_pages_median,subject,subject_place,subject_time,language,isbn,oclc,ia,cover_i",
    };

    if (query.isbn) {
      params.isbn = query.isbn.replace(/[^0-9X]/gi, "");
    } else {
      const qParts = [];
      if (query.title)   qParts.push(query.title);
      if (query.author)  { params.author = query.author; }
      if (query.subject) params.subject  = query.subject;
      if (qParts.length) params.q = qParts.join(" ");
      else if (!params.author && !params.subject) {
        throw new Error("search requires 'title', 'author', 'isbn', or 'subject'");
      } else if (!params.q) {
        params.q = "*";
      }
    }

    const data  = await searchBooks(params);
    const docs  = (data.docs || []).slice(0, limit);
    const total = data.numFound || docs.length;

    return {
      books:        docs.map(shapebook),
      count:        docs.length,
      total_found:  total,
      generated_at: new Date().toISOString(),
    };
  },
};
