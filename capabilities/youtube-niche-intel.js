// youtube-niche-intel.js
//
// YouTube niche / keyword competitive intelligence.
// For any search query, fetches top results via yt-dlp and synthesizes:
//
//   Channel Concentration (HHI): how dominated is this niche?
//     0 = perfectly fragmented (every video from a different channel)
//     1 = monopoly (one channel owns all views in top results)
//
//   View Velocity: median views on top N results.
//     MEGA (>1M) | HIGH (>100k) | MEDIUM (>10k) | LOW | MINIMAL
//
//   Saturation Signal: SATURATED | MODERATE | OPEN
//
//   Opportunity Grade: A (wide open) → F (highly saturated)
//     Composite of concentration + view magnitude + channel diversity.
//
// Seam: agents using youtube-intel analyze individual videos but lack
// competitive context: "Is this a crowded niche?" This cap answers in one
// call, replacing a manual loop of youtube-search + N × youtube-intel +
// hand-rolled synthesis. Priced below youtube-intel because it replaces
// the preparatory research step, not the deep-per-video analysis.
//
// Upstream: yt-dlp ytsearch (local binary, free). No API key required.
// Price: $0.025

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const YTDLP      = "/home/aegis/.local/bin/yt-dlp";
const DEFAULT_N  = 10;
const MAX_N      = 15;

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }

function parseResult(d) {
  return {
    video_id:   d.id ?? null,
    title:      d.title ?? null,
    channel:    d.uploader ?? d.channel ?? null,
    channel_id: d.channel_id ?? d.uploader_id ?? null,
    view_count: d.view_count ?? null,
    duration_s: d.duration ?? null,
  };
}

async function searchYoutube(query, n) {
  const { stdout } = await execFileAsync(
    YTDLP,
    ["--dump-json", "--flat-playlist", "--no-download", "--no-warnings", "-q",
     `ytsearch${n}:${query}`],
    { timeout: 45000, encoding: "utf8" }
  );
  const results = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { results.push(parseResult(JSON.parse(t))); } catch { /* skip */ }
  }
  return results;
}

