// youtube-comments.js
//
// Top comments for any YouTube video, sorted by like count.
//
// Seam: the active youtube-intel pipeline (29 calls/24h) needs audience
// reaction and sentiment alongside video metadata. Comments reveal what
// viewers found notable, controversial, or shareable — no paid API required.
// Upstream: yt-dlp (local binary, free) with extractor-args to cap fetch count.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const YTDLP = "/home/aegis/.local/bin/yt-dlp";
const ID_RE  = /^[a-zA-Z0-9_-]{11}$/;

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

export default {
  name:  "youtube-comments",
  price: "$0.039",

  description:
    "Top comments for any YouTube video, sorted by like count. Returns comment text, author, like count, timestamp, and pinned/favorited flags. Useful for audience sentiment analysis, identifying notable reactions, and understanding community response. Accepts any YouTube URL format or bare 11-character video ID.",

  inputSchema: {
    type: "object",
    properties: {
      video: {
        type:        "string",
        description: "YouTube video URL (any format: watch?v=, youtu.be, /shorts/) or bare 11-character video ID.",
      },
      max_comments: {
        type:        "integer",
        minimum:     1,
        maximum:     50,
        description: "Maximum number of top comments to return (default 20, max 50).",
      },
    },
    required:            [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      video_id:      { type: "string",  description: "11-character YouTube video ID." },
      url:           { type: "string",  description: "Canonical YouTube watch URL." },
      comment_count: { type: "integer", description: "Number of comments returned." },
      comments: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            id:             { type: "string",  description: "Comment ID." },
            text:           { type: "string",  description: "Comment text." },
            author:         { type: "string",  description: "Display name of the commenter." },
            likes:          { type: "integer", description: "Like count on the comment." },
            is_pinned:      { type: "boolean", description: "Whether the comment is pinned by the channel." },
            is_favorited:   { type: "boolean", description: "Whether the comment is hearted by the creator." },
            timestamp:      { type: "integer", description: "Unix timestamp of the comment." },
            timestamp_text: { type: "string",  description: "Human-readable relative time (e.g. '2 years ago')." },
          },
        },
        description: "Top comments sorted by like count descending.",
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const videoId = extractVideoId(query.video || "dQw4w9WgXcQ");
    if (!videoId) throw new Error("invalid YouTube URL or video ID");

    const limit = Math.min(Math.max(1, query.max_comments || 20), 50);

    const { stdout } = await execFileAsync(
      YTDLP,
      [
        "--write-comments",
        "--extractor-args", `youtube:comment_sort=top;max_comments=${limit}`,
        "--skip-download",
        "--no-warnings",
        "-q",
        "--no-playlist",
        "-J",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 45000, encoding: "utf8" }
    );

    let info;
    try {
      info = JSON.parse(stdout);
    } catch {
      throw new Error("failed to parse yt-dlp JSON output");
    }

    const raw = (info.comments || []).slice(0, limit);
    const comments = raw.map(c => ({
      id:             c.id            || "",
      text:           c.text          || "",
      author:         c.author        || "",
      likes:          c.like_count    ?? 0,
      is_pinned:      c.is_pinned     ?? false,
      is_favorited:   c.is_favorited  ?? false,
      timestamp:      c.timestamp     ?? 0,
      timestamp_text: c._time_text    || "",
    }));

    return {
      video_id:      videoId,
      url:           `https://www.youtube.com/watch?v=${videoId}`,
      comment_count: comments.length,
      comments,
      ts:            new Date().toISOString(),
    };
  },
};
