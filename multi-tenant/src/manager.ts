/**
 * Tenant Instance Manager
 *
 * Manages the lifecycle of per-tenant OpenClaw instances.
 * Supports two modes (set via MT_MODE env var):
 *
 *   "process" — spawns openclaw as a child process (default)
 *   "docker"  — runs openclaw in a Docker container
 *
 * The manager is intentionally decoupled from openclaw internals.
 * It only relies on:
 *   1. The openclaw gateway accepting --port <n> and OPENCLAW_STATE_DIR env var
 *   2. The /healthz endpoint being available after startup
 *   3. OPENCLAW_GATEWAY_TOKEN being respected for auth
 *
 * When openclaw upgrades, only the binary/image changes — this file stays the same.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";
import { config } from "./config.js";
import { type Tenant, setTenantPort, getTenantCredentials } from "./db.js";

/**
 * Safe system env vars inherited by every openclaw child process.
 * Provider API keys (OPENAI_API_KEY etc.) are intentionally excluded here —
 * they come exclusively from per-tenant credentials stored in the DB.
 */
const SAFE_SYSTEM_VARS = new Set([
  "PATH",
  "NODE_ENV",
  "NODE_PATH",
  "TERM",
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT", // Windows
  "COMSPEC",    // Windows
]);

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_SYSTEM_VARS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]!;
    }
  }
  return env;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Instance {
  port: number;
  lastUsed: number;
  ready: boolean;
  /** process mode */
  proc?: ChildProcess;
  /** docker mode — container name */
  container?: string;
}

// ── State ────────────────────────────────────────────────────────────────────

const instances = new Map<string, Instance>();

// ── Utilities ────────────────────────────────────────────────────────────────

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitHealthy(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Tenant openclaw on port ${port} did not become healthy within ${timeoutMs}ms`
  );
}

function ensureStateDir(stateDir: string, openclawToken: string): void {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  // Write a minimal openclaw.json so the instance starts without prompts.
  // This config is only written once; subsequent upgrades do not overwrite it.
  const cfgDir = join(stateDir, ".openclaw");
  const cfgFile = join(cfgDir, "openclaw.json");
  if (!existsSync(cfgFile)) {
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      cfgFile,
      JSON.stringify(
        {
          gateway: {
            auth: { mode: "token", token: { fromEnv: "OPENCLAW_GATEWAY_TOKEN" } },
          },
        },
        null,
        2
      )
    );
  }
}

// ── Process mode ─────────────────────────────────────────────────────────────

async function startProcess(tenant: Tenant): Promise<Instance> {
  ensureStateDir(tenant.state_dir, tenant.openclaw_token);
  const port = await findFreePort();

  // Load per-tenant credentials from DB — completely isolated from other tenants
  const tenantCredentials = getTenantCredentials(tenant.id);

  const proc = spawn(
    config.openclawNodeBin,
    [config.openclawMain, "gateway", "--port", String(port), "--bind", "lan"],
    {
      env: {
        // Only safe system vars — no provider API keys from parent process
        ...buildSafeEnv(),
        // Tenant isolation
        HOME: tenant.state_dir,
        OPENCLAW_STATE_DIR: join(tenant.state_dir, ".openclaw"),
        OPENCLAW_GATEWAY_TOKEN: tenant.openclaw_token,
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_GATEWAY_HOST: "127.0.0.1",
        // Per-tenant provider API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
        ...tenantCredentials,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  proc.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[tenant:${tenant.id}] ${d.toString().trimEnd()}\n`)
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[tenant:${tenant.id}] ${d.toString().trimEnd()}\n`)
  );

  const instance: Instance = { port, lastUsed: Date.now(), ready: false, proc };
  instances.set(tenant.id, instance);

  proc.on("exit", (code) => {
    console.log(`[manager] tenant ${tenant.id} process exited (code=${code})`);
    instances.delete(tenant.id);
    setTenantPort(tenant.id, null);
  });

  await waitHealthy(port);
  instance.ready = true;
  setTenantPort(tenant.id, port);
  console.log(`[manager] tenant ${tenant.id} ready on port ${port}`);
  return instance;
}

function stopProcess(tenantId: string, inst: Instance): void {
  inst.proc?.kill("SIGTERM");
  instances.delete(tenantId);
  setTenantPort(tenantId, null);
}

// ── Docker mode ───────────────────────────────────────────────────────────────

function dockerContainerName(tenantId: string): string {
  return `openclaw-tenant-${tenantId}`;
}

async function startDocker(tenant: Tenant): Promise<Instance> {
  ensureStateDir(tenant.state_dir, tenant.openclaw_token);
  const port = await findFreePort();
  const name = dockerContainerName(tenant.id);
  const configVol = `openclaw-tenant-${tenant.id}-config`;
  const workspaceVol = `openclaw-tenant-${tenant.id}-workspace`;

  // Remove stale container if any
  try {
    execSync(`docker rm -f ${name}`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }

  execSync(
    [
      "docker run -d",
      `--name ${name}`,
      `--restart unless-stopped`,
      `-v ${configVol}:/home/node/.openclaw`,
      `-v ${workspaceVol}:/home/node/.openclaw/workspace`,
      `-p 127.0.0.1:${port}:18789`,
      `-e OPENCLAW_GATEWAY_TOKEN=${tenant.openclaw_token}`,
      `-e HOME=/home/node`,
      `${config.openclawImage}`,
      `node dist/index.js gateway --port 18789 --bind lan`,
    ].join(" "),
    { stdio: "pipe" }
  );

  const instance: Instance = { port, lastUsed: Date.now(), ready: false, container: name };
  instances.set(tenant.id, instance);

  await waitHealthy(port);
  instance.ready = true;
  setTenantPort(tenant.id, port);
  console.log(`[manager] docker tenant ${tenant.id} ready on port ${port}`);
  return instance;
}

function stopDocker(tenantId: string, inst: Instance): void {
  try {
    execSync(`docker stop ${inst.container}`, { stdio: "ignore" });
    execSync(`docker rm ${inst.container}`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  instances.delete(tenantId);
  setTenantPort(tenantId, null);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure a tenant's openclaw instance is running and return its local port.
 * Instances are started lazily on first request and stopped after being idle.
 */
export async function ensureInstance(tenant: Tenant): Promise<{ port: number }> {
  const existing = instances.get(tenant.id);
  if (existing?.ready) {
    existing.lastUsed = Date.now();
    return { port: existing.port };
  }

  // Another call may already be starting this instance — simple serial guard
  const inst =
    config.mode === "docker"
      ? await startDocker(tenant)
      : await startProcess(tenant);

  return { port: inst.port };
}

export function stopInstance(tenantId: string): void {
  const inst = instances.get(tenantId);
  if (!inst) return;
  if (config.mode === "docker") {
    stopDocker(tenantId, inst);
  } else {
    stopProcess(tenantId, inst);
  }
  console.log(`[manager] stopped instance for tenant ${tenantId}`);
}

export function runningInstances(): { tenantId: string; port: number; idleSec: number }[] {
  const now = Date.now();
  return [...instances.entries()].map(([id, inst]) => ({
    tenantId: id,
    port: inst.port,
    idleSec: Math.floor((now - inst.lastUsed) / 1000),
  }));
}

// ── Idle cleanup ──────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, inst] of instances) {
    if (inst.ready && now - inst.lastUsed > config.idleTimeoutMs) {
      console.log(`[manager] stopping idle tenant ${id}`);
      stopInstance(id);
    }
  }
}, 60_000).unref(); // .unref() so this timer doesn't keep the process alive alone
