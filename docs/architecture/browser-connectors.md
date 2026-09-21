# Browser Connectors

## Status

Accepted 2026-09-21.

## Purpose

JS Eyes keeps one host-neutral browser-operation protocol. How the server
reaches a real browser is a pluggable connector. The default remains the
browser extension. Chrome CDP and Firefox WebDriver BiDi are optional
transports. Raw DevTools / BiDi commands are not an agent API.

```text
CLI / MCP / OpenClaw
  -> client-sdk
  -> server-core policy
  -> browserClients registry
  -> extension | cdp | bidi
```

## Connector kinds

- `extension` — inbound WebSocket from the JS Eyes extension. Default, scoped
  permissions, daily logged-in sessions.
- `cdp` — outbound Chrome DevTools Protocol. Modes: `attach` (Chrome 144+
  `DevToolsActivePort`, no `/json/version` probe), `endpoint` (`:9222` or
  `ws://`), and `launch` (dedicated profile / headless).
- `bidi` — outbound WebDriver BiDi, typically Firefox
  `ws://127.0.0.1:9222/session`.

`routing: 'extension'` on protocol operations still means “send to a browser
connector” for this cycle. Do not add a silent `browser` routing alias.

## Configuration

`~/.js-eyes/config/config.json` `browser` block, merged by
`mergeBrowserConfig`. Changing transports requires a server restart.
Environment overrides: `JS_EYES_CDP_ENABLED`, `JS_EYES_CDP_MODE`,
`JS_EYES_CDP_ENDPOINT`, `JS_EYES_CDP_CHANNEL`, `JS_EYES_BIDI_ENABLED`,
`JS_EYES_BIDI_ENDPOINT`.

CDP and BiDi default to `enabled: false` and `loopbackOnly: true`. A
non-loopback endpoint also requires `security.allowRemoteBind`.

## Tab IDs

Protocol `tabId` stays an integer. CDP target IDs and BiDi context IDs are
mapped to session-local aliases. Tab objects may include additive `tabKey`.

## Errors

- `BROWSER_UNAVAILABLE` / MCP `JS_EYES_BROWSER_UNAVAILABLE`
- `JS_EYES_EXTENSION_UNAVAILABLE` is a documented alias for this cycle and
  will be removed in the next coordinated version
- `CAPABILITY_UNSUPPORTED` / MCP `JS_EYES_CAPABILITY_UNSUPPORTED`

## Security

Policy, taint, and egress still run in `handleAutomationMessage` before
`dispatch`. CDP `Runtime.evaluate` for `execute_script` remains gated by
`security.allowRawEval`. Connector connect/disconnect events are audited
without tokens, cookies, or script bodies.
