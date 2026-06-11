export const PLANS = {
  "risk-retainer-7d": { price: "$8.00", windowSeconds: 60*60*24*7, scope: ["risk:read"], rateLimitPerMin: 60 },
  "risk-retainer-30d": { price: "$25.00", windowSeconds: 60*60*24*30, scope: ["risk:read"], rateLimitPerMin: 120 },
};
export const DEFAULT_PLAN = "risk-retainer-30d";
