// youtube-revenue-estimate.js
//
// Estimates YouTube channel monthly ad revenue using yt-dlp channel data
// + industry CPM benchmarks by detected content category.
//
// Seam: creators, investors, and agents researching channel monetization
// potential ask this question constantly; YouTube itself never publishes
// it. This cap bridges the gap using publicly available view counts +
// well-established CPM benchmark ranges (documented in industry research).
//
// Method:
//   1. Fetch channel info + recent 20 videos via yt-dlp (no API key).
//   2. Estimate monthly views from avg_views_per_video × uploads_per_month.
//   3. Detect content category from channel tags/description/title.
//   4. Apply category CPM table to derive monthly revenue range.
//
// Upstream: yt-dlp (local binary, free, no auth).
// Price: $0.025/call.

const YTDLP      = "/home/aegis/.local/bin/yt-dlp";
const VIDEO_LIMIT = 20;

// Advertiser CPM brackets by category (USD per 1,000 monetizable views).
// Creators receive ~45% of advertiser spend (YouTube 55/45 split).
// Source: industry benchmarks across multiple public RPM disclosure studies.
const CPM = {
  finance:       { lo: 10, hi: 20 },   // investing, stocks, retirement
  crypto:        { lo: 8,  hi: 18 },   // bitcoin, defi, web3
  realestate:    { lo: 9,  hi: 18 },   // property, mortgage, rental
  legal:         { lo: 9,  hi: 16 },   // law, attorney, contracts
  health:        { lo: 7,  hi: 14 },   // fitness, nutrition, wellness
  tech:          { lo: 7,  hi: 13 },   // coding, software, gadgets
  education:     { lo: 5,  hi: 11 },   // tutorials, courses, study
  news:          { lo: 5,  hi: 10 },   // politics, current events
  beauty:        { lo: 4,  hi: 9  },   // makeup, skincare, fashion
  food:          { lo: 3,  hi: 8  },   // recipes, cooking, restaurant
  travel:        { lo: 3,  hi: 7  },   // vlogs, destinations, adventure
  gaming:        { lo: 2,  hi: 6  },   // gameplay, streaming, esports
  entertainment: { lo: 1,  hi: 4  },   // comedy, memes, pop culture
  general:       { lo: 2,  hi: 6  },   // catch-all
};

const CATEGORY_KEYWORDS = {
  finance:       ["invest", "stock", "market", "trading", "finance", "money", "portfolio", "401k", "dividend", "etf", "mutual fund", "ira", "wealth", "retirement", "financial", "hedge fund", "index fund"],
  crypto:        ["crypto", "bitcoin", "btc", "ethereum", "eth", "defi", "nft", "blockchain", "web3", "solana", "altcoin", "token"],
  realestate:    ["real estate", "property", "housing", "mortgage", "rental", "landlord", "investing in real", "home buying", "renting"],
  legal:         ["attorney", "lawyer", "legal", "law", "lawsuit", "court", "contract", "litigation"],
  health:        ["fitness", "workout", "gym", "diet", "nutrition", "health", "exercise", "weight loss", "muscle", "wellness", "meditation", "yoga"],
  tech:          ["coding", "programming", "software", "developer", "tech", "code", "javascript", "python", "ai", "machine learning", "startup", "saas", "computer"],
  education:     ["tutorial", "how to", "learn", "course", "lesson", "study", "school", "university", "exam", "education", "teach", "explainer"],
  news:          ["news", "politics", "government", "election", "policy", "democrat", "republican", "president", "senate", "congress", "war", "geopolitics"],
  beauty:        ["makeup", "beauty", "skincare", "fashion", "style", "hair", "cosmetic", "outfit", "clothing", "accessories"],
  food:          ["recipe", "cooking", "food", "chef", "baking", "kitchen", "meal", "restaurant", "cuisine", "taste", "eat"],
  travel:        ["travel", "vacation", "country", "adventure", "explore", "trip", "destination", "passport", "hotel", "flight", "backpack"],
  gaming:        ["gaming", "game", "gamer", "fortnite", "minecraft", "fps", "playthrough", "streamer", "twitch", "xbox", "playstation", "nintendo", "esports", "gameplay"],
  entertainment: ["comedy", "funny", "sketch", "meme", "react", "entertainment", "vlog", "challenge", "prank", "celebrity", "music"],
};

function detectCategory(text) {
  const lower = (text || "").toLowerCase();
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[cat] = kws.filter(k => lower.includes(k)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "general";
}

function channelUrl(input) {
  if (!input) throw new Error("channel is required");
  const s = input.trim();
  try {
    const u = new URL(s);
    if (u.hostname.endsWith("youtube.com")) return `${s.replace(/\/+$/, "")}/videos`;
  } catch { /* not a URL */ }
  if (s.startsWith("@")) return `https://www.youtube.com/${s}/videos`;
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(s)) return `https://www.youtube.com/channel/${s}/videos`;
  return `https://www.youtube.com/@${s}/videos`;
}

async function runYtDlp(args) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile)(YTDLP, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
}

