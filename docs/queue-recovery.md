# Request queue diagnostics and recovery

Completed browser operations release their queue and deduplication records when a terminal success/error reply is sent, including when the transport is disconnected. Progress/chunk replies retain their records. The long operation timeout remains available for legitimate waits; it is not the normal cleanup mechanism.

Use an authenticated CLI connection and explicitly select the intended browser when several are connected:

```sh
js-eyes browser queue status --target firefox
js-eyes browser queue clear --target firefox
```

Status returns request IDs, operation types, ages, capacity and the timeout, never payloads, URLs or credentials. `clear` removes only expired records by default and resolves their waiting callers with `QUEUE_CLEARED`.

After stopping automation, an operator can recover stale bookkeeping even when the queue is full:

```sh
js-eyes browser queue clear --all --target firefox
```

Clearing records **does not cancel underlying browser actions**. A previously dispatched navigation, upload or download can still finish; do not automatically retry side effects. This operation also affects other callers using the selected browser. Recovery requests bypass queue capacity, but retain the existing authentication and rate-limit checks. They do not enable arbitrary JavaScript, expose cookies, or change security settings.

SDK equivalents are `getQueueStatus({ target })` and `clearQueue({ all: false }, { target })`. These are extension-only operations, absent from the safe MCP profile. Both the local server and browser extension must contain the fix. Older extensions return `CAPABILITY_UNSUPPORTED` instead of silently waiting for an unknown operation. A running old extension must be reloaded/updated once; restarting only the server does not replace extension code or erase its in-memory queue.

## Updating a source checkout

Rebuild/restart the server from the updated checkout. Prepare the extension
with `npm run sync:extension-shared`, then load or reload
`dist/extensions-stage/firefox/manifest.json` in Firefox's temporary add-on
manager, or `dist/extensions-stage/chrome` as an unpacked Chrome extension.
Firefox temporary add-ons must be loaded again after a browser restart.
Source changes are not an npm or signed-extension release.

Verify with `queue status` before and after several completed operations: the
queue should return to zero once other active operations finish. An older
extension reports `CAPABILITY_UNSUPPORTED`; unauthenticated recovery callers
are rejected with `AUTH_REQUIRED`, even when anonymous connections are enabled.
