// Configuration — all settings come from environment variables.
// No openclaw source files are read or modified.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const config = {
  /** Port the multi-tenant proxy listens on */
  port: parseInt(process.env.MT_PORT ?? "3000"),

  /** Secret key required for admin API calls */
  adminKey: process.env.MT_ADMIN_KEY ?? "",

  /** Path to the SQLite database storing tenant records */
  dbPath: process.env.MT_DB_PATH ?? join(__dirname, "../../data/tenants.db"),

  /** Root directory where per-tenant state is stored */
  tenantsDir:
    process.env.MT_TENANTS_DIR ?? join(__dirname, "../../data/tenants"),

  /**
   * Runtime mode:
   *   "process" — spawn openclaw as a child process (default, no Docker needed)
   *   "docker"  — run openclaw in a Docker container per tenant
   */
  mode: (process.env.MT_MODE ?? "process") as "process" | "docker",

  /** Docker image to use in docker mode */
  openclawImage: process.env.OPENCLAW_IMAGE ?? "openclaw:local",

  /**
   * process mode: path to the Node.js binary (default "node")
   */
  openclawNodeBin: process.env.OPENCLAW_NODE_BIN ?? "node",

  /**
   * process mode: path to the openclaw dist entry point (absolute or relative to cwd)
   */
  openclawMain:
    process.env.OPENCLAW_MAIN ?? join(__dirname, "../../../dist/index.js"),

  /** Internal port openclaw gateway listens on inside each instance */
  openclawGatewayPort: parseInt(process.env.OPENCLAW_INTERNAL_PORT ?? "18789"),

  /** Milliseconds of inactivity before an idle instance is stopped (default 30 min) */
  idleTimeoutMs: parseInt(process.env.MT_IDLE_TIMEOUT_MS ?? "1800000"),

  /**
   * Allow users to self-register via POST /auth/register (default: true).
   * Set MT_ALLOW_SELF_REGISTER=false to disable public registration.
   */
  allowSelfRegister: process.env.MT_ALLOW_SELF_REGISTER !== "false",

  /** App name shown in the portal UI */
  appName: process.env.MT_APP_NAME ?? "OpenClaw",
} as const;
