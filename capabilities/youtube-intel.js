// youtube-intel.js
//
// YouTube video metadata: title, author, description, view count, duration,
// upload date, thumbnail, tags, and categories.
//
// Seam: hirescrape.com/api/tools/youtube — 134 calls/day, 6 payers, $0.028/call.
// STALL prices at $0.008 — 71% below competitor.
// Upstream: yt-dlp (local binary, free) with YouTube oembed fallback.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const YTDLP     = "/home/aegis/.local/bin/yt-dlp";
const OEMBED    = "https://www.youtube.com/oembed";
const ID_RE     = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input) {
  if (!input) return null;
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (u.hostname === "youtu.be") {
      const m = u.pathname.match(/\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && ID_RE.test(v)) return v;
      const m = u.pathname.match(/\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch { /* fall through */ }
  return null;
}

function fmtDuration(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseUploadDate(d) {
  if (!d || d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

async function fetchYtdlp(videoId) {
  const { stdout } = await execFileAsync(
    YTDLP,
    ["--dump-json", "--no-download", "--no-warnings", "-q", "--no-playlist",
     `https://www.youtube.com/watch?v=${videoId}`],
    { timeout: 25000, encoding: "utf8" }
  );

  const d = JSON.parse(stdout);
  return {
    video_id:         d.id,
    title:            d.title ?? null,
    author:           d.uploader ?? d.channel ?? null,
    channel_url:      d.uploader_url ?? d.channel_url ?? null,
    description:      (d.description ?? "").slice(0, 2000) || null,
    duration_seconds: d.duration ?? null,
    duration_string:  fmtDuration(d.duration),
    view_count:       d.view_count ?? null,
    like_count:       d.like_count ?? null,
    upload_date:      parseUploadDate(d.upload_date),
    thumbnail:        d.thumbnail ?? null,
    tags:             Array.isArray(d.tags) ? d.tags.slice(0, 20) : [],
    categories:       Array.isArray(d.categories) ? d.categories : [],
    is_live:          d.is_live ?? false,
    url:              `https://www.youtube.com/watch?v=${videoId}`,
    source:           "yt-dlp",
  };
}

async function fetchOembed(videoId) {
  const target = `${OEMBED}?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  const resp = await fetch(target, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`oembed HTTP ${resp.status}`);
  const d = await resp.json();
  return {
    video_id:         videoId,
    title:            d.title ?? null,
    author:           d.author_name ?? null,
    channel_url:      d.author_url ?? null,
    description:      null,
    duration_seconds: null,
    duration_string:  null,
    view_count:       null,
    like_count:       null,
    upload_date:      null,
    thumbnail:        d.thumbnail_url ?? null,
    tags:             [],
    categories:       [],
    is_live:          false,
    url:              `https://www.youtube.com/watch?v=${videoId}`,
    source:           "oembed",
  };
}

export default {
  name:  "youtube-intel",
  price: "$0.012",

  description:
    "YouTube video metadata: title, author, description (2000-char cap), view count, duration, upload date, thumbnail URL, tags (20 max), and categories. Accepts any YouTube URL format or bare 11-character video ID. Uses yt-dlp for full metadata with YouTube oembed as fallback. $0.012/call.",

  inputSchema: {
    type: "object",
    properties: {
      video: {
        type: "string",
        description:
          "YouTube video URL (any format: watch?v=, youtu.be, /shorts/, /embed/) or bare 11-character video ID.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      video_id:         { type: "string",           description: "11-character YouTube video ID." },
      title:            { type: ["string", "null"],  description: "Video title." },
      author:           { type: ["string", "null"],  description: "Channel/uploader display name." },
      channel_url:      { type: ["string", "null"],  description: "Channel URL." },
      description:      { type: ["string", "null"],  description: "Video description (max 2000 chars)." },
      duration_seconds: { type: ["integer", "null"], description: "Duration in seconds." },
      duration_string:  { type: ["string", "null"],  description: 'Duration formatted as M:SS or H:MM:SS.' },
      view_count:       { type: ["integer", "null"], description: "Total view count." },
      like_count:       { type: ["integer", "null"], description: "Total likes (null if hidden by channel)." },
      upload_date:      { type: ["string", "null"],  description: "Upload date (YYYY-MM-DD)." },
      thumbnail:        { type: ["string", "null"],  description: "Best available thumbnail URL." },
      tags:             { type: "array", items: { type: "string" }, description: "Video tags (max 20)." },
      categories:       { type: "array", items: { type: "string" }, description: "YouTube content categories." },
      is_live:          { type: "boolean",           description: "True if currently a live stream." },
      url:              { type: "string",            description: "Canonical YouTube watch URL." },
      source:           { type: "string", enum: ["yt-dlp", "oembed"], description: "Data source used." },
      ts:               { type: "string",            description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const videoId = extractVideoId(query.video || "jNQXAC9IVRw");
    if (!videoId) throw new Error("invalid YouTube URL or video ID");

    let result;
    try {
      result = await fetchYtdlp(videoId);
    } catch {
      result = await fetchOembed(videoId);
    }

    return { ...result, ts: new Date().toISOString() };
  },
};
