# Scoped Firefox network capture

The SDK exposes `startCapture(tabId, options, callOptions)`,
`getCaptureStatus(tabId, sessionId, callOptions)`,
`readCaptureEvents(tabId, sessionId, callOptions)`,
`ackCaptureEvents(tabId, sessionId, throughSeq, callOptions)` and
`stopCapture(tabId, sessionId, callOptions)`.

`callOptions` requires an explicit browser `target` and a random `ownerToken`
(32–128 ASCII letters, digits, hyphens or underscores). Use 32 random bytes
encoded as hexadecimal. Treat this token as a bearer secret. Persist it only
in the consumer's private checkpoint; never include it in logs. Only the
SHA-256 owner digest reaches the extension. These sensitive operations are
not exposed by the safe MCP profile.

Only an authenticated Firefox extension explicitly advertising
`browser.network.capture` can capture. Chrome, CDP, BiDi and legacy Firefox
extensions do not acquire this feature by inference. Tab metadata now includes
its actual `incognito` flag; missing privacy metadata and private tabs are
rejected. No raw evaluation permission is enabled or required.

## Scope and events

Start options contain exact HTTPS `origins` for the top-level page,
HTTPS `urlPatterns` for observed requests (optional wildcard subdomains and
path wildcards), `captureBodies`, and optional `page.selectors`. Selectors
have a name, CSS selector and a whitelist of primitive DOM properties:
`className`, `currentSrc`, `duration`, `currentTime`, `paused`, `src`,
`textContent`. Reads are bounded to eight selectors and four matches each;
strings are truncated to 8192 characters. No caller-supplied JavaScript,
input values, HTML, request bodies, authorization headers or cookie headers
are included.

`page` events contain `url`, `values`, and `navigationId`. `response` events
contain the exact request URL, its initiating `pageUrl` and navigation ID,
request ID, status, four permitted response headers (content-type,
content-length, content-range, accept-ranges), and a base64 body with a
`truncated` flag. URLs and response bodies may contain sensitive data and
must not be logged. A consumer should redact query strings from diagnostics.
For subresources, `pageUrl` comes from the current browser tab URL. Firefox's
request `documentUrl` can remain the original document URL after history
navigation (for example a site root); it is checked for matching origin but
cannot change navigation identity. The blocking request listener resolves the
live tab before attaching its response filter. A real top-level navigation,
including a same-URL reload outside the response URL patterns, starts a new
navigation identity. In-flight responses retain their original identity, and
late page samples cannot roll it back.
Asynchronous lookups and page samples are also bound to the capture session's
active generation: stopping or resetting capture invalidates pending work even
if the same session is resumed before that work completes. Out-of-order tab
lookups cannot overwrite a newer observed navigation.

Page reads run in the isolated content world, not the page's JavaScript world.
Starting a session does not wait for a loading page. Samples have a two-second
deadline and at most one outstanding injection per session. Response EOF can
arrive before Firefox dispatches header metadata; such bodies wait for the
status and headers before delivery.

Firefox's response filter passes every received byte through before copying
bounded observation bytes. Reaching the body budget detaches the filter and
marks the body truncated. Error/redirect responses cannot claim complete
bytes. Leaving the authorized origin or closing the tab stops observation.
Existing queued events remain available through the same authorized session.

## Resource limits and lifecycle

Defaults: 1 MiB per body, 8 MiB queued data per session, 256 events, 60 second
active TTL. Maximums: 2 MiB per body, 16 MiB per session, 512 events, 300 second
TTL, eight retained sessions, 16 concurrent response filters, 16 MiB of
in-flight body copies and 64 MiB of queued events across sessions. Sessions
are removed five minutes after active TTL expiry. Limits drop observations,
not playback data; `dropped` is cumulative and cannot measure unseen ads.

Read limits are bounded to 256 events and 4 MiB. Re-reading before ACK replays
the same queued records. Read cursors never skip an oversized unread record;
`oversizedEvent` signals that condition. ACK releases only the delivered
prefix and is repeatable. A dropped tail can advance the cursor only after
queued records have been drained. Consumers must commit their data before ACK.

An inactive session can be restarted with the same owner and exact options,
retaining its cursor and queued events. Each tab allows only one active owner:
if another owner has started capture, restarting a stopped or expired session
returns `CAPTURE_LIMIT` without changing either session's queued events. The
original owner can resume after the competing session stops or expires.
Server grants are tied to the actual
extension connection, session, tab and security policy generation. An
authenticated automation client can reconnect with its persisted owner token.
It can drain an already granted session after the tab closes. Other owners
cannot use that grant. Security reload revokes grants and requests immediate
extension queue reset. Extension connection loss also clears queues. Browser,
extension or server restart does not promise recovery of unacknowledged data.
The consumer must retain its locally committed batches and report remote loss.

This generic API makes no claim about YouTube ad attribution or complete
video downloads. Those belong to the collector and require separate testing.

## Local validation on 2026-10-25

On macOS with Node 24.22.1, an actual unsigned extension was loaded using
Mozilla web-ext into an isolated headless Firefox profile. An authenticated
server on loopback port 18081 kept raw evaluation disabled. A public YouTube
robots.txt request yielded HTTP 200, 792 captured bytes, no truncation, two
page events and one response event. Read/ACK/stop completed with zero dropped
events. An ordinary SDK script request returned RAW_EVAL_DISABLED. This
verifies the browser capture interface, not advertisement attribution or
complete ad downloads. See the sibling collector's VALIDATION.md for its
media and macOS regression checks.
