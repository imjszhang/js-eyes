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

The default `safe` profile registers eight tools:

- `browser_status`
- `browser_list_clients`
- `browser_list_tabs`
- `browser_open_url`
- `browser_close_tab`
- `browser_get_html`
- `browser_get_page_info`
- `browser_take_screenshot`

The `full` profile additionally registers JavaScript execution, CSS injection,
cookie access, and file upload. Enable it only for an MCP host you trust:

```json
{
  "command": "npx",
  "args": ["-y", "@js-eyes/mcp-server", "--tool-profile", "full"]
}
```

Tool profiles control discovery, not only execution: sensitive tools are absent
from `tools/list` in the safe profile. JS Eyes server policy remains active in
both profiles.

## Browser selection

When only one extension is connected, browser-scoped tools select it
automatically. When several extensions are connected, pass `target` using the
client ID returned by `browser_list_clients`. A unique browser name such as
`chrome` or `firefox` is also accepted.

Set a process-wide default with:

```text
--target <clientId-or-browser-name>
```

JS Eyes refuses ambiguous browser-scoped operations instead of choosing an
arbitrary extension.

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

## Troubleshooting

`JS_EYES_SERVER_UNAVAILABLE` means the local server could not be reached. Start
it with `js-eyes server start` and verify it with `js-eyes doctor`.

`JS_EYES_EXTENSION_UNAVAILABLE` means the server is running but no matching
browser extension is connected.

`JS_EYES_TARGET_REQUIRED` means more than one extension is connected. Call
`browser_list_clients` and pass a client ID as `target`.

`JS_EYES_AUTH_FAILED` means the MCP process and browser/server configuration do
not share the same JS Eyes token.

`JS_EYES_EGRESS_PENDING` includes a `pendingId`. Review it with the normal JS
Eyes security commands before retrying the URL.

## Security notes

The MCP facade is local but browser control remains high privilege. Keep the
server loopback-only, use token authentication, leave the safe profile enabled
unless sensitive operations are required, and inspect the browser target before
performing account writes.
