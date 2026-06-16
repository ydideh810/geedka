// registry.js — loads every capability module in /capabilities and validates
// its shape. This is the "function slot." New capability modules drop in here;
// the chassis itself never needs editing to add one.

import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAP_DIR = join(__dirname, "..", "capabilities");

const REQUIRED = ["name", "price", "description", "inputSchema", "outputSchema", "handler"];

function validate(mod, file) {
  for (const key of REQUIRED) {
    if (mod[key] === undefined) {
      throw new Error(`capability "${file}" is missing required field: ${key}`);
    }
  }
  if (!/^[a-z0-9-]+$/.test(mod.name)) {
    throw new Error(`capability "${file}" name must be url-safe (a-z 0-9 -): got "${mod.name}"`);
  }
  if (typeof mod.handler !== "function") {
    throw new Error(`capability "${file}" handler must be a function`);
  }
  if (!/^\$\d/.test(String(mod.price))) {
    throw new Error(`capability "${file}" price must look like "$0.001": got "${mod.price}"`);
  }
  return mod;
}

export async function loadCapabilities() {
  const files = readdirSync(CAP_DIR).filter(
    (f) => f.endsWith(".js") && !f.startsWith("_")
  );
  const caps = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(CAP_DIR, file)).href)).default;
    caps.push(validate(mod, file));
  }
  return caps;
}
