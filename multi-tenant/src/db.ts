/**
 * Tenant registry backed by SQLite (better-sqlite3).
 *
 * Schema:
 *   tenants             — one row per tenant
 *   tenant_credentials  — per-tenant provider API keys (OPENAI_API_KEY, etc.)
 *                         injected as env vars into that tenant's openclaw instance
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  email: string;
  /** API key the tenant uses to authenticate to this proxy */
  api_key: string;
  /** Gateway token injected into the tenant's openclaw instance */
  openclaw_token: string;
  /** Absolute path to this tenant's isolated state directory */
  state_dir: string;
  /** Currently assigned port (null if instance is not running) */
  port: number | null;
  created_at: number;
  /** 1 = active, 0 = disabled */
  active: number;
}

// ── DB singleton ─────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  return _db;
}

// ── Initialisation ───────────────────────────────────────────────────────────

export function initDb(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      email          TEXT UNIQUE NOT NULL,
      api_key        TEXT UNIQUE NOT NULL,
      openclaw_token TEXT NOT NULL,
      state_dir      TEXT NOT NULL,
      port           INTEGER,
      created_at     INTEGER NOT NULL,
      active         INTEGER NOT NULL DEFAULT 1
    );

    -- Per-tenant provider credentials (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY).
    -- Each row is one env var injected exclusively into that tenant's openclaw process.
    -- Values are stored in plaintext; use filesystem-level encryption for at-rest protection.
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,   -- env var name, e.g. "OPENAI_API_KEY"
      value      TEXT NOT NULL,   -- env var value
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
  `);
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function createTenant(
  name: string,
  email: string
): { id: string; apiKey: string } {
  const db = getDb();
  const id = randomBytes(8).toString("hex");
  const apiKey = `mt_${randomBytes(24).toString("hex")}`;
  const openclawToken = randomBytes(32).toString("hex");
  const stateDir = `${config.tenantsDir}/${id}`;

  db.prepare(
    `INSERT INTO tenants (id, name, email, api_key, openclaw_token, state_dir, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, email, apiKey, openclawToken, stateDir, Date.now());

  return { id, apiKey };
}

export function getTenantByApiKey(apiKey: string): Tenant | undefined {
  return getDb()
    .prepare("SELECT * FROM tenants WHERE api_key = ? AND active = 1")
    .get(apiKey) as Tenant | undefined;
}

export function getTenantById(id: string): Tenant | undefined {
  return getDb()
    .prepare("SELECT * FROM tenants WHERE id = ?")
    .get(id) as Tenant | undefined;
}

export function listTenants(): Omit<Tenant, "api_key" | "openclaw_token">[] {
  return getDb()
    .prepare(
      "SELECT id, name, email, state_dir, port, created_at, active FROM tenants ORDER BY created_at DESC"
    )
    .all() as Omit<Tenant, "api_key" | "openclaw_token">[];
}

export function setTenantPort(id: string, port: number | null): void {
  getDb()
    .prepare("UPDATE tenants SET port = ? WHERE id = ?")
    .run(port, id);
}

export function setTenantActive(id: string, active: boolean): void {
  getDb()
    .prepare("UPDATE tenants SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, id);
}

export function rotateTenantApiKey(id: string): string {
  const newKey = `mt_${randomBytes(24).toString("hex")}`;
  getDb()
    .prepare("UPDATE tenants SET api_key = ? WHERE id = ?")
    .run(newKey, id);
  return newKey;
}

// ── Per-tenant credentials ────────────────────────────────────────────────────

export function setTenantCredential(tenantId: string, key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO tenant_credentials (tenant_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(tenantId, key, value, Date.now());
}

export function deleteTenantCredential(tenantId: string, key: string): void {
  getDb()
    .prepare("DELETE FROM tenant_credentials WHERE tenant_id = ? AND key = ?")
    .run(tenantId, key);
}

export function getTenantCredentials(tenantId: string): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM tenant_credentials WHERE tenant_id = ?")
    .all(tenantId) as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function listTenantCredentialKeys(tenantId: string): string[] {
  const rows = getDb()
    .prepare("SELECT key FROM tenant_credentials WHERE tenant_id = ? ORDER BY key")
    .all(tenantId) as { key: string }[];
  return rows.map((r) => r.key);
}
