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
 *   GET  /healthz                — liveness probe
 *   *    (any other path)        — proxied to tenant's openclaw instance
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
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

// ── Server ────────────────────────────────────────────────────────────────────

initDb();

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  // Liveness probe — no auth required
  if (pathname === "/healthz") {
    json(res, 200, { status: "ok", service: "openclaw-multi-tenant" });
    return;
  }

  // Admin API
  if (pathname.startsWith("/admin/")) {
    await handleAdmin(req, res, pathname);
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
  console.log(`  Listening  : http://0.0.0.0:${config.port}`);
  console.log(`  Mode       : ${config.mode}`);
  console.log(`  Admin API  : POST /admin/tenants  (X-Admin-Key required)`);
  if (!config.adminKey) {
    console.warn(`\n  [WARN] MT_ADMIN_KEY is not set — admin endpoints are disabled!\n`);
  }
});