function computeHHI(viewsByChannel) {
  const total = Object.values(viewsByChannel).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return Object.values(viewsByChannel).reduce((acc, v) => {
    const share = v / total;
    return acc + share * share;
  }, 0);
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function letterGrade(pts) {
  if (pts >= 80) return "A";
  if (pts >= 65) return "B";
  if (pts >= 50) return "C";
  if (pts >= 35) return "D";
  return "F";
}

export default {
  name:  "youtube-niche-intel",
  price: "$0.025",
  description:
    "YouTube competitive intelligence for a keyword or niche: channel concentration, " +
    "view velocity, saturation signal (SATURATED/MODERATE/OPEN), opportunity grade (A–F), " +
    "and dominant channels by view share.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type:        "string",
        description: "YouTube search query representing the niche or keyword " +
                     "(e.g. 'machine learning tutorial', 'vegan cooking', 'options trading').",
      },
      results: {
        type:        "integer",
        description: "Number of top results to analyze (3–15, default 10). " +
                     "More results yield a more accurate concentration score.",
      },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: {
      query:              { type: "string" },
      results_analyzed:  { type: "integer" },
      channel_concentration: {
        type:        "number",
        description: "HHI-style score (0 = fragmented, 1 = monopoly). " +
                     "<0.25 = open, 0.25–0.5 = moderate, >0.5 = concentrated.",
      },
      distinct_channels: { type: "integer" },
      view_stats: {
        type: "object",
        properties: {
          median_views:        { type: ["integer","null"] },
          mean_views:          { type: ["integer","null"] },
          top_video_views:     { type: ["integer","null"] },
          bottom_video_views:  { type: ["integer","null"] },
          view_range_label:    {
            type:        "string",
            description: "MEGA (>1M median) | HIGH (>100k) | MEDIUM (>10k) | LOW (>1k) | MINIMAL",
          },
        },
      },
      avg_duration_minutes:  { type: ["number","null"] },
      saturation_signal:     {
        type:        "string",
        description: "SATURATED (hard to enter) | MODERATE | OPEN (low competition).",
      },
      opportunity_grade: {
        type:        "string",
        description: "A (wide open) / B / C / D / F (highly saturated).",
      },
      opportunity_rationale: { type: "string" },
      dominant_channels: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            channel:        { type: "string" },
            channel_id:     { type: ["string","null"] },
            videos_in_top:  { type: "integer" },
            total_views:    { type: ["integer","null"] },
            view_share_pct: { type: ["number","null"] },
          },
        },
      },
      top_videos: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            rank:             { type: "integer" },
            title:            { type: ["string","null"] },
            channel:          { type: ["string","null"] },
            view_count:       { type: ["integer","null"] },
            duration_minutes: { type: ["number","null"] },
            video_url:        { type: ["string","null"] },
          },
        },
      },
      retrieved_at: { type: "string" },
    },
  },

  async handler({ query, results }) {
    if (!query || typeof query !== "string" || !query.trim()) {
      throw Object.assign(new Error("query is required"), { status: 400 });
    }
    const q = query.trim();
    const n = Math.min(Math.max(3, parseInt(results) || DEFAULT_N), MAX_N);

    const videos = await searchYoutube(q, n);
    if (!videos.length) {
      throw new Error("No results found for this query");
    }

    // ── Channel aggregation ───────────────────────────────────────────────
    const channelViews = {};
    const channelNames = {};
    const channelCount = {};

    for (const v of videos) {
      const cid  = v.channel_id || v.channel || "unknown";
      const views = v.view_count ?? 0;
      channelViews[cid] = (channelViews[cid] ?? 0) + views;
      channelNames[cid] = v.channel ?? cid;
      channelCount[cid] = (channelCount[cid] ?? 0) + 1;
    }

    const distinctChannels = Object.keys(channelViews).length;
    const hhi              = computeHHI(channelViews);
    const totalViews       = Object.values(channelViews).reduce((a, b) => a + b, 0);

    // ── View stats ────────────────────────────────────────────────────────
    const viewCounts   = videos.map(v => v.view_count).filter(v => v != null);
    const medianViews  = median(viewCounts);
    const meanViews    = viewCounts.length
      ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
      : null;
    const topViews     = viewCounts.length ? Math.max(...viewCounts) : null;
    const bottomViews  = viewCounts.length ? Math.min(...viewCounts) : null;

    let viewRangeLabel = "MINIMAL";
    if (medianViews != null) {
      if      (medianViews >= 1_000_000) viewRangeLabel = "MEGA";
      else if (medianViews >= 100_000)   viewRangeLabel = "HIGH";
      else if (medianViews >= 10_000)    viewRangeLabel = "MEDIUM";
      else if (medianViews >= 1_000)     viewRangeLabel = "LOW";
    }

    // ── Duration ─────────────────────────────────────────────────────────
    const durations = videos.map(v => v.duration_s).filter(v => v != null);
    const avgDurationMins = durations.length
      ? r2(durations.reduce((a, b) => a + b, 0) / durations.length / 60)
      : null;

    // ── Opportunity scoring (0–100) ───────────────────────────────────────
    let pts = 50;

    // Channel concentration: fragmented → opportunity
    if      (hhi < 0.15) pts += 25;
    else if (hhi < 0.25) pts += 15;
    else if (hhi < 0.40) pts +=  5;
    else if (hhi < 0.60) pts -= 10;
    else                 pts -= 20;

    // Channel diversity ratio
    const channelRatio = distinctChannels / videos.length;
    if      (channelRatio >= 0.80) pts += 15;
    else if (channelRatio >= 0.60) pts +=  8;
    else if (channelRatio  < 0.30) pts -= 15;

    // View magnitude: high views = competitive niche (crowded but proven)
    if (medianViews != null) {
      if      (medianViews > 5_000_000) pts -= 20;
      else if (medianViews > 1_000_000) pts -= 15;
      else if (medianViews > 100_000)   pts -=  5;
      else if (medianViews <  10_000)   pts += 15;
      else if (medianViews <   1_000)   pts += 25;
    }

    pts = Math.max(0, Math.min(100, pts));

    const opportunityGrade = letterGrade(pts);
    const saturationSignal =
      pts >= 65 ? "OPEN" : pts >= 40 ? "MODERATE" : "SATURATED";

    const hhiLabel =
      hhi < 0.15 ? "highly fragmented" :
      hhi < 0.25 ? "fragmented" :
      hhi < 0.40 ? "moderately concentrated" :
      hhi < 0.60 ? "concentrated" : "highly concentrated";

    const opportunityRationale =
      `Top ${videos.length} results span ${distinctChannels} distinct channel` +
      `${distinctChannels !== 1 ? "s" : ""} (${hhiLabel}, HHI=${r2(hhi)}). ` +
      `Median view count: ${medianViews != null ? medianViews.toLocaleString() : "N/A"} (${viewRangeLabel}). ` +
      `Opportunity score: ${pts}/100.`;

    // ── Dominant channels ─────────────────────────────────────────────────
    const dominantChannels = Object.entries(channelViews)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cid, views]) => ({
        channel:        channelNames[cid] ?? cid,
        channel_id:     cid !== "unknown" ? cid : null,
        videos_in_top:  channelCount[cid] ?? 0,
        total_views:    views > 0 ? views : null,
        view_share_pct: totalViews > 0 ? r2((views / totalViews) * 100) : null,
      }));

    // ── Top videos ────────────────────────────────────────────────────────
    const topVideos = [...videos]
      .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
      .slice(0, 5)
      .map((v, i) => ({
        rank:             i + 1,
        title:            v.title ?? null,
        channel:          v.channel ?? null,
        view_count:       v.view_count ?? null,
        duration_minutes: v.duration_s != null ? r2(v.duration_s / 60) : null,
        video_url:        v.video_id ? `https://www.youtube.com/watch?v=${v.video_id}` : null,
      }));

    return {
      query:                q,
      results_analyzed:     videos.length,
      channel_concentration: r2(hhi),
      distinct_channels:    distinctChannels,
      view_stats: {
        median_views:       medianViews,
        mean_views:         meanViews,
        top_video_views:    topViews,
        bottom_video_views: bottomViews,
        view_range_label:   viewRangeLabel,
      },
      avg_duration_minutes:  avgDurationMins,
      saturation_signal:     saturationSignal,
      opportunity_grade:     opportunityGrade,
      opportunity_rationale: opportunityRationale,
      dominant_channels:     dominantChannels,
      top_videos:            topVideos,
      retrieved_at:          new Date().toISOString(),
    };
  },
};
