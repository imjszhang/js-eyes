# Native MCP Server

`@js-eyes/mcp-server` lets local MCP hosts use an existing JS Eyes server and
browser extension. It uses stdio and does not require OpenClaw.

## Prerequisites

1. Install the JS Eyes browser extension.
2. Install the Native Messaging host or configure the extension token manually.
3. Start the local server with `js-eyes server start`.

The MCP process connects lazily, so MCP initialization still succeeds while the
server or extension is offline. Call `browser_status` for a structured
diagnostic.

## Client configuration

The standard local MCP configuration is:

```json
{
  "mcpServers": {
    "js-eyes": {
      "command": "npx",
      "args": ["-y", "@js-eyes/mcp-server"]
    }
  }
}
```

For a source checkout, use:

```json
{
  "mcpServers": {
    "js-eyes": {
      "command": "node",
      "args": ["/absolute/path/to/js-eyes/packages/mcp-server/bin/js-eyes-mcp.js"]
    }
  }
}
```

The same command works with Codex, Claude Desktop/Code, Cursor, VS Code, and
other clients that support local stdio MCP servers.

## Safe and full profiles

The default `safe` profile registers 22 tools: browser status and navigation,
first-class page interaction (including `browser_page_state` refs), extract,
wait-for-user, plus the three generic Skill Runtime tools.

- `browser_status`
- `browser_list_clients`
- `browser_list_tabs`
- `browser_open_url`
- `browser_close_tab`
- `browser_get_html`
- `browser_get_page_info`
- `browser_take_screenshot`
- `browser_extract_page`
- `browser_page_state`
- `browser_click`
- `browser_fill`
- `browser_scroll`
- `browser_wait_for`
- `browser_send_keys`
- `browser_history`
- `browser_select`
- `browser_handle_dialog`
- `browser_wait_for_user`
- `skill_list`
- `skill_describe`
- `skill_call`

Prefer `browser_page_state` then `browser_click` / `browser_fill` by `ref`.
`browser_fill` may take `secretRef` (a local secret name) instead of `value`;
the plaintext is resolved on the JS Eyes server and is not returned. For login
or 2FA, call `browser_wait_for_user` and resume from the extension popup or
`js-eyes browser resume <id>`.

The `full` profile adds JavaScript execution, CSS injection, cookie read,
domain-scoped cookie sync, file upload, and download metadata
(`browser_list_downloads` / `browser_wait_download`) — 30 tools total.
`browser_sync_cookies` requires `source` and `destination` and returns
`copied N` without cookie values. Download tools return basename/state/bytes
only (no file body or full path). `cookies.write` / `browser_set_cookies` is
not exposed over MCP. Enable full only for an MCP host you trust:

```json
{
  "command": "npx",
  "args": ["-y", "@js-eyes/mcp-server", "--tool-profile", "full"]
}
```

Tool profiles control discovery, not only execution: sensitive tools are absent
from `tools/list` in the safe profile. JS Eyes server policy remains active in
both profiles.

`skill_list`, `skill_describe`, and `skill_call` use the same manifest,
compatibility, trust, capability, and Worker rules as the CLI and OpenClaw.
In the default `safe` profile, `skill_call` can invoke only tools whose manifest
risk is `read`; attempts to call `interactive`, `administrative`, or
`destructive` Skill tools return `SKILL_RISK_DENIED`. The `full` profile permits
all four risk classes and should be enabled only for a trusted MCP host.

## Browser selection

When only one browser client is connected, browser-scoped tools select it
automatically. When several clients are connected (for example an extension and
a CDP session), pass `target` using the client ID returned by
`browser_list_clients`. A unique browser name such as `chrome` or `firefox` is
also accepted.

Set a process-wide default with:

```text
--target <clientId-or-browser-name>
```

JS Eyes refuses ambiguous browser-scoped operations instead of choosing an
arbitrary client.

## Options

```text
--server-url <url>       Existing JS Eyes WebSocket server
--target <id|name>       Default extension clientId or browser name
--tool-profile <profile> safe or full
--connect-timeout <sec>  Connection/status timeout
--request-timeout <sec>  Browser operation timeout
--log-level <level>      debug, info, warn, error, or silent
```

Environment equivalents are:

```text
JS_EYES_MCP_SERVER_URL
JS_EYES_MCP_TARGET
JS_EYES_MCP_TOOL_PROFILE
JS_EYES_MCP_CONNECT_TIMEOUT
JS_EYES_MCP_REQUEST_TIMEOUT
JS_EYES_MCP_LOG_LEVEL
```

`JS_EYES_SERVER_TOKEN` is read by `@js-eyes/client-sdk`. Do not place a token in
MCP arguments because host process listings and configuration files may expose
it.

## Result behavior

- Normal tools return text `content` plus machine-readable `structuredContent`.
- Screenshots return native MCP image blocks rather than data URL text.
- HTML is truncated to 100,000 characters by default. Use `maxChars` to select
  a limit between 1,000 and 1,000,000 characters.
- Policy and egress failures return stable error codes and retain approval IDs
  without logging sensitive payloads.
- Skill inputs are validated against each tool's manifest JSON Schema; invalid
  calls return `SKILL_INPUT_INVALID` without entering the Skill handler.

## Troubleshooting

`JS_EYES_SERVER_UNAVAILABLE` means the local server could not be reached. Start
it with `js-eyes server start` and verify it with `js-eyes doctor`.

`JS_EYES_BROWSER_UNAVAILABLE` means the server is running but no matching
browser client is connected. `JS_EYES_EXTENSION_UNAVAILABLE` is a documented
alias for this cycle and will be removed in the next coordinated version.

`JS_EYES_TARGET_REQUIRED` means more than one browser client is connected. Call
`browser_list_clients` and pass a client ID as `target`.

`JS_EYES_CAPABILITY_UNSUPPORTED` means the selected connector cannot perform
that operation. The facade does not silently fall back to another transport.

`JS_EYES_AUTH_FAILED` means the MCP process and browser/server configuration do
not share the same JS Eyes token.

`JS_EYES_EGRESS_PENDING` includes a `pendingId`. Review it with the normal JS
Eyes security commands before retrying the URL.

Cookie sync copies session cookies in server memory only. After
`browser_sync_cookies`, reload the destination page if it is already open; the
same navigation race as `browser_open_url` can leave a stale document until
reload. `security.sensitiveCookieDomains` (for example `google.com`) is
enforced and will soft-block or deny the call.

## Security notes

The MCP facade is local but browser control remains high privilege. Keep the
server loopback-only, use token authentication, leave the safe profile enabled
unless sensitive operations are required, and inspect the browser target before
performing account writes.
