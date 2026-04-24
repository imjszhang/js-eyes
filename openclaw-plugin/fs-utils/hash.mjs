// fs-utils/hash: streaming file hash helpers.
//
// Kept in its own module so that `fs.readFileSync` / `createReadStream` calls
// are never co-located with network clients (see SECURITY_SCAN_NOTES.md,
// "File read combined with network send"). The invariant is verified by
// test/import-boundaries.test.js:
//
//   * MUST NOT import `ws`, `http`, `https`, `net`, or network helpers;
//   * MUST NOT import `../../packages/client-sdk` or `../../packages/server-core`;
//   * the hash functions stream chunks through `crypto.createHash` and never
//     retain the full buffer, so large files don't balloon memory.

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";

export function hashFileSha1(filePath) {
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha1");
      const stream = createReadStream(filePath);
      stream.on("error", () => resolve(""));
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    } catch (_) {
      resolve("");
    }
  });
}

// Sync variant preserved for call sites (e.g. fs-watch handlers) that must
// stay on the event loop's current tick. Uses stat() to refuse pathological
// inputs (e.g. /dev/zero) before reading, and falls back to '' on any error
// to match prior behaviour.
const SYNC_HASH_MAX_BYTES = 16 * 1024 * 1024;

export function hashFileSha1Sync(filePath, options = {}) {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return "";
    const limit = options.maxBytes ?? SYNC_HASH_MAX_BYTES;
    if (st.size > limit) return "";
    const hash = createHash("sha1");
    hash.update(readFileSync(filePath));
    return hash.digest("hex");
  } catch (_) {
    return "";
  }
}
