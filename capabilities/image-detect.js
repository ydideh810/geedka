// image-detect.js
//
// Detects the true image format of a URL via magic byte inspection.
// Works even when the file extension or Content-Type lies (common with
// proxied/CDN-hosted images). Returns format, MIME type, content-type
// match flag, file size, and basic dimensions where readable from header bytes.
//
// Seam: api.x402node.dev/image/detect — 20 unique payers, 44 settlements/7d,
// $0.050/call. STALL prices at $0.040 (20% below).
//
// Upstream cost: zero — pure fetch + byte inspection, no external API.

const UA = "Mozilla/5.0 (compatible; the-stall/0.4; +https://intuitek.ai)";

// Magic byte signatures [offset, bytes, format, mime]
const MAGIC = [
  [0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "png", "image/png"],
  [0, [0xff, 0xd8, 0xff],                                 "jpeg", "image/jpeg"],
  [0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],               "gif", "image/gif"],
  [0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],               "gif", "image/gif"],
  [0, [0x42, 0x4d],                                        "bmp", "image/bmp"],
  [0, [0x49, 0x49, 0x2a, 0x00],                            "tiff", "image/tiff"],
  [0, [0x4d, 0x4d, 0x00, 0x2a],                            "tiff", "image/tiff"],
  [0, [0x00, 0x00, 0x01, 0x00],                            "ico", "image/x-icon"],
  [0, [0x00, 0x00, 0x02, 0x00],                            "cur", "image/x-win-bitmap"],
  // WebP: RIFF at 0, WEBP at 8
  [8, [0x57, 0x45, 0x42, 0x50],                            "webp", "image/webp"],
  // AVIF/HEIC: ftyp box at offset 4
  [4, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],   "avif", "image/avif"],
  [4, [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],   "heic", "image/heic"],
  // PDF (just in case)
  [0, [0x25, 0x50, 0x44, 0x46],                            "pdf", "application/pdf"],
];

function detectFormat(buf) {
  const bytes = new Uint8Array(buf);
  // Also check for RIFF container (WebP)
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;

  for (const [offset, sig, format, mime] of MAGIC) {
    if (offset === 8 && !isRiff) continue;
    if (bytes.length < offset + sig.length) continue;
    if (sig.every((b, i) => bytes[offset + i] === b)) {
      return { format, mime };
    }
  }

  // SVG: check for text content
  const text = Buffer.from(bytes.slice(0, 256)).toString("utf8", 0, 256);
  if (text.trimStart().startsWith("<svg") || text.trimStart().startsWith("<?xml")) {
    return { format: "svg", mime: "image/svg+xml" };
  }

  return { format: "unknown", mime: null };
}

function readPngDimensions(buf) {
  // PNG: width at bytes 16-19, height at 20-23 (big-endian)
  const b = new DataView(buf.buffer || Buffer.from(buf).buffer, buf.byteOffset);
  if (buf.length < 24) return null;
  try {
    return {
      width:  b.getUint32(16, false),
      height: b.getUint32(20, false),
    };
  } catch { return null; }
}

function readJpegDimensions(bytes) {
  // Scan JPEG markers for SOF0/SOF2 (0xFFC0, 0xFFC2)
  let i = 2;
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((marker & 0xf0) === 0xc0 && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 < bytes.length) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width:  (bytes[i + 7] << 8) | bytes[i + 8],
        };
      }
    }
    i += 2 + segLen;
  }
  return null;
}

export default {
  name: "image-detect",
  price: "$0.050",

  description:
    "Detects the true image format of any URL via magic byte inspection — works even when the file extension or Content-Type header lies (common with proxied or CDN-hosted images). Returns: format (png/jpeg/gif/webp/avif/bmp/tiff/svg/ico/unknown), detected MIME type, whether Content-Type header matches, file size (bytes), and pixel dimensions for PNG and JPEG. No API key required. $0.040/call — 20% below x402node.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL of the image to inspect. Must be publicly accessible. HTTP or HTTPS.",
      },
    },
    required: ["url"],
  },

  outputSchema: {
    type: "object",
    properties: {
      url:                  { type: "string" },
      format:               { type: "string" },
      detected_mime:        { type: ["string", "null"] },
      content_type_header:  { type: ["string", "null"] },
      content_type_match:   { type: ["boolean", "null"] },
      file_size_bytes:      { type: ["integer", "null"] },
      dimensions:           { type: ["object", "null"] },
      bytes_inspected:      { type: "integer" },
      note:                 { type: ["string", "null"] },
    },
  },

  async handler({ url }) {
    // Basic URL validation
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "invalid_url", message: "Provide a valid http:// or https:// URL." };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { error: "unsupported_protocol", message: "Only http and https URLs are supported." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, "Range": "bytes=0-511" },
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (err) {
      clearTimeout(timer);
      return { error: "fetch_failed", message: err.message };
    }

    const contentType    = response.headers.get("content-type") || null;
    const contentLength  = response.headers.get("content-length");
    const fileSizeBytes  = contentLength ? parseInt(contentLength, 10) : null;

    // Read first 512 bytes
    let bodyBuf;
    try {
      const arrBuf = await response.arrayBuffer();
      bodyBuf = Buffer.from(arrBuf);
    } catch (err) {
      clearTimeout(timer);
      return { error: "read_failed", message: err.message };
    } finally {
      clearTimeout(timer);
    }

    const slice = new Uint8Array(bodyBuf.slice(0, 512));
    const { format, mime } = detectFormat(slice);

    // Check content-type match
    const ctMatch = mime !== null && contentType !== null
      ? contentType.toLowerCase().includes(mime.toLowerCase().split("/")[1])
      : null;

    // Attempt dimension extraction for common formats
    let dimensions = null;
    if (format === "png" && slice.length >= 24) {
      dimensions = readPngDimensions(slice);
    } else if (format === "jpeg") {
      dimensions = readJpegDimensions(slice);
    }

    return {
      url,
      format,
      detected_mime: mime,
      content_type_header: contentType,
      content_type_match: ctMatch,
      file_size_bytes: fileSizeBytes,
      dimensions,
      bytes_inspected: slice.length,
      note: format === "unknown"
        ? "Could not identify format from first 512 bytes. File may be truncated, text, or a non-image resource."
        : null,
    };
  },
};
