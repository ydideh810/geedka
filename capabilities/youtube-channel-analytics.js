// youtube-channel-analytics.js
//
// YouTube channel video performance analytics: recent N uploads with view
// counts, upload cadence, view velocity trend, and top/bottom performers.
//
// Accepts @handle (e.g. @MrBeast), channel URL, or UC... channel ID.
//
// Seam: agents calling youtube-intel on individual videos lack channel-level
// context and must make 20+ sequential calls to understand a channel. This
// cap returns the recent video list + synthesized analytics in one call —
// upload cadence, ACCELERATING/STABLE/DECLINING momentum, and performer rankings.
//
// Output differs from youtube-channel-intel (subscriber count, description)
// and youtube-playlist (requires explicit playlist ID) — this cap derives the
// uploads playlist automatically from any channel input and adds analytics.
//
// Upstream: yt-dlp --flat-playlist on channel /videos tab (free, no auth).
// Price: $0.035/call

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const YTDLP         = "/home/aegis/.local/bin/yt-dlp";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 50;

function normalizeChannel(input) {
  if (!input) throw new Error("channel is required");
  const s = input.trim();

  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const u = new URL(s);
      if (u.hostname.endsWith("youtube.com")) {
        const path = u.pathname.replace(/\/(videos|shorts|streams|live|playlists|featured|about)$/, "");
        return `https://www.youtube.com${path}/videos`;
      }
    } catch { /* fall through */ }
    return s;
  }

  // @handle
  if (s.startsWith("@")) return `https://www.youtube.com/${s}/videos`;

  // UC... channel ID (24 chars: UC + 22 base64url)
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(s)) return `https://www.youtube.com/channel/${s}/videos`;

  // Bare handle — assume @
  return `https://www.youtube.com/@${s}/videos`;
}

