// db-perf-intel.js
//
// Database performance intelligence: version status, EOL dates, and performance
// profiles for major databases. Useful mid-task for agents evaluating database
// choices, checking upgrade urgency, or auditing infrastructure currency.
//
// Live data: endoflife.date public API (free, no auth, community-maintained).
// Performance profiles: hardcoded from public benchmarks (TPC-C, pgbench,
// sysbench, YCSB) and vendor documentation.
//
// Seam origin: orbisapi.com/proxy/db-perf-intel2-api-3968ee (15,824 sett,
// 26 payers, avg $0.0052/call). [REDACTED]4, 2026-06-06.

const EOL_API = "https://endoflife.date/api";
const UA = "Mozilla/5.0 (compatible; the-stall/3.8; +https://intuitek.ai)";

// Canonical slug for each supported db (matches endoflife.date product names)
const DB_SLUGS = {
  postgresql:  "postgresql",
  postgres:    "postgresql",
  mysql:       "mysql",
  mariadb:     "mariadb",
  mongodb:     "mongodb",
  mongo:       "mongodb",
  redis:       "redis",
  elasticsearch: "elasticsearch",
  elastic:     "elasticsearch",
  sqlite:      "sqlite",
  cassandra:   "apache-cassandra",
  "apache-cassandra": "apache-cassandra",
  cockroachdb: "cockroachdb",
  cockroach:   "cockroachdb",
  mssql:       "mssqlserver",
  sqlserver:   "mssqlserver",
  mssqlserver: "mssqlserver",
};

const ALL_DBS = [...new Set(Object.values(DB_SLUGS))];

// Performance profiles sourced from public benchmark literature.
// read/write tier: A (top-tier), B (mid), C (baseline).
// latency: sub-ms / low / medium / high.
// scale: vertical / vertical+horizontal / horizontal.
const PROFILES = {
  "postgresql": {
    display_name: "PostgreSQL",
    type: "relational",
    read_tier: "A",
    write_tier: "A",
    latency: "low",
    scale: "vertical+horizontal",
    strengths: ["ACID compliance", "complex SQL", "JSONB", "full-text search", "extensions"],
    best_for: ["OLTP", "analytics", "SaaS", "geospatial"],
    benchmark_ref: "pgbench ~8,000–80,000 TPS depending on hw/config",
    open_source: true,
  },
  "mysql": {
    display_name: "MySQL",
    type: "relational",
    read_tier: "A",
    write_tier: "B",
    latency: "low",
    scale: "vertical+horizontal",
    strengths: ["read-heavy workloads", "wide ecosystem", "replication"],
    best_for: ["web applications", "OLTP", "read replicas"],
    benchmark_ref: "sysbench OLTP_RO ~50,000 QPS on commodity hw",
    open_source: true,
  },
  "mariadb": {
    display_name: "MariaDB",
    type: "relational",
    read_tier: "A",
    write_tier: "B",
    latency: "low",
    scale: "vertical+horizontal",
    strengths: ["MySQL drop-in", "Galera cluster", "temporal tables"],
    best_for: ["MySQL migrations", "multi-master HA", "OLTP"],
    benchmark_ref: "sysbench comparable to MySQL; Galera adds ~15% write overhead",
    open_source: true,
  },
  "mongodb": {
    display_name: "MongoDB",
    type: "document",
    read_tier: "A",
    write_tier: "A",
    latency: "low",
    scale: "horizontal",
    strengths: ["flexible schema", "sharding", "aggregation pipeline", "Atlas search"],
    best_for: ["document storage", "content management", "catalogs", "real-time analytics"],
    benchmark_ref: "YCSB 100K+ ops/sec; write-heavy workloads excel",
    open_source: true,
  },
  "redis": {
    display_name: "Redis",
    type: "in-memory key-value",
    read_tier: "A",
    write_tier: "A",
    latency: "sub-ms",
    scale: "horizontal",
    strengths: ["sub-millisecond latency", "pub/sub", "streams", "Lua scripting"],
    best_for: ["caching", "session store", "rate limiting", "message broker", "leaderboards"],
    benchmark_ref: "redis-benchmark 100K–1M ops/sec; pipeline mode 10x higher",
    open_source: true,
  },
  "elasticsearch": {
    display_name: "Elasticsearch",
    type: "search/analytics",
    read_tier: "A",
    write_tier: "B",
    latency: "low",
    scale: "horizontal",
    strengths: ["full-text search", "log analytics", "geo queries", "aggregations"],
    best_for: ["log management", "site search", "observability", "time-series"],
    benchmark_ref: "Rally benchmark: 50K–200K docs/sec ingest; query P99 <100ms at scale",
    open_source: false,
  },
  "sqlite": {
    display_name: "SQLite",
    type: "embedded relational",
    read_tier: "A",
    write_tier: "B",
    latency: "sub-ms",
    scale: "vertical",
    strengths: ["zero config", "embedded", "ACID", "serverless"],
    best_for: ["edge/embedded", "mobile", "local-first apps", "prototyping"],
    benchmark_ref: "100K+ reads/sec; writes serialized — single writer bottleneck",
    open_source: true,
  },
  "apache-cassandra": {
    display_name: "Apache Cassandra",
    type: "wide-column",
    read_tier: "B",
    write_tier: "A",
    latency: "low",
    scale: "horizontal",
    strengths: ["write throughput", "multi-region", "tunable consistency", "linear scale"],
    best_for: ["time-series", "IoT", "messaging", "multi-region writes"],
    benchmark_ref: "NoSQLBench: 1M+ writes/sec across a 3-node cluster",
    open_source: true,
  },
  "cockroachdb": {
    display_name: "CockroachDB",
    type: "distributed relational",
    read_tier: "B",
    write_tier: "B",
    latency: "medium",
    scale: "horizontal",
    strengths: ["global ACID transactions", "Postgres compatibility", "multi-region", "survivability"],
    best_for: ["multi-region OLTP", "financial transactions", "global SaaS"],
    benchmark_ref: "TPC-C 140K+ tpmC on 81-node cluster; ~2x PostgreSQL latency on single-node",
    open_source: true,
  },
  "mssqlserver": {
    display_name: "Microsoft SQL Server",
    type: "relational",
    read_tier: "A",
    write_tier: "A",
    latency: "low",
    scale: "vertical+horizontal",
    strengths: ["enterprise tooling", "BI integration", "columnstore indexes", "Always On AG"],
    best_for: ["enterprise OLTP", "data warehousing", "Windows-stack", "BI/reporting"],
    benchmark_ref: "TPC-E top 10 rankings; columnstore queries 10–100x faster than row-store for analytics",
    open_source: false,
  },
};

