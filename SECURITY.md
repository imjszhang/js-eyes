# Security and Network Behavior

## Overview

JS Eyes is a **local-first** browser automation stack. Its normal runtime loop talks only to the JS Eyes server you configure, which defaults to `localhost:18080`.

There are two deployment shapes to keep in mind:

- **ClawHub / bundle deployment:** install the JS Eyes bundle, run `npm install` in the bundle root, register `openclaw-plugin`, and allow the plugin tools in OpenClaw.
- **Source-repo / development deployment:** clone this repository, run `npm install` in the repo root, point OpenClaw at the repo-root `openclaw-plugin`, and optionally load the unpacked browser extension directly from `extensions/chrome/` or `extensions/firefox/`.

Those two modes share the same local runtime behavior, but the source repository also contains release tooling, docs, site assets, and extension source files that reference public URLs for packaging and documentation workflows.

## Complete OpenClaw Deployment Notes

A complete local OpenClaw deployment needs all of the following:

- `plugins.load.paths` points to the bundle or repo-root `openclaw-plugin` directory.
- `plugins.entries["js-eyes"].enabled` is `true`.
- `tools.alsoAllow: ["js-eyes"]` or an equivalent `tools.allow` entry is present, because `js-eyes` registers optional plugin tools.
- The browser extension is configured to connect to the chosen `serverHost` / `serverPort`.

Without the tool allowlist step, the plugin can load successfully while `js_eyes_*` tools still remain unavailable to the model.

## Runtime Network Behavior

Base runtime behavior:

- **OpenClaw plugin:** connects via WebSocket to `ws://serverHost:serverPort` and uses HTTP only for JS Eyes server endpoints such as `/api/browser/status` and `/api/browser/tabs`.
- **Client SDK and browser extension:** connect only to the JS Eyes server URL you configure.
- **Server:** listens on a single HTTP+WebSocket port and does not need outbound internet access for the core browser automation loop.

By default this is all local traffic. No browser content is sent to a third-party service unless you explicitly point JS Eyes at a remote server you control.

## Browser Native Messaging Host (Token Auto-Sync)

JS Eyes 2.3+ ships an optional Native Messaging host (`com.js_eyes.native_host`) that lets the browser extension read `~/.js-eyes/runtime/server.token` directly, avoiding manual copy-paste.

**Threat model**: this feature is designed to defend against **external web-page / cross-origin attackers** only. A compromised local device (root, malicious local process, malicious locally-loaded extension) is **explicitly out of scope** — any attacker with local code execution already has direct read access to `server.token`.

Simplifications driven by this scoped threat model:

- No in-extension secondary confirmation prompt.
- No handshake / nonce / device-fingerprint binding.
- The host simply returns the token when the browser calls it.

Trust boundaries that remain in place:

- Native messaging manifests whitelist specific extension IDs (Chrome: `allowed_origins`, Firefox: `allowed_extensions`) — unlisted extensions cannot launch the host.
- The host only reads a fixed path (`~/.js-eyes/runtime/server.token`) and accepts only two messages (`ping`, `get-config`).
- Extensions never expose the token through `externally_connectable`, so ordinary web pages cannot read it.
- The Chrome manifest pins a stable extension ID via a `key` field so the allowlist stays authoritative after rebuilds.

See [docs/native-messaging.md](./docs/native-messaging.md) for install/uninstall commands and file-system paths.

## Explicitly User-Initiated Network Access

Some features intentionally access external URLs, but only when the user or agent explicitly chooses those workflows:

- **Extension skill discovery/install:** `js_eyes_discover_skills`, `js_eyes_install_skill`, and the install scripts may fetch the configured registry URL such as `https://js-eyes.com/skills.json`.
- **Release, docs, and packaging workflows in the source repo:** development tooling may reference GitHub Releases, project websites, Cloudflare deployment targets, Mozilla AMO, or similar public endpoints.
- **Browser automation targets:** once connected, JS Eyes can automate whatever websites the user asks it to open; that traffic is the intended workload, not telemetry.

These are different from hidden analytics or call-home behavior. They happen only when the corresponding feature is invoked.

## Why VirusTotal May Flag JS Eyes

Static analysis tools, including VirusTotal Code Insight, often flag projects that:

- use `fetch()` or `WebSocket`
- build URLs dynamically, such as `http://${host}:${port}/api/...`
- expose an API or automation surface
- include installer scripts or release/download URLs in the repository

In JS Eyes, those patterns map to local browser automation, optional skill installation, or developer-facing release workflows. They are not used for silent telemetry or covert outbound control.

## ClawHub Bundle vs Full Repository

The ClawHub-distributed skill bundle is narrower than the full source repository:

- **Included in the bundle:** the runtime pieces needed for JS Eyes skill/plugin behavior.
- **Not shipped in the ClawHub bundle:** browser extension source, most docs, tests, and release/publishing tooling.

That means a scan of the full repository can surface external URLs that are irrelevant to the base ClawHub runtime package.

## If ClawHub Shows a VirusTotal Warning