export default {
  name:  "youtube-revenue-estimate",
  price: "$0.025",

  description:
    "Estimates a YouTube channel's monthly ad revenue using public view data + industry CPM benchmarks. Returns a low/mid/high monthly revenue range, detected content category, estimated monthly views, RPM tier, and confidence level. Accepts @handle, channel URL, or UCxxxxxxxx channel ID. No API key required. $0.025/call.",

  inputSchema: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: {
        type: "string",
        description: "YouTube channel @handle (e.g. @MrBeast), full URL, or UC... channel ID.",
      },
      currency: {
        type: "string",
        enum: ["USD"],
        description: "Output currency. Only USD supported.",
        default: "USD",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      channel_name:          { type: ["string", "null"] },
      channel_id:            { type: ["string", "null"] },
      subscriber_count:      { type: ["integer", "null"], description: "Subscriber count (null if hidden)." },
      category:              { type: "string" },
      monthly_views_estimate:{ type: ["integer", "null"] },
      videos_per_month:      { type: ["number", "null"] },
      avg_views_per_video:   { type: ["integer", "null"] },
      cpm_bracket_usd:       { type: "object", properties: { lo: { type: "number" }, hi: { type: "number" } } },
      monthly_revenue_usd:   {
        type: "object",
        properties: {
          low:  { type: "number" },
          mid:  { type: "number" },
          high: { type: "number" },
        },
        description: "Monthly ad revenue estimate (USD). Creator receives ~45% of advertiser CPM.",
      },
      rpm_tier:              { type: "string", enum: ["premium", "mid", "value"], description: "premium=$5+/1k views, mid=$2-5, value=<$2." },
      confidence:            { type: "string", enum: ["high", "medium", "low"] },
      confidence_notes:      { type: "string" },
      videos_analyzed:       { type: "integer" },
      source:                { type: "string", enum: ["yt-dlp"] },
    },
  },

  async handler(query) {
    const { channel } = query;
    const url = channelUrl(channel);

    // Fetch channel metadata + recent videos with one yt-dlp call.
    const { stdout } = await runYtDlp([
      "--flat-playlist",
      "--playlist-end", String(VIDEO_LIMIT),
      "--dump-single-json",
      "--no-warnings",
      url,
    ]);

    const data = JSON.parse(stdout);

    const channelName = data.channel ?? data.title ?? data.uploader ?? null;
    const channelId   = data.channel_id ?? data.id ?? null;
    const subscribers = data.channel_follower_count ?? null;

    // Build profile text for category detection.
    const profileText = [
      channelName ?? "",
      data.description ?? "",
      ...(data.tags ?? []),
      ...(data.entries?.slice(0, 5).map(e => e.title ?? "") ?? []),
    ].join(" ");

    const category = detectCategory(profileText);
    const cpmBracket = CPM[category] ?? CPM.general;

    // Estimate uploads per month from recent video timestamps.
    const entries = (data.entries ?? []).filter(e => e.view_count != null || e.timestamp != null);
    const views   = entries.map(e => e.view_count).filter(v => v != null && v > 0);
    const avgViews = views.length > 0
      ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      : null;

    // Use upload timestamps to estimate cadence (videos per month).
    const timestamps = entries.map(e => e.timestamp ?? e.release_timestamp).filter(Boolean);
    let videosPerMonth = null;
    if (timestamps.length >= 2) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      const spanDays = (sorted[sorted.length - 1] - sorted[0]) / 86400;
      const spanMonths = spanDays / 30;
      if (spanMonths > 0.1) {
        videosPerMonth = parseFloat(((timestamps.length - 1) / spanMonths).toFixed(2));
      }
    }

    // Fall back to assuming weekly uploads if cadence unknown.
    const effectiveVPM = videosPerMonth ?? 4;
    const monthlyViews = avgViews != null ? Math.round(avgViews * effectiveVPM) : null;

    // Monthly revenue = (monthly_views / 1000) × RPM, where RPM = CPM × 0.45.
    let revenue = null;
    if (monthlyViews != null) {
      const factor = monthlyViews / 1000;
      revenue = {
        low:  parseFloat((factor * cpmBracket.lo * 0.45).toFixed(2)),
        mid:  parseFloat((factor * ((cpmBracket.lo + cpmBracket.hi) / 2) * 0.45).toFixed(2)),
        high: parseFloat((factor * cpmBracket.hi * 0.45).toFixed(2)),
      };
    }

    // RPM tier based on category mid-RPM.
    const midRPM = ((cpmBracket.lo + cpmBracket.hi) / 2) * 0.45;
    const rpmTier = midRPM >= 5 ? "premium" : midRPM >= 2 ? "mid" : "value";

    // Confidence assessment.
    let confidence = "medium";
    const notes = [];
    if (subscribers == null) notes.push("subscriber count hidden by creator");
    if (views.length < 5) notes.push("fewer than 5 videos with public view counts");
    if (videosPerMonth == null) notes.push("upload cadence unknown — assumed 4/month");
    if (monthlyViews != null && views.length >= 10 && videosPerMonth != null && subscribers != null) {
      confidence = "high";
    } else if (notes.length >= 2 || monthlyViews == null) {
      confidence = "low";
    }

    return {
      channel_name:           channelName,
      channel_id:             channelId,
      subscriber_count:       subscribers,
      category,
      monthly_views_estimate: monthlyViews,
      videos_per_month:       videosPerMonth,
      avg_views_per_video:    avgViews,
      cpm_bracket_usd:        cpmBracket,
      monthly_revenue_usd:    revenue,
      rpm_tier:               rpmTier,
      confidence,
      confidence_notes:       notes.length > 0 ? notes.join("; ") : null,
      videos_analyzed:        entries.length,
      source:                 "yt-dlp",
    };
  },
};