function parseUploadDate(d) {
  if (!d || String(d).length !== 8) return null;
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function parseEntry(d) {
  return {
    video_id:    d.id ?? null,
    title:       d.title ?? null,
    view_count:  d.view_count ?? null,
    upload_date: parseUploadDate(d.upload_date),
    duration_s:  d.duration ?? null,
    url:         d.id ? `https://www.youtube.com/watch?v=${d.id}` : null,
  };
}

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// views[0] = newest, views[N-1] = oldest (yt-dlp returns newest-first)
function calcViewTrend(views) {
  const n = views.length;
  if (n < 4) return "INSUFFICIENT_DATA";
  const half  = Math.floor(n / 2);
  const newer = views.slice(0, half);
  const older = views.slice(half);
  const avgNewer = newer.reduce((a, b) => a + b, 0) / newer.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
  if (avgOlder === 0) return "INSUFFICIENT_DATA";
  const ratio = avgNewer / avgOlder;
  if (ratio > 1.25) return "ACCELERATING";
  if (ratio < 0.75) return "DECLINING";
  return "STABLE";
}

// dates: ISO strings newest-first; returns median days between consecutive uploads
function calcCadence(dates) {
  const valid = dates.filter(Boolean);
  if (valid.length < 2) return null;
  const diffs = [];
  for (let i = 0; i < valid.length - 1; i++) {
    const diffMs = new Date(valid[i + 1]) - new Date(valid[i]);
    const days   = Math.abs(diffMs / (1000 * 60 * 60 * 24));
    if (days < 365) diffs.push(days);
  }
  if (!diffs.length) return null;
  return r2(median(diffs));
}

export default {
  name:  "youtube-channel-analytics",
  price: "$0.035",
  description:
    "YouTube channel video performance analytics: recent N uploads with view counts, " +
    "upload cadence, ACCELERATING/STABLE/DECLINING momentum, and top/bottom performers. " +
    "Accepts @handle, channel URL, or UC... channel ID. " +
    "Replaces 20+ sequential youtube-intel calls for channel-level research.",
  inputSchema: {
    type: "object",
    properties: {
      channel: {
        type:        "string",
        description: "Channel @handle (e.g. @MrBeast), full channel URL, or UC... channel ID.",
      },
      limit: {
        type:        "integer",
        description: "Number of recent videos to analyze (1–50, default 20).",
        minimum:     1,
        maximum:     50,
      },
    },
    required: ["channel"],
  },
  outputSchema: {
    type: "object",
    properties: {
      channel_url:      { type: "string" },
      videos_analyzed:  { type: "integer" },
      recent_videos: {
        type:  "array",
        description: "Most recent uploads, newest first.",
        items: {
          type: "object",
          properties: {
            video_id:    { type: ["string", "null"] },
            title:       { type: ["string", "null"] },
            view_count:  { type: ["integer", "null"] },
            upload_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            duration_s:  { type: ["integer", "null"] },
            url:         { type: ["string", "null"] },
          },
        },
      },
      analytics: {
        type: "object",
        properties: {
          median_views:         { type: ["integer", "null"], description: "Median views across recent videos." },
          upload_cadence_days:  { type: ["number", "null"],  description: "Median days between uploads (null if dates unavailable)." },
          view_trend:           { type: "string", description: "ACCELERATING | STABLE | DECLINING | INSUFFICIENT_DATA" },
          channel_momentum:     { type: "string", description: "GROWING | STEADY | DECLINING | UNKNOWN" },
          top_performer: {
            type: "object",
            description: "Highest-view video in the analyzed set.",
            properties: {
              video_id:   { type: ["string", "null"] },
              title:      { type: ["string", "null"] },
              view_count: { type: ["integer", "null"] },
              url:        { type: ["string", "null"] },
            },
          },
          recent_flop: {
            type: "object",
            description: "Lowest-view video in the analyzed set.",
            properties: {
              video_id:   { type: ["string", "null"] },
              title:      { type: ["string", "null"] },
              view_count: { type: ["integer", "null"] },
              url:        { type: ["string", "null"] },
            },
          },
        },
      },
    },
  },

  async handler({ channel, limit }) {
    const lim        = Math.min(parseInt(limit ?? DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const channelUrl = normalizeChannel(channel);

    const { stdout } = await execFileAsync(
      YTDLP,
      [
        "--dump-json", "--no-download", "--no-warnings", "-q",
        "--playlist-end", String(lim),
        channelUrl,
      ],
      { timeout: 90000, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );

    const videos = [];
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { videos.push(parseEntry(JSON.parse(t))); } catch { /* skip */ }
    }

    if (videos.length === 0) {
      throw new Error(
        "No videos found. Check the channel handle or URL. " +
        "Private or terminated channels will return no results."
      );
    }

    const viewCounts = videos.filter(v => v.view_count != null).map(v => v.view_count);
    const dates      = videos.map(v => v.upload_date);

    const sorted     = [...videos].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
    const top        = sorted[0];
    const flop       = sorted[sorted.length - 1];

    const viewTrend       = calcViewTrend(viewCounts);
    const momentumMap     = { ACCELERATING: "GROWING", STABLE: "STEADY", DECLINING: "DECLINING", INSUFFICIENT_DATA: "UNKNOWN" };
    const channelMomentum = momentumMap[viewTrend] ?? "UNKNOWN";

    return {
      channel_url:     channelUrl,
      videos_analyzed: videos.length,
      recent_videos:   videos,
      analytics: {
        median_views:        viewCounts.length ? Math.round(median(viewCounts)) : null,
        upload_cadence_days: calcCadence(dates),
        view_trend:          viewTrend,
        channel_momentum:    channelMomentum,
        top_performer: top ? {
          video_id:   top.video_id,
          title:      top.title,
          view_count: top.view_count,
          url:        top.url,
        } : null,
        recent_flop: flop && flop !== top ? {
          video_id:   flop.video_id,
          title:      flop.title,
          view_count: flop.view_count,
          url:        flop.url,
        } : null,
      },
    };
  },
};
