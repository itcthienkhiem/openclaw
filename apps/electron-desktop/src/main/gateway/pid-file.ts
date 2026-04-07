import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getPlatform } from "../platform";

const PID_FILENAME = "gateway.pid";

/**
 * Write the gateway child PID to a file so we can clean up orphans on next launch.
 */
export function writeGatewayPid(stateDir: string, pid: number): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, PID_FILENAME), String(pid), "utf-8");
  } catch (err) {
    console.warn("[pid-file] writeGatewayPid failed:", err);
  }
}

/**
 * Remove the gateway PID file (called on clean shutdown).
 */
export function removeGatewayPid(stateDir: string): void {
  try {
    fs.unlinkSync(path.join(stateDir, PID_FILENAME));
  } catch {
    // File may not exist — that's fine.
  }
}

/**
 * Read a previously written PID and kill the orphaned process if it is still alive.
 * Returns the killed PID (or null if nothing was running).
 */
export function killOrphanedGateway(stateDir: string): number | null {
  const pidPath = path.join(stateDir, PID_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(pidPath, "utf-8").trim();
  } catch {
    return null;
  }
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) {
    removeGatewayPid(stateDir);
    return null;
  }

  const platform = getPlatform();

  // Check if the process is still alive.
  if (!platform.isProcessAlive(pid)) {
    removeGatewayPid(stateDir);
    return null;
  }

  // Process is alive — kill the entire process tree immediately.
  console.warn(`[pid-file] Killing orphaned gateway process tree (PID ${pid})`);
  try {
    platform.killProcessTree(pid);
  } catch (err) {
    console.warn("[pid-file] killProcessTree failed:", err);
  }

  // Brief wait to confirm the process is dead.
  try {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      if (!platform.isProcessAlive(pid)) {
        removeGatewayPid(stateDir);
        return pid;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  } catch (err) {
    console.warn("[pid-file] kill confirmation failed:", err);
  }

  removeGatewayPid(stateDir);
  return pid;
}

/**
 * Remove the gateway singleton lock file so the next spawn can acquire it.
 * The lock lives at: os.tmpdir()/openclaw-<uid>/gateway.<hash>.lock
 * where <hash> = sha1(configPath).slice(0, 8).
 */
export function removeStaleGatewayLock(configPath: string): void {
  try {
    const lockDir = path.join(os.tmpdir(), getPlatform().gatewayLockDirSuffix());
    const hash = createHash("sha1").update(configPath).digest("hex").slice(0, 8);
    const lockPath = path.join(lockDir, `gateway.${hash}.lock`);

    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      console.log(`[pid-file] Removed stale gateway lock: ${lockPath}`);
    }
  } catch (err) {
    console.warn("[pid-file] removeStaleGatewayLock failed:", err);
  }
}
