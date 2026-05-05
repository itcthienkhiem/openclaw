/**
 * OpenClaw Multi-Tenant Proxy
 *
 * A thin HTTP server that:
 *   1. Authenticates requests using per-tenant API keys
 *   2. Ensures the tenant's openclaw instance is running (lazy start)
 *   3. Proxies the request (HTTP + WebSocket) to that instance
 *
 * Admin endpoints (require X-Admin-Key header):
 *   POST   /admin/tenants                           — create a new tenant
 *   GET    /admin/tenants                           — list all tenants
 *   DELETE /admin/tenants/:id                       — disable a tenant
 *   POST   /admin/tenants/:id/rotate-key            — rotate API key
 *   GET    /admin/tenants/:id/credentials           — list credential keys (no values)
 *   PUT    /admin/tenants/:id/credentials/:key      — set a credential (e.g. OPENAI_API_KEY)
 *   DELETE /admin/tenants/:id/credentials/:key      — delete a credential
 *   GET    /admin/instances                         — list running instances
 *   POST   /admin/instances/:id/stop               — stop an instance
 *
 * Public endpoints:
 *   GET  /                       — User Portal UI (self-register / login / dashboard)
 *   GET  /portal                 — same as above
 *   POST /auth/register          — self-register (name, email) → returns apiKey
 *   GET  /healthz                — liveness probe
 *
 * User self-service (auth via Authorization: Bearer <apiKey>):
 *   GET    /me                         — profile + instance status
 *   GET    /me/credentials             — list own credential keys
 *   PUT    /me/credentials/:key        — set own credential
 *   DELETE /me/credentials/:key        — delete own credential
 *   POST   /me/rotate-key              — rotate own API key
 *
 *   *    (any other path)        — proxied to tenant's openclaw instance
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  initDb,
  createTenant,
  listTenants,
  getTenantByApiKey,
  setTenantActive,
  rotateTenantApiKey,
  setTenantCredential,
  deleteTenantCredential,
  listTenantCredentialKeys,
} from "./db.js";
import { ensureInstance, stopInstance, runningInstances } from "./manager.js";
import { proxyHttp, proxyWebSocket } from "./proxy.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ADMIN_HTML  = readFileSync(join(__dirname, "ui/admin.html"));
const PORTAL_HTML = readFileSync(join(__dirname, "ui/portal.html"));

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function extractApiKey(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1]!;
  }
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey) return xKey;
  return null;
}

function isAdminAuthed(req: IncomingMessage): boolean {
  if (!config.adminKey) {
    console.warn("[warn] MT_ADMIN_KEY is not set — admin endpoints are disabled");
    return false;
  }
  return req.headers["x-admin-key"] === config.adminKey;
}

// ── Admin handler ─────────────────────────────────────────────────────────────

async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (!isAdminAuthed(req)) {
    json(res, 403, { error: "Forbidden", message: "Invalid or missing X-Admin-Key" });
    return;
  }

  // POST /admin/tenants — create tenant
  if (req.method === "POST" && pathname === "/admin/tenants") {
    const body = (await readBody(req)) as Record<string, string>;
    const { name, email } = body;
    if (!name || !email) {
      json(res, 400, { error: "Bad Request", message: "name and email are required" });
      return;
    }
    const tenant = createTenant(name, email);
    json(res, 201, {
      ...tenant,
      note: "Save the apiKey now — it will not be shown again.",
    });
    return;
  }

  // GET /admin/tenants — list tenants
  if (req.method === "GET" && pathname === "/admin/tenants") {
    json(res, 200, listTenants());
    return;
  }

  // DELETE /admin/tenants/:id — disable tenant
  const deleteMatch = pathname.match(/^\/admin\/tenants\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const id = deleteMatch[1]!;
    setTenantActive(id, false);
    stopInstance(id);
    json(res, 200, { ok: true, message: `Tenant ${id} disabled` });
    return;
  }

  // POST /admin/tenants/:id/rotate-key — rotate API key
  const rotateMatch = pathname.match(/^\/admin\/tenants\/([^/]+)\/rotate-key$/);
  if (req.method === "POST" && rotateMatch) {
    const id = rotateMatch[1]!;
    const newKey = rotateTenantApiKey(id);
    json(res, 200, { id, apiKey: newKey });
    return;
  }

  // GET /admin/instances — running instances
  if (req.method === "GET" && pathname === "/admin/instances") {
    json(res, 200, runningInstances());
    return;
  }

  // GET /admin/tenants/:id/credentials — list credential keys (values hidden)
  const credListMatch = pathname.match(/^\/admin\/tenants\/([^/]+)\/credentials$/);
  if (req.method === "GET" && credListMatch) {
    const id = credListMatch[1]!;
    json(res, 200, { tenantId: id, keys: listTenantCredentialKeys(id) });
    return;
  }

  // PUT /admin/tenants/:id/credentials/:key — set a credential
  const credSetMatch = pathname.match(/^\/admin\/tenants\/([^/]+)\/credentials\/([^/]+)$/);
  if (req.method === "PUT" && credSetMatch) {
    const [, tenantId, key] = credSetMatch as [string, string, string];
    const body = (await readBody(req)) as Record<string, string>;
    if (!body.value) {
      json(res, 400, { error: "Bad Request", message: "body.value is required" });
      return;
    }
    setTenantCredential(tenantId, key, body.value);
    // Restart instance so new credential takes effect
    stopInstance(tenantId);
    json(res, 200, { ok: true, tenantId, key, message: "Credential saved. Instance will restart on next request." });
    return;
  }

  // DELETE /admin/tenants/:id/credentials/:key — delete a credential
  if (req.method === "DELETE" && credSetMatch) {
    const [, tenantId, key] = credSetMatch as [string, string, string];
    deleteTenantCredential(tenantId, key);
    stopInstance(tenantId);
    json(res, 200, { ok: true, tenantId, key, message: "Credential deleted. Instance will restart on next request." });
    return;
  }

  // POST /admin/instances/:id/stop — stop instance
  const stopMatch = pathname.match(/^\/admin\/instances\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    const id = stopMatch[1]!;
    stopInstance(id);
    json(res, 200, { ok: true, message: `Instance ${id} stopped` });
    return;
  }

  json(res, 404, { error: "Not Found" });
}

// ── User self-service handler (/auth/*, /me/*) ────────────────────────────────

async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  // POST /auth/register — self-registration (can be disabled via MT_ALLOW_SELF_REGISTER=false)
  if (req.method === "POST" && pathname === "/auth/register") {
    if (!config.allowSelfRegister) {
      json(res, 403, { error: "Forbidden", message: "Self-registration is disabled" });
      return;
    }
    const body = (await readBody(req)) as Record<string, string>;
    const { name, email } = body;
    if (!name || !email) {
      json(res, 400, { error: "Bad Request", message: "name and email are required" });
      return;
    }
    try {
      const tenant = createTenant(name, email);
      json(res, 201, { ...tenant, message: "Account created. Save your apiKey — it will not be shown again." });
    } catch (e: unknown) {
      // email unique constraint
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) {
        json(res, 409, { error: "Conflict", message: "Email already registered" });
      } else {
        json(res, 500, { error: "Internal Server Error", message: msg });
      }
    }
    return;
  }

  json(res, 404, { error: "Not Found" });
}

async function handleMe(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  apiKey: string
): Promise<void> {
  const tenant = getTenantByApiKey(apiKey);
  if (!tenant) {
    json(res, 401, { error: "Unauthorized", message: "Invalid API key" });
    return;
  }

  // GET /me — tenant profile + instance status
  if (req.method === "GET" && pathname === "/me") {
    const running = runningInstances().find(i => i.tenantId === tenant.id);
    json(res, 200, {
      id: tenant.id,
      name: tenant.name,
      email: tenant.email,
      active: tenant.active === 1,
      port: running?.port ?? null,
      idleSec: running?.idleSec ?? null,
    });
    return;
  }

  // GET /me/credentials — list own credential keys (no values)
  if (req.method === "GET" && pathname === "/me/credentials") {
    json(res, 200, { keys: listTenantCredentialKeys(tenant.id) });
    return;
  }

  // PUT /me/credentials/:key — set own credential
  const credSetMatch = pathname.match(/^\/me\/credentials\/([^/]+)$/);
  if (req.method === "PUT" && credSetMatch) {
    const key = credSetMatch[1]!;
    const body = (await readBody(req)) as Record<string, string>;
    if (!body.value) {
      json(res, 400, { error: "Bad Request", message: "body.value is required" });
      return;
    }
    setTenantCredential(tenant.id, key, body.value);
    stopInstance(tenant.id);
    json(res, 200, { ok: true, key, message: "Saved. Your instance will restart on next request." });
    return;
  }

  // DELETE /me/credentials/:key — delete own credential
  if (req.method === "DELETE" && credSetMatch) {
    const key = credSetMatch[1]!;
    deleteTenantCredential(tenant.id, key);
    stopInstance(tenant.id);
    json(res, 200, { ok: true, key, message: "Deleted. Your instance will restart on next request." });
    return;
  }

  // POST /me/rotate-key — rotate own API key
  if (req.method === "POST" && pathname === "/me/rotate-key") {
    const newKey = rotateTenantApiKey(tenant.id);
    json(res, 200, { apiKey: newKey, message: "API key rotated. Old key is now invalid." });
    return;
  }

  json(res, 404, { error: "Not Found" });
}

// ── Server ────────────────────────────────────────────────────────────────────

initDb();

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  // Liveness probe — no auth required
  if (pathname === "/healthz") {
    json(res, 200, { status: "ok", service: "openclaw-multi-tenant" });
    return;
  }

  // Portal UI — user self-service page at /  and /portal
  if (pathname === "/" || pathname === "/portal" || pathname === "/portal/") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PORTAL_HTML);
      return;
    }
  }

  // Admin UI — serve HTML for browser GET requests to /admin
  if (pathname === "/admin" || pathname === "/admin/") {
    if (req.method === "GET" && !req.headers["x-admin-key"]) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ADMIN_HTML);
      return;
    }
  }

  // Admin API
  if (pathname.startsWith("/admin/")) {
    await handleAdmin(req, res, pathname);
    return;
  }

  // Auth routes (public) — register
  if (pathname.startsWith("/auth/")) {
    await handleAuth(req, res, pathname);
    return;
  }

  // User self-service routes — require tenant API key
  if (pathname.startsWith("/me")) {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      json(res, 401, { error: "Unauthorized", message: "Provide your API key via Authorization: Bearer <key>" });
      return;
    }
    await handleMe(req, res, pathname, apiKey);
    return;
  }

  // Tenant proxy — authenticate via API key
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    json(res, 401, {
      error: "Unauthorized",
      message: "Provide your API key via: Authorization: Bearer <key>  or  X-Api-Key: <key>",
    });
    return;
  }

  const tenant = getTenantByApiKey(apiKey);
  if (!tenant) {
    json(res, 401, { error: "Unauthorized", message: "Invalid API key" });
    return;
  }

  try {
    const { port } = await ensureInstance(tenant);
    proxyHttp(req, res, port, tenant.openclaw_token);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server] failed to start instance for tenant ${tenant.id}:`, msg);
    json(res, 503, { error: "Service Unavailable", detail: msg });
  }
});

// WebSocket upgrade proxy
server.on("upgrade", async (req: IncomingMessage, socket, head: Buffer) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    socket.destroy();
    return;
  }

  const tenant = getTenantByApiKey(apiKey);
  if (!tenant) {
    socket.destroy();
    return;
  }

  try {
    const { port } = await ensureInstance(tenant);
    proxyWebSocket(req, socket, head, port, tenant.openclaw_token);
  } catch (err) {
    console.error(`[server] WS proxy failed for tenant ${tenant.id}:`, err);
    socket.destroy();
  }
});

// Graceful shutdown
function shutdown() {
  console.log("\n[server] shutting down…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(config.port, () => {
  console.log(`\nOpenClaw Multi-Tenant Proxy`);
  console.log(`  Portal     : http://0.0.0.0:${config.port}/`);
  console.log(`  Admin UI   : http://0.0.0.0:${config.port}/admin`);
  console.log(`  Mode       : ${config.mode}`);
  console.log(`  Register   : ${config.allowSelfRegister ? "enabled (POST /auth/register)" : "disabled (MT_ALLOW_SELF_REGISTER=false)"}`);
  if (!config.adminKey) {
    console.warn(`\n  [WARN] MT_ADMIN_KEY is not set — admin endpoints are disabled!\n`);
  }
});
