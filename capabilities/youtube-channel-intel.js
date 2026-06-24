// youtube-channel-intel.js
//
// YouTube channel metadata: subscriber count, channel name, description,
// tags, channel URL, and handle. Accepts any channel URL format or @handle.
//
// Seam: agents using youtube-intel for video data need channel-level context
// to evaluate creator credibility, reach, and niche. No paid API required.
// Upstream: yt-dlp (local binary, free) — same seam as youtube-intel.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const YTDLP = "/home/aegis/.local/bin/yt-dlp";

function normalizeChannelInput(input) {
  if (!input) return null;
  const s = input.trim();

  // Already a full URL
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const u = new URL(s);
      if (u.hostname.endsWith("youtube.com")) return s;
    } catch { /* fall through */ }
    return s;
  }

  // Bare channel ID: UC + 22 base64url chars
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(s)) {
    return `https://www.youtube.com/channel/${s}`;
  }

  // @handle (with or without the @)
  const handle = s.startsWith("@") ? s : `@${s}`;
  return `https://www.youtube.com/${handle}`;
}

async function fetchChannelInfo(url) {
  const { stdout } = await execFileAsync(
    YTDLP,
    [
      "--dump-single-json",
      "--no-download",
      "--flat-playlist",
      "--playlist-items", "0",
      "--no-warnings",
      "-q",
      url,
    ],
    { timeout: 30000, encoding: "utf8" }
  );

  const d = JSON.parse(stdout);

  const thumbnail = (() => {
    const thumbs = d.thumbnails;
    if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
    // prefer highest resolution
    const sorted = [...thumbs].sort((a, b) => {
      const aRes = (a.width || 0) * (a.height || 0);
      const bRes = (b.width || 0) * (b.height || 0);
      return bRes - aRes;
    });
    return sorted[0].url ?? null;
  })();

  return {
    channel_id:         d.channel_id ?? d.id ?? null,
    channel_name:       d.channel ?? d.title ?? d.uploader ?? null,
    handle:             d.uploader_id ?? null,
    channel_url:        d.channel_url ?? null,
    handle_url:         d.uploader_url ?? null,
    subscriber_count:   d.channel_follower_count ?? null,
    description:        (d.description ?? "").slice(0, 1000) || null,
    tags:               Array.isArray(d.tags) ? d.tags.slice(0, 20) : [],
    thumbnail:          thumbnail,
    source:             "yt-dlp",
  };
}

export default {
  name:  "youtube-channel-intel",
  price: "$0.039",

  description:
    "YouTube channel metadata: subscriber count, channel name, handle, description (1000-char cap), and tags. Accepts @handle, channel URL, or UC channel ID. Uses yt-dlp (no API key required). $0.039/call.",

  inputSchema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description:
          "YouTube channel identifier: @handle (e.g. @mkbhd), full channel URL, or UC channel ID (UCxxxxxxxx).",
      },
    },
    required: ["channel"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      channel_id:       { type: ["string", "null"],  description: "YouTube channel ID (UCxxxxxxxx)." },
      channel_name:     { type: ["string", "null"],  description: "Channel display name." },
      handle:           { type: ["string", "null"],  description: "Channel @handle (without URL prefix)." },
      channel_url:      { type: ["string", "null"],  description: "Canonical channel URL." },
      handle_url:       { type: ["string", "null"],  description: "@handle URL (youtube.com/@...)." },
      subscriber_count: { type: ["integer", "null"], description: "Subscriber count (null if hidden)." },
      description:      { type: ["string", "null"],  description: "Channel description (max 1000 chars)." },
      tags:             { type: "array", items: { type: "string" }, description: "Channel tags (max 20)." },
      thumbnail:        { type: ["string", "null"],  description: "Highest-resolution channel thumbnail URL." },
      source:           { type: "string", enum: ["yt-dlp"], description: "Data source." },
      ts:               { type: "string",            description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const url = normalizeChannelInput(query.channel);
    if (!url) throw new Error("channel is required");
    const result = await fetchChannelInfo(url);
    return { ...result, ts: new Date().toISOString() };
  },
};
