// registry.js — loads only approved MYRIAD capability modules from /capabilities
// and validates their shape.

import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAP_DIR = join(__dirname, "..", "capabilities");

const REQUIRED = [
  "name",
  "price",
  "description",
  "inputSchema",
  "outputSchema",
  "handler",
];

// MYRIAD v1 capability allowlist.
// Capability files can remain in /capabilities without being exposed.
const ENABLED_CAPABILITIES = new Set([


  // COMPANIES
  "company-due-diligence",
  "company-intel",
  "congressional-trades",
  "fec-donor-intel",
  "federal-contract-intel",
  "form-144-intel",
  "hedge-fund-holdings",
  "insider-trades",
  "ipo-calendar",
  "legal-search",
  "sec-filing-intel",
  "sec-insider-trades",
  "short-volume-intel",
  "web-company-intel",
  "sanctions-screening",

  // RESEARCH
  "arxiv-intel",
  "citation-formatter",
  "clinical-trials",
  "cve-intel",
  "db-perf-intel",
  "drug-intel",
  "fda-recall-watch",
  "github-repo-intel",
  "hf-model-search",
  "hn-search",
  "npi-lookup",
  "research-paper-search",
  "stackoverflow-intel",
  "wikipedia-intel",
  "research-synthesis",

  // WORLD
  "air-quality",
  "aviation-weather",
  "country-info",
  "earthquake-intel",
  "flight-tracker",
  "geocode",
  "gov-votes",
  "imf-country-outlook",
  "labor-market",
  "policy-impact-mapper",
  "solar-intel",
  "weather",
  "weather-alerts",
  "world-bank-data",
  "city-lookup",

  // WEB
  "agent-access-check",
  "domain-whois",
  "dns-lookup",
  "ip-intel",
  "news-sentiment",
  "page-intel",
  "readable-content",
  "reddit-intel",
  "wayback-intel",
  "web-change-monitor",

  // VERIFICATION
  "fact-check",
  "email-verify",
  "http-headers",
  "image-detect",
  "ssl-cert",
  "vision-analyze",
  "code-test-detector",
  "code-api-surface",
  "npm-lookup",
  "pypi-lookup",
]);

function validate(mod, file) {
  for (const key of REQUIRED) {
    if (mod[key] === undefined) {
      throw new Error(`capability "${file}" is missing required field: ${key}`);
    }
  }

  if (!/^[a-z0-9-]+$/.test(mod.name)) {
    throw new Error(
      `capability "${file}" name must be url-safe (a-z 0-9 -): got "${mod.name}"`
    );
  }

  if (typeof mod.handler !== "function") {
    throw new Error(`capability "${file}" handler must be a function`);
  }

  if (!/^\$\d/.test(String(mod.price))) {
    throw new Error(
      `capability "${file}" price must look like "$0.001": got "${mod.price}"`
    );
  }

  return mod;
}

export async function loadCapabilities() {
  const files = readdirSync(CAP_DIR).filter(
    (f) =>
      f.endsWith(".js") &&
      !f.startsWith("_") &&
      ENABLED_CAPABILITIES.has(f.replace(/\.js$/, ""))
  );

  const caps = [];

  for (const file of files) {
    const mod = (
      await import(pathToFileURL(join(CAP_DIR, file)).href)
    ).default;

    const validated = validate(mod, file);

    // Extra safety: ensure the module's declared name is also approved.
    if (!ENABLED_CAPABILITIES.has(validated.name)) {
      continue;
    }

    caps.push(validated);
  }

  return caps;
}