// whale-radar.js
//
// Polymarket whale intelligence — recent trades + open positions for any wallet.
// Collapses the observed seam:
//   seerium.xyz/whale-radar/by-wallet   (303 settlements, $0.003, avg 6-day persist)
//   whale.hugen.tokyo/whale/lookup      (148 settlements, $0.012, avg 6-day persist)
// Combined seam: 451 settlements. Priced at $0.003 — matches seerium, 75% below hugen.
//
// Free upstream: data-api.polymarket.com (no API key required).
// Returns: recent trades, open positions, inferred whale tier, activity summary.
//
// signal-intel signals 62865, 62870 — strength 1.00. 2026-06-06.

const PM_API  = "https://data-api.polymarket.com";
const UA      = "Mozilla/5.0 (compatible; the-stall/3.57; +https://intuitek.ai)";
const TIMEOUT = 15_000;

async function pmFetch(path) {
  const r = await fetch(`${PM_API}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Polymarket API HTTP ${r.status} for ${path}`);
  return r.json();
}

function classifyWhale(trades) {
  const sizes = trades.map(t => t.usdc_size || 0);
  if (sizes.length === 0) return "unknown";
  const maxSize = Math.max(...sizes);
  const avgSize = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  if (maxSize >= 10_000 || avgSize >= 5_000) return "whale";
  if (maxSize >= 1_000  || avgSize >= 500)  return "shark";
  if (maxSize >= 100    || avgSize >= 50)   return "dolphin";
  return "minnow";
}

export default {
  name:  "whale-radar",
  price: "$0.010",

  description:
    "Polymarket whale intelligence for a given proxy wallet address. Returns recent prediction-market trades (market title, outcome, side, size in USDC, price, timestamp) and current open positions (title, size, avg price, current value, unrealized PnL). Infers whale tier (whale/shark/dolphin/minnow) from trade sizes. Use for copy-trading signal generation, market-sentiment cross-reference, or on-chain agent behavior profiling. Free upstream: Polymarket public data API.",

  inputSchema: {
    type: "object",
    properties: {
      wallet: {
        type: "string",
        description:
          "Polymarket proxy wallet address (0x, 42 hex chars). Obtain from recent Polymarket trades or on-chain Polygon activity. Example: 0x7a9dc87be2c72791fd86fad5f67be7c5dc89ba5d",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
      activity_limit: {
        type: "integer",
        description: "Max recent trades to return (1–50, default 10).",
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      positions_limit: {
        type: "integer",
        description: "Max open positions to return (1–50, default 10).",
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      include_closed: {
        type: "boolean",
        description: "If true, include zero-value (closed/redeemable) positions. Default false.",
        default: false,
      },
    },
    required: ["wallet"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      wallet:           { type: "string" },
      whale_tier:       { type: "string", enum: ["whale", "shark", "dolphin", "minnow", "unknown"] },
      activity_count:   { type: "integer" },
      positions_count:  { type: "integer" },
      recent_trades:    { type: "array" },
      open_positions:   { type: "array" },
      summary:          { type: "object" },
    },
    required: ["wallet", "whale_tier", "recent_trades", "open_positions"],
  },

  async handler(input) {
    const wallet         = input.wallet.toLowerCase();
    const actLimit       = Math.min(Math.max(parseInt(input.activity_limit  ?? 10, 10), 1), 50);
    const posLimit       = Math.min(Math.max(parseInt(input.positions_limit ?? 10, 10), 1), 50);
    const includeClosed  = Boolean(input.include_closed);

    // Fetch activity and positions in parallel
    const [actRaw, posRaw] = await Promise.all([
      pmFetch(`/activity?user=${wallet}&limit=${actLimit}`),
      pmFetch(`/positions?user=${wallet}&limit=${posLimit}`),
    ]);

    const actArr = Array.isArray(actRaw) ? actRaw : [];
    const posArr = Array.isArray(posRaw) ? posRaw : [];

    // Map trades
    const recentTrades = actArr
      .filter(t => t.type === "TRADE" || !t.type)
      .map(t => ({
        market:     t.title    ?? "Unknown",
        outcome:    t.outcome  ?? null,
        side:       t.side     ?? null,
        usdc_size:  t.usdcSize != null ? Math.round(t.usdcSize * 100) / 100 : null,
        price:      t.price    != null ? Math.round(t.price * 10000) / 10000 : null,
        timestamp:  t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null,
        slug:       t.slug     ?? null,
        tx:         t.transactionHash ?? null,
      }));

    // Map positions
    const openPositions = posArr
      .filter(p => includeClosed || (p.currentValue != null && p.currentValue > 0))
      .map(p => ({
        market:           p.title       ?? "Unknown",
        outcome:          p.outcome     ?? null,
        size:             p.size != null ? Math.round(p.size * 100) / 100 : null,
        avg_price:        p.avgPrice    != null ? Math.round(p.avgPrice * 10000) / 10000 : null,
        current_value:    p.currentValue != null ? Math.round(p.currentValue * 100) / 100 : null,
        unrealized_pnl:   p.cashPnl     != null ? Math.round(p.cashPnl * 100) / 100 : null,
        pnl_pct:          p.percentPnl  != null ? Math.round(p.percentPnl * 100) / 100 : null,
        redeemable:       p.redeemable  ?? false,
        slug:             p.slug        ?? null,
        end_date:         p.endDate     ?? null,
      }));

    const whaleTier = classifyWhale(recentTrades);

    // Summary metrics
    const totalTraded = recentTrades.reduce((s, t) => s + (t.usdc_size || 0), 0);
    const totalOpenValue = openPositions.reduce((s, p) => s + (p.current_value || 0), 0);
    const totalUnrealizedPnl = openPositions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
    const buys  = recentTrades.filter(t => t.side === "BUY").length;
    const sells = recentTrades.filter(t => t.side === "SELL").length;

    return {
      wallet,
      whale_tier:      whaleTier,
      activity_count:  actArr.length,
      positions_count: posArr.length,
      recent_trades:   recentTrades,
      open_positions:  openPositions,
      summary: {
        total_traded_usdc:       Math.round(totalTraded * 100) / 100,
        total_open_value_usdc:   Math.round(totalOpenValue * 100) / 100,
        total_unrealized_pnl:    Math.round(totalUnrealizedPnl * 100) / 100,
        buy_trade_count:         buys,
        sell_trade_count:        sells,
        open_position_count:     openPositions.length,
      },
    };
  },
};
