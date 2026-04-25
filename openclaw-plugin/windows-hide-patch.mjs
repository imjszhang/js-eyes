// windows-hide-patch: force `windowsHide: true` on every child_process.spawn /
// execFile call initiated from the plugin process on Windows.
//
// Kept in its own module so the `require('node:child_process')` lives far
// away from the plugin's WebSocket / gateway code (see SECURITY_SCAN_NOTES.md,
// "Shell command execution"). This module MUST NOT import `ws`, `http`,
// `https`, `net`, or any network helper — the invariant is enforced by
// test/import-boundaries.test.js.
//
// On non-Windows platforms this is a no-op. On Windows we wrap `spawn` and
// `execFile` once per process to default `windowsHide: true` — preventing a
// fleeting cmd.exe console window from popping up under the user's desktop
// when a skill spawns a helper.

import { createRequire } from "node:module";

export function patchWindowsHide() {
  if (process.platform !== "win32") return;
  try {
    const require = createRequire(import.meta.url);
    const cp = require("node:child_process");

    const _spawn = cp.spawn;
    cp.spawn = function patchedSpawn(cmd, args, opts) {
      if (args && typeof args === "object" && !Array.isArray(args)) {
        if (args.windowsHide === undefined) args.windowsHide = true;
        return _spawn.call(this, cmd, args);
      }
      if (!opts || typeof opts !== "object") opts = {};
      if (opts.windowsHide === undefined) opts.windowsHide = true;
      return _spawn.call(this, cmd, args, opts);
    };

    const _execFile = cp.execFile;
    cp.execFile = function patchedExecFile(file, args, opts, cb) {
      if (typeof args === "function") return _execFile.call(this, file, args);
      if (typeof opts === "function") {
        if (Array.isArray(args)) return _execFile.call(this, file, args, opts);
        if (args && typeof args === "object") {
          if (args.windowsHide === undefined) args.windowsHide = true;
        }
        return _execFile.call(this, file, args, opts);
      }
      if (opts && typeof opts === "object") {
        if (opts.windowsHide === undefined) opts.windowsHide = true;
      }
      return _execFile.call(this, file, args, opts, cb);
    };
  } catch {
    // Best-effort: if cp.spawn is frozen / sealed on some runtime we continue
    // without the patch rather than crash the plugin boot.
  }
}
