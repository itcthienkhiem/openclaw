#!/usr/bin/env tsx
/**
 * Admin CLI for OpenClaw Multi-Tenant
 *
 * Usage (run from multi-tenant/ directory):
 *   pnpm tenant create <name> <email>
 *   pnpm tenant list
 *   pnpm tenant disable <id>
 *   pnpm tenant rotate-key <id>
 *   pnpm tenant instances
 *
 * Requires MT_ADMIN_KEY and MT_API_URL env vars (or defaults to localhost:3000).
 */

const BASE_URL = process.env.MT_API_URL ?? "http://localhost:3000";
const ADMIN_KEY = process.env.MT_ADMIN_KEY ?? "";

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": ADMIN_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Error ${res.status}:`, data);
    process.exit(1);
  }
  return data;
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "create": {
    const [name, email] = args;
    if (!name || !email) {
      console.error("Usage: pnpm tenant create <name> <email>");
      process.exit(1);
    }
    const result = await request("POST", "/admin/tenants", { name, email });
    console.log("\nTenant created:");
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case "list": {
    const tenants = await request("GET", "/admin/tenants");
    console.table(tenants);
    break;
  }

  case "disable": {
    const [id] = args;
    if (!id) { console.error("Usage: pnpm tenant disable <id>"); process.exit(1); }
    const result = await request("DELETE", `/admin/tenants/${id}`);
    console.log(result);
    break;
  }

  case "rotate-key": {
    const [id] = args;
    if (!id) { console.error("Usage: pnpm tenant rotate-key <id>"); process.exit(1); }
    const result = await request("POST", `/admin/tenants/${id}/rotate-key`);
    console.log("New API key:", result);
    break;
  }

  case "instances": {
    const result = await request("GET", "/admin/instances");
    console.table(result);
    break;
  }

  case "stop-instance": {
    const [id] = args;
    if (!id) { console.error("Usage: pnpm tenant stop-instance <id>"); process.exit(1); }
    const result = await request("POST", `/admin/instances/${id}/stop`);
    console.log(result);
    break;
  }

  // ── Per-tenant credentials ─────────────────────────────────────────────────

  case "credentials": {
    // List credential keys for a tenant (values are never shown)
    const [id] = args;
    if (!id) { console.error("Usage: pnpm tenant credentials <tenant-id>"); process.exit(1); }
    const result = await request("GET", `/admin/tenants/${id}/credentials`);
    console.log(result);
    break;
  }

  case "set-credential": {
    // pnpm tenant set-credential <tenant-id> <KEY> <value>
    const [id, key, value] = args;
    if (!id || !key || !value) {
      console.error("Usage: pnpm tenant set-credential <tenant-id> <KEY> <value>");
      console.error("Example: pnpm tenant set-credential abc123 OPENAI_API_KEY sk-...");
      process.exit(1);
    }
    const result = await request("PUT", `/admin/tenants/${id}/credentials/${key}`, { value });
    console.log(result);
    break;
  }

  case "delete-credential": {
    const [id, key] = args;
    if (!id || !key) {
      console.error("Usage: pnpm tenant delete-credential <tenant-id> <KEY>");
      process.exit(1);
    }
    const result = await request("DELETE", `/admin/tenants/${id}/credentials/${key}`);
    console.log(result);
    break;
  }

  default:
    console.log(`
OpenClaw Multi-Tenant CLI

Tenant management:
  create <name> <email>            Create a new tenant
  list                             List all tenants
  disable <id>                     Disable a tenant (stops their instance)
  rotate-key <id>                  Rotate a tenant's API key

Per-tenant API keys (workspace riêng, API riêng):
  credentials <id>                 List credential keys configured for tenant
  set-credential <id> <KEY> <val>  Set a provider API key for a tenant
                                   e.g.: set-credential abc OPENAI_API_KEY sk-xxx
                                         set-credential abc ANTHROPIC_API_KEY sk-ant-xxx
                                         set-credential abc TELEGRAM_BOT_TOKEN 123:xxx
  delete-credential <id> <KEY>     Remove a credential

Instances:
  instances                        List running openclaw instances
  stop-instance <id>               Stop a tenant's openclaw instance

Environment:
  MT_API_URL    Proxy URL (default: http://localhost:3000)
  MT_ADMIN_KEY  Admin secret key
`);
}
