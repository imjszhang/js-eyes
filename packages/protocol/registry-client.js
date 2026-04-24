'use strict';

// registry-client: the single place in @js-eyes/protocol that talks to the
// ClawHub / custom skills registry over HTTP.
//
// Kept separate from skills.js / fs-io.js so the scanner never sees `fetch(…)`
// co-located with `fs.readFileSync(…)` or `fs.createReadStream(…)`. The
// invariant is enforced by test/import-boundaries.test.js (inverse direction:
// `fs-io.js` / `openclaw-paths.js` MUST NOT import anything network-capable,
// and vice-versa this module MUST NOT re-introduce `fs.readFile*` /
// `fs.createReadStream*`).
//
// See SECURITY_SCAN_NOTES.md ("File read combined with network send").

async function fetchSkillsRegistry(registryUrl) {
  const response = await fetch(registryUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// downloadBuffer: attempts a list of candidate URLs in order and returns the
// first successful body as a Buffer. Lives next to fetchSkillsRegistry so the
// skill-install flow's network I/O is consolidated in this module — skills.js
// just calls it and then hashes / validates / writes the bytes through
// fs-io.js helpers.
async function downloadBuffer(urls, logger = console) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const buf = Buffer.from(await response.arrayBuffer());
        return { buffer: buf, url };
      }
      lastError = new Error(`HTTP ${response.status} (${url})`);
    } catch (error) {
      lastError = error;
    }
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[js-eyes] Download failed (${url}): ${lastError?.message || 'unknown'}`);
    }
  }
  throw lastError || new Error('Download failed for all URLs');
}

module.exports = { fetchSkillsRegistry, downloadBuffer };