- **Review the behavior in context:** the most common triggers are the local automation patterns above, not remote-control malware behavior.
- **Report a false positive:** use the [VirusTotal false positive process](https://docs.virustotal.com/docs/false-positive) for the specific vendor(s) that flagged the file.
- **Use manual review when needed:** if you maintain an internal allowlist or review process for OpenClaw/ClawHub skills, JS Eyes is a good candidate for a reviewed exception because its behavior is inspectable and mostly local-first.

## Dependencies

- **Core runtime dependency:** `ws` is required for WebSocket communication.
- **Full development repository:** includes additional packages, build tools, docs, and browser extension assets needed for local development and release workflows.

## Supply Chain Hardening (2.2.0+)

JS Eyes 2.2.0 treats skill packages as untrusted inputs that must be validated end-to-end before they reach disk or are loaded into the runtime.

- **Registry metadata carries integrity data.** Every entry in `docs/skills.json` now ships with `sha256` and `size`. The CLI (`js-eyes skills install`), the OpenClaw `js_eyes_install_skill` tool, and `install.sh` / `install.ps1` all refuse to install a skill whose downloaded bundle does not match the expected digest.
- **`@main` fallback URLs are refused.** The installers strip any registry fallback URL that resolves to a mutable `@main` / `refs/heads/main` CDN path. Bundles must be served from an immutable tag, release, or commit pinned URL.
- **Safe ZIP extraction.** `packages/protocol/zip-extract.js` replaces `execSync unzip` / PowerShell `Expand-Archive` with an in-process ZIP reader that rejects Zip Slip, symlinks, and oversized entries (`maxFileSize`, `maxTotalSize`, `maxEntries`).
- **Lockfile + `npm ci --ignore-scripts`.** `installSkillDependencies` requires `package-lock.json` and runs `npm ci --ignore-scripts --no-audit --no-fund`. The flag `security.requireLockfile=false` (or `JS_EYES_REQUIRE_LOCKFILE=0` in the install scripts) can be used to relax this during migration; doing so prints a prominent warning.
- **Plan → approve installation.** `js-eyes skills install --plan` stages the extracted bundle in a temporary directory and writes a plan JSON to `runtime/pending-skills/<skillId>.json`. The install is only applied after `js-eyes skills approve <skillId>`. `js_eyes_install_skill` inside OpenClaw likewise produces a plan and requires an out-of-band approval via the CLI.
- **Runtime integrity pinning.** Every installed skill gets a `.integrity.json` manifest that records SHA-256 for each file. `registerLocalSkills` refuses to load a skill with mismatched/missing files. `js-eyes skills verify` and `js-eyes doctor` surface tamper indicators.
- **Skills default disabled on upgrade.** `isSkillEnabled` returns `false` unless explicitly opted in via `skillsEnabled.<id>=true`. When upgrading from 2.1.x, existing skills without an explicit setting are left disabled and a warning is logged with instructions to `js-eyes skills enable <id>`.

## Local Server Authentication (2.2.0+)

The local JS Eyes server no longer treats every localhost client as trusted.

- **Bearer tokens.** On first start (or via `js-eyes server token init`) the server writes a random token to `runtime/server.token` (POSIX `chmod 0600`; on Windows, `icacls` restricts to the current user). Clients send the token via one of:
  - HTTP `Authorization: Bearer <token>`
  - WebSocket subprotocol header `Sec-WebSocket-Protocol: bearer.<token>, js-eyes`
  - URL query parameter `?token=<token>` (accepted on loopback only; logged to the audit trail)
  Tokens can be rotated with `js-eyes server token rotate`.
- **Origin whitelist and CORS.** HTTP and WebSocket upgrades require an `Origin` from `security.allowedOrigins`. The defaults cover the bundled browser extensions, `http://localhost:18080`, and `http://127.0.0.1:18080`. `Access-Control-Allow-Origin` now echoes the caller only when it is on the whitelist; `*` is no longer returned.
- **Loopback binding.** The server refuses to bind to a non-loopback host unless `security.allowRemoteHost=true`. When bound to a public address, a warning is logged and audited.
- **`allowAnonymous` compatibility switch.** For clients that cannot yet send a token (for example, older DeepSeek Cowork installs), the operator can set `security.allowAnonymous=true`. Anonymous connections are marked in the audit log and in `js-eyes doctor`. This is explicitly a migration crutch: the log line reads `[js-eyes] WARNING: allowAnonymous=true; server accepts unauthenticated WS/HTTP clients`.
- **Structured audit log.** Connection events, skill installs, config edits, and sensitive tool calls are written as JSONL to `logs/audit.log` with `chmod 0600`. `js-eyes audit tail` streams the last entries; sensitive values (cookies, script bodies, tokens) are redacted before being logged.
- **File permissions.** `config.json`, `runtime/server.token`, `logs/audit.log`, and `runtime/pending-consents/*.json` are created/rewritten with `chmod 0600` (best-effort `icacls` on Windows).

## Sensitive Tool Consent (2.2.0+)

Built-in and skill-provided tools that can exfiltrate or mutate browser state are now routed through a consent gateway before execution.

- **Sensitive tool set.** `protocol.SENSITIVE_TOOL_NAMES` currently contains `execute_script`, `execute_script_action`, `get_cookies`, `get_cookies_by_domain`, `upload_file`, `upload_file_to_tab`, `inject_css`, and `js_eyes_install_skill`. Additional tools can be added via `security.toolPolicies`.
- **Policy modes.** Each sensitive tool resolves to one of `allow`, `confirm`, or `deny`. The OpenClaw plugin's `wrapSensitiveTool` records every decision to `runtime/pending-consents/<id>.json` (JSONL-friendly) and logs a structured warning. `deny` short-circuits execution and returns a rejection payload to the calling agent. `confirm` currently emits an auto-confirmation log entry and records the decision so operators can review it; future versions will block until an operator runs `js-eyes consent approve <id>`.
- **Extension-side eval lockdown.** `handleExecuteScript` / `handleExecuteScriptRequest` (Chrome MV3 + Firefox MV2) reject raw JavaScript payloads unless the extension's `securityConfig.allowRawEval=true` or the storage key `allowRawEval=true` has been set explicitly by the operator. The error `RAW_EVAL_DISABLED` is returned over the same response channel so the calling agent can degrade gracefully.
- **Consent log review.** Operators should periodically review `runtime/pending-consents/*.json` and the JSONL entries in `logs/audit.log`. `js-eyes consent list` summarizes recent decisions; `js-eyes consent approve <id>` / `js-eyes consent deny <id>` mark pending entries for audit.
- **Server-supplied token propagation.** The browser extension popup exposes a "Server Token" field that is persisted in `chrome.storage.local`. The background service worker forwards the token both as `Sec-WebSocket-Protocol: bearer.<token>` and as `?token=<token>` on the WebSocket URL.

## Policy Engine (2.3.0+)

Starting with 2.3.0 JS Eyes ships a declarative, non-interactive policy engine that sits between any tool caller (OpenClaw plugin, CLI, skill code, external agent) and the browser. It is tuned to defuse **prompt-injection-driven misuse** without relying on synchronous `confirm` dialogs.

### Layers

- **L4a — Same-Origin Task (`TaskOriginTracker`).** Merges a scope set from four sources: user messages (URLs / bare domains), `skill.contract.runtime.platforms`, the current active tab URL, and links found on HTML that the agent has already fetched. `getCookies` / `getCookiesByDomain` / `executeScript` / `injectCss` / `uploadFileToTab` are evaluated against this scope.
- **L4b — Lightweight Taint (`TaintRegistry`).** Every cookie value returned by `getCookies*` is tagged with an 8-byte canary (`__canary: "jse-c-<hex>"`) and registered. Subsequent sink parameters (`openUrl`, `uploadFileToTab`, `executeScript`, `injectCss`) are scanned for the canary or common-encoded cookie-value variants. Hits are soft-blocked and audited as `reason: 'taint-hit'`.
- **L5 — Egress Allowlist (`EgressGate`).** `openUrl` targets must be in: the task origin scope, `security.egressAllowlist` (static config), or the session allowlist (populated by prior approvals / explicit user-message URLs). Unmatched targets write a `runtime/pending-egress/<uuid>.json` record and return `{ status: 'pending-egress' }`; the browser extension never sees the navigation.
- **L6 — Rule Engine Location.** The engine lives in `@js-eyes/client-sdk/policy` so that skills and the OpenClaw plugin share one implementation. `@js-eyes/server-core/ws-handler` re-instantiates the same engine to cover raw WebSocket callers (external agents that bypass `client-sdk`).

### Enforcement Levels

- `off` — audit only (no blocking, no pending-egress). Useful for troubleshooting false positives.
- `soft` (default) — violating calls are not executed; `openUrl` returns `pending-egress`, other sinks return `POLICY_SOFT_BLOCK`. Agents observe the decision and can re-plan.
- `strict` — same as `soft` but with escalation paths closed (cookie-canary hits never pass, taint values never traverse sinks).

Environment and config overrides: `JS_EYES_POLICY_ENFORCEMENT`, `config.security.enforcement`, `js-eyes security enforce <level>`.

### Operator Tooling

- `js-eyes security show` prints the resolved policy (enforcement level, task-origin sources, egress allowlist, taint mode).
- `js-eyes egress list|approve <id>|allow <domain>|clear` manages pending-egress plans and session/static allowlists.
- `js-eyes doctor` reports enforcement mode, pending-egress backlog, last soft-block event, top-3 blocked tool/rule pairs, and skills whose `runtime.platforms` is `['*']`.
- `logs/audit.log` carries `rule_decision`, `task_origin`, `taint_hit`, `egress_matched`, `enforcement`, `rule`, `reasons`, and `pendingId` for every policy-related event.

### HTTP Response Hardening

`packages/server-core` now emits `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: interest-cohort=()` on every HTTP response. This closes the Chrome `externally_connectable` surface against any future accidental HTML response on port 18080.

### Non-Goals (2.3.0)

- Interactive `confirm` dialogs (still excluded by design).
- Task profiles (L3) and reader sub-agent (L5') — both opt-in additions planned for 2.4 and will remain off by default.

---

*Last updated: 2026-04-17 — aligned with the 2.3.0 JS Eyes policy engine release.*
