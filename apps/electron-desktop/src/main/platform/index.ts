import { DarwinPlatform } from "./darwin";
import type { Platform } from "./types";
import { Win32Platform } from "./win32";

export type { Platform } from "./types";

let _platform: Platform | undefined;

/**
 * Return the singleton Platform implementation for the current OS.
 * The first call triggers one-time platform init (e.g. spawn patching on Windows).
 */
export function getPlatform(): Platform {
  if (!_platform) {
    if (process.platform === "win32") {
      _platform = new Win32Platform();
    } else {
      // darwin + linux share the same unix-like implementation.
      _platform = new DarwinPlatform();
    }
    _platform.init();
  }
  return _platform;
}
