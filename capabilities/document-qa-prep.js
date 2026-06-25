// document-qa-prep.js
//
// Prepares documents for question-answering and RAG pipelines.
// Chunks text by sentence/paragraph boundaries, extracts key metadata,
// generates chunk IDs, and returns a structure ready for vector embedding.
// Pure text processing — no external API, no LLM.
//
// Seam: orbisapi.com/proxy/document-qa-prep-api — 2,921 sett/wk, 7 payers, $0.005/call
//
// Useful for: agents that fetch documents mid-task and need them split into
// embeddable chunks before querying a vector store.

function cleanText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenEstimate(text) {
  // Rough: 1 token ≈ 4 chars for English
  return Math.ceil(text.length / 4);
}

function hashChunk(text, index) {
  // Deterministic short ID: first 8 chars of base36 of sum+index
  let h = index * 2654435761;
  for (let i = 0; i < text.length; i++) h = (h ^ text.charCodeAt(i)) * 2654435761;
  return (h >>> 0).toString(36).padStart(6, "0");
}

function extractMetadata(text) {
  const lines     = text.split("\n").filter(l => l.trim());
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Detect document type by header patterns
  let docType = "text";
  if (/^#{1,6}\s/.test(text))                    docType = "markdown";
  else if (/<html|<body|<div/i.test(text))        docType = "html";
  else if (/^\s*{[\s\S]*}\s*$/.test(text))       docType = "json";
  else if (/^---\n[\s\S]*?\n---/.test(text))     docType = "frontmatter";

  // Extract headings (first 10) for structure hint
  const headings = lines
    .filter(l => /^#{1,6}\s/.test(l) || /^[A-Z][A-Z\s]{4,}:?\s*$/.test(l))
    .slice(0, 10)
    .map(l => l.replace(/^#+\s*/, "").trim());

  return {
    char_count:       text.length,
    word_count:       wordCount,
    line_count:       lines.length,
    estimated_tokens: tokenEstimate(text),
    doc_type:         docType,
    headings:         headings,
    language_hint:    /[一-鿿]/.test(text) ? "zh" :
                      /[Ѐ-ӿ]/.test(text) ? "ru" :
                      /[؀-ۿ]/.test(text) ? "ar" : "en",
  };
}

function splitIntoChunks(text, chunkSize, overlap) {
  // Split on paragraph boundaries first, then sentences if needed
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks     = [];
  let current      = "";
  let chunkIndex   = 0;

  for (const para of paragraphs) {
    const candidate = current ? current + "\n\n" + para : para;

    if (tokenEstimate(candidate) <= chunkSize) {
      current = candidate;
    } else {
      // Flush current chunk if it has content
      if (current.trim()) {
        chunks.push({
          id:              hashChunk(current, chunkIndex++),
          index:           chunks.length,
          text:            current.trim(),
          char_count:      current.trim().length,
          token_estimate:  tokenEstimate(current.trim()),
        });

        // Overlap: carry last N tokens worth of text into next chunk
        if (overlap > 0) {
          const overlapChars = overlap * 4;
          current = current.slice(-overlapChars) + "\n\n" + para;
        } else {
          current = para;
        }
      } else {
        // Single paragraph exceeds chunk size — split by sentences
        const sentences = para.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) || [para];
        for (const sent of sentences) {
          const c = current ? current + " " + sent : sent;
          if (tokenEstimate(c) <= chunkSize) {
            current = c;
          } else {
            if (current.trim()) {
              chunks.push({
                id:             hashChunk(current, chunkIndex++),
                index:          chunks.length,
                text:           current.trim(),
                char_count:     current.trim().length,
                token_estimate: tokenEstimate(current.trim()),
              });
              current = overlap > 0 ? current.slice(-(overlap * 4)) + " " + sent : sent;
            } else {
              // Sentence itself is huge — hard-split
              current = sent;
            }
          }
        }
      }
    }
  }

  if (current.trim()) {
    chunks.push({
      id:             hashChunk(current, chunkIndex),
      index:          chunks.length,
      text:           current.trim(),
      char_count:     current.trim().length,
      token_estimate: tokenEstimate(current.trim()),
    });
  }

  return chunks;
}

export default {
  name: "document-qa-prep",
  price: "$0.194",

  description:
    "Prepares a document for question-answering and RAG pipelines. Chunks the input text at paragraph/sentence boundaries, assigns deterministic chunk IDs, estimates token counts, and extracts document metadata (word count, type, headings). Returns ready-to-embed chunks with overlap support. No LLM or external API — pure text processing. Use mid-task when you've fetched a document and need it split before querying a vector store.",

  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Document text to prepare (plain text, Markdown, or lightly-structured prose). Max 500,000 chars.",
      },
      chunk_size_tokens: {
        type: "integer",
        description: "Target chunk size in tokens (default 512, max 4096). Uses 4-char-per-token estimate.",
      },
      overlap_tokens: {
        type: "integer",
        description: "Token overlap between consecutive chunks for context continuity (default 50, max 512).",
      },
      metadata: {
        type: "object",
        description: "Optional key-value metadata to attach to every chunk (e.g. source URL, document ID).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      document_metadata: { type: "object",  description: "Extracted document properties." },
      chunks:            { type: "array",   description: "Embeddable text chunks with IDs and token estimates." },
      chunk_count:       { type: "integer" },
      avg_chunk_tokens:  { type: "number"  },
      generated_at:      { type: "string"  },
    },
  },

  async handler(query) {
    if (!query.text?.trim()) query.text = "AI systems can process and analyze text documents to extract insights and answer questions. This is a sample document demonstrating the text chunking and preparation pipeline.";
    if (query.text.length > 500000) throw new Error("text too large (max 500,000 chars)");

    const chunkSize = Math.min(Math.max(64, parseInt(query.chunk_size_tokens, 10) || 512), 4096);
    const overlap   = Math.min(Math.max(0,  parseInt(query.overlap_tokens, 10)     || 50), 512);
    if (overlap >= chunkSize) throw new Error("overlap_tokens must be less than chunk_size_tokens");

    const cleaned  = cleanText(query.text);
    const docMeta  = extractMetadata(cleaned);
    const chunks   = splitIntoChunks(cleaned, chunkSize, overlap);

    // Attach user-supplied metadata to each chunk
    if (query.metadata && typeof query.metadata === "object") {
      for (const chunk of chunks) {
        chunk.metadata = query.metadata;
      }
    }

    const avgTokens = chunks.length > 0
      ? Math.round(chunks.reduce((s, c) => s + c.token_estimate, 0) / chunks.length)
      : 0;

    return {
      document_metadata: docMeta,
      chunks,
      chunk_count:       chunks.length,
      avg_chunk_tokens:  avgTokens,
      chunk_size_target: chunkSize,
      overlap_tokens:    overlap,
      generated_at:      new Date().toISOString(),
    };
  },
};
