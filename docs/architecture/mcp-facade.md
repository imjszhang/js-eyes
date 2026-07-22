# Native MCP Facade

## Status

Accepted for the first native MCP release.

## Purpose

`@js-eyes/mcp-server` exposes the existing JS Eyes browser automation runtime to
standard Model Context Protocol clients. It is an adapter over
`@js-eyes/client-sdk`; it does not replace the JS Eyes WebSocket protocol, the
server core, or the browser extensions.

```text
MCP client
  -> stdio
  -> @js-eyes/mcp-server
  -> @js-eyes/client-sdk
  -> JS Eyes server
  -> browser extension
```

The package is host-neutral and must not import `openclaw-plugin`. OpenClaw and
MCP remain peer facades over the same lower-level packages.

## Version-one boundaries

- Transport: stdio only.
- Server lifecycle: connect to an already running JS Eyes server. The facade
  never starts or stops the server implicitly.
- Connection lifecycle: lazy connection on the first browser operation and one
  shared `BrowserAutomation` instance per MCP process.
- Core browser operations are explicit MCP tools.
- Dynamic site skills are out of scope for version one. They will later use a
  small `skill_list` / `skill_describe` / `skill_call` router.
- The JS Eyes server policy remains the authoritative security decision point.
- The facade never implements click, type, or form filling by synthesizing raw
  JavaScript. Those operations require first-class protocol actions before they
  become safe-profile MCP tools.

## Tool profiles

The default `safe` profile registers:

- `browser_status`
- `browser_list_clients`
- `browser_list_tabs`
- `browser_open_url`
- `browser_close_tab`
- `browser_get_html`
- `browser_get_page_info`
- `browser_take_screenshot`

The explicit `full` profile additionally registers:

- `browser_execute_script`
- `browser_inject_css`
- `browser_get_cookies`
- `browser_get_cookies_by_domain`
- `browser_upload_file`

Sensitive tools are absent from `tools/list` in the safe profile. Runtime
policy checks still apply in the full profile.

## Configuration precedence

Highest priority wins:

1. CLI flags
2. MCP-specific environment variables
3. JS Eyes runtime config
4. built-in defaults

Supported CLI flags are `--server-url`, `--target`, `--tool-profile`,
`--connect-timeout`, `--request-timeout`, and `--log-level`. Environment
equivalents use the `JS_EYES_MCP_` prefix. `JS_EYES_SERVER_TOKEN` continues to
be consumed by the client SDK and is never printed by the facade.

## Browser targeting

For operations scoped to one browser, target resolution is:

1. an explicit tool-call `target`;
2. the process default target;
3. the sole connected extension;
4. otherwise `JS_EYES_TARGET_REQUIRED`.

An exact extension client ID wins over a browser-name match. A browser-name
match must be unique. Read-only aggregate operations such as listing all tabs
do not require a target.

## Results and errors

Normal calls return both human-readable MCP `content` and machine-readable
`structuredContent`. Screenshot data URLs are converted to native MCP image
blocks and are never written to logs.

Tool failures return `isError: true` with a stable JS Eyes error code. Policy
failures retain `rule`, `reasons`, `pendingId`, and `host` where available.
Authentication tokens, cookie values, file payloads, scripts, CSS, HTML, and
image base64 are excluded from logs and error summaries.

## Logging

stdio reserves stdout for JSON-RPC. All facade diagnostics go to stderr. The
default log level is `warn`.

## Future work

After the first release:

1. add the skill router using host-neutral skill contracts;
2. extract common browser action definitions for OpenClaw and MCP;
3. add first-class snapshot/ref, click, type, and form protocol actions;
4. consider Streamable HTTP with an explicit MCP-session/browser lease model.