async function fetchEolData(slug) {
  const res = await fetch(`${EOL_API}/${slug}.json`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

function summarizeCycles(cycles) {
  if (!cycles || cycles.length === 0) return null;
  const now = Date.now();

  const active = cycles.filter(c => {
    const eol = c.eol;
    if (eol === false || eol === null) return true;
    if (typeof eol === "string") return new Date(eol).getTime() > now;
    return false;
  });

  active.sort((a, b) => parseFloat(b.cycle) - parseFloat(a.cycle));
  const latest = active[0] || cycles[0];

  const eolDate = latest?.eol === false ? null : latest?.eol;
  const daysUntilEol = eolDate
    ? Math.round((new Date(eolDate).getTime() - now) / 86400000)
    : null;

  return {
    latest_version:       latest?.latest ?? latest?.cycle ?? null,
    latest_release_date:  latest?.latestReleaseDate ?? null,
    active_cycles:        active.map(c => c.cycle),
    eol_date:             eolDate,
    days_until_eol:       daysUntilEol,
    eol_soon:             daysUntilEol !== null && daysUntilEol < 180,
    lts_available:        cycles.some(c => c.lts === true),
  };
}

async function getDatabaseIntel(slug) {
  const [eolData, profile] = await Promise.all([
    fetchEolData(slug),
    Promise.resolve(PROFILES[slug] || null),
  ]);

  return {
    slug,
    ...(profile || { display_name: slug }),
    version_status: eolData ? summarizeCycles(eolData) : null,
    performance_profile: profile
      ? {
          read_tier:     profile.read_tier,
          write_tier:    profile.write_tier,
          latency:       profile.latency,
          scale:         profile.scale,
          strengths:     profile.strengths,
          best_for:      profile.best_for,
          benchmark_ref: profile.benchmark_ref,
          open_source:   profile.open_source,
        }
      : null,
  };
}

export default {
  name: "db-perf-intel",
  price: "$0.034",

  description:
    "Database performance intelligence: current versions, EOL status, and benchmark-grounded performance profiles for PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Elasticsearch, SQLite, Cassandra, CockroachDB, and SQL Server. Useful mid-task for infrastructure audits, database selection, and upgrade urgency checks. Live EOL data from endoflife.date; performance profiles from TPC-C, pgbench, sysbench, and YCSB benchmarks.",

  inputSchema: {
    type: "object",
    properties: {
      database: {
        type: "string",
        description:
          "Database to query. Accepts: postgresql, mysql, mariadb, mongodb, redis, elasticsearch, sqlite, cassandra, cockroachdb, mssql. Omit to return all supported databases.",
      },
      include: {
        type: "string",
        enum: ["all", "versions", "performance"],
        description:
          "What to include: 'all' (default), 'versions' (EOL/release data only), 'performance' (benchmark profiles only).",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      databases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug:             { type: "string" },
            display_name:     { type: "string" },
            type:             { type: "string" },
            version_status:   { type: ["object", "null"] },
            performance_profile: { type: ["object", "null"] },
          },
        },
      },
      count:        { type: "integer" },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const include = query.include || "all";

    let slugs;
    if (query.database) {
      const key = query.database.toLowerCase().trim();
      const resolved = DB_SLUGS[key];
      if (!resolved) {
        throw new Error(
          `Unknown database '${query.database}'. Supported: ${Object.keys(DB_SLUGS).filter((k, i, a) => a.indexOf(k) === i).join(", ")}`
        );
      }
      slugs = [resolved];
    } else {
      slugs = ALL_DBS;
    }

    const results = await Promise.all(slugs.map(getDatabaseIntel));

    // Strip fields based on include param
    const shaped = results.map(r => {
      const out = { slug: r.slug, display_name: r.display_name, type: r.type };
      if (include !== "performance") out.version_status = r.version_status;
      if (include !== "versions")   out.performance_profile = r.performance_profile;
      return out;
    });

    return {
      databases:    shaped,
      count:        shaped.length,
      generated_at: new Date().toISOString(),
    };
  },
};
