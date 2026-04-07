import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyBundle } from "./lib/openclaw-bundle-verify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const outDir = path.join(appRoot, "vendor", "openclaw");

try {
  verifyBundle({ outDir });
  console.log(`[electron-desktop] OpenClaw bundle verification passed: ${outDir}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}
