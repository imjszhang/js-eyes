---
name: js-eyes
description: Install, connect, operate, and troubleshoot the host-neutral JS Eyes browser and Skill Runtime from CLI, MCP, or the optional OpenClaw adapter.
version: __JS_EYES_VERSION__
metadata: {"openclaw":{"emoji":"\U0001F441","homepage":"https://github.com/imjszhang/js-eyes","os":["darwin","linux","win32"],"requires":{"bins":["node"]}}}
---

# JS Eyes

JS Eyes is a local-first browser capability and site-skill runtime for AI
agents. A browser extension connects to a local JS Eyes server; CLI, MCP, and
OpenClaw are peer host surfaces over the same protocol, policy engine, and
Skill Runtime.

Treat `{baseDir}` as the root of this installed bundle. The optional OpenClaw
adapter is `{baseDir}/openclaw-plugin`.

## Use this Skill when

- The user wants to install or connect JS Eyes.
- An MCP or OpenClaw host cannot see JS Eyes tools.
- The browser extension remains disconnected.
- A local server, token, browser target, or security policy needs diagnosis.
- The user wants to discover, inspect, trust, enable, or call a JS Eyes Skill.
- An external V2 Skill needs to be linked without coupling it to OpenClaw.

## Choose the host surface

Use the smallest surface that fits the request:

1. **CLI** — use `js-eyes` directly for server management, diagnostics, Skill
   lifecycle, and one-off Skill calls.
2. **MCP** — use `@js-eyes/mcp-server` for Codex, Claude, Cursor, VS Code, and
   other local MCP clients.
3. **OpenClaw** — load `{baseDir}/openclaw-plugin` only when OpenClaw-specific
   lifecycle and routing are required.

Do not install the OpenClaw adapter merely to use CLI or MCP.

## Requirements

- Node.js 22 or newer.
- A supported Chrome, Edge, or Firefox extension.
- A local JS Eyes server, normally at `http://localhost:18080`.
- A shared server token unless anonymous compatibility mode was explicitly
  selected.

Keep the server bound to loopback unless the user has deliberately configured
and secured remote access.

## Standard standalone setup

Install the public CLI:

```bash
npm install -g js-eyes
```

Initialize a token, register the optional Native Messaging bridge, and start
the server:

```bash
js-eyes server token init
js-eyes native-host install --browser all
js-eyes server start
js-eyes doctor
```

Install or load the browser extension, then use its popup to synchronize the
server URL and token. If Native Messaging is unavailable, reveal the token only
for the local user and paste it into the popup:

```bash
js-eyes server token show --reveal
```

Never place the token in documentation, logs, chat output, command arguments
that will be shared, or a remote URL.

## MCP setup

The MCP facade connects lazily to an existing JS Eyes server:

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

The default `safe` profile exposes browser status, tab, navigation, page-read,
screenshot, and read-only Skill Runtime tools. Raw JavaScript, CSS injection,
cookie access, file upload, and non-read Skill calls are not discoverable.

Use `--tool-profile full` only for a trusted MCP host when the requested task
actually requires those capabilities. Server policy remains authoritative in
both profiles.

Start diagnosis with:

1. `browser_status`
2. `browser_list_clients`
3. `browser_list_tabs`

When several extensions are connected, pass the exact `clientId` returned by
`browser_list_clients`; do not select an ambiguous browser automatically.

## OpenClaw setup

The ClawHub/bundle deployment uses the runtime packages and optional adapter
shipped under `{baseDir}`:

1. Run `npm install` in `{baseDir}` with Node.js 22 or newer.
2. Resolve the OpenClaw config path in this order:
   - `OPENCLAW_CONFIG_PATH`
   - `OPENCLAW_STATE_DIR/openclaw.json`
   - `OPENCLAW_HOME/.openclaw/openclaw.json`
   - `~/.openclaw/openclaw.json`
3. Merge the adapter path and enablement into the existing config.
4. Add `js-eyes` to `tools.alsoAllow` or the equivalent tool allowlist.
5. Restart or refresh OpenClaw.

Use this config shape without removing unrelated entries:

```json
{
  "tools": {
    "alsoAllow": ["js-eyes"]
  },
  "plugins": {
    "load": {
      "paths": ["/absolute/path/to/js-eyes/openclaw-plugin"]
    },
    "entries": {
      "js-eyes": {
        "enabled": true,
        "config": {
          "serverHost": "localhost",
          "serverPort": 18080,
          "autoStartServer": true
        }
      }
    }
  }
}
```

JS Eyes registers one OpenClaw tool named `js-eyes`. It routes path-style
actions such as:

- `browser/get-tabs`
- `browser/list-clients`
- `browser/open-url`
- `browser/get-html`
- `skills/discover`
- `skills/plan-install`
- `skills/reload`
- `security/reload`
- `skill/<skillId>/<action>`

Do not look for or invoke the removed pre-2.8 multi-tool family.

Verify OpenClaw mode in this order:

```bash
openclaw plugins inspect js-eyes
openclaw js-eyes status
```

Then call the `js-eyes` tool with `action: browser/get-tabs` and `args: {}`.

## Safe defaults

The recommended host posture is:

- `security.allowAnonymous=false`
- `security.allowRemoteBind=false`
- `security.allowRawEval=false`
- `security.enforcement=soft` or `strict`
- a narrow `security.egressAllowlist`
- token authentication enabled

Ordinary status, tab, navigation, page-read, screenshot, and first-class
browser operations should not require arbitrary JavaScript. If a specific
legacy or site Skill requires raw execution, explain the risk and enable
`security.allowRawEval` only with explicit user intent. Restart the server
after changing that setting.

Review the effective posture with:

```bash
js-eyes security show
js-eyes doctor
js-eyes audit tail --lines 100
```

Policy or egress failures are decisions, not connectivity failures. Preserve
the returned error code and `pendingId`, let the user review the request, and
use the normal `js-eyes egress` or consent commands before retrying.

## Skill Runtime V2

JS Eyes discovers a V2 Skill from static `package.json` and
`skill.manifest.json` metadata without executing its entry module. The
manifest declares compatibility, tools, schemas, risks, and capabilities.

Common lifecycle commands are:

```bash
js-eyes skills list
js-eyes skills inspect <id>
js-eyes skills enable <id>
js-eyes skills disable <id>
js-eyes skills link /absolute/path/to/skill
js-eyes skills unlink /absolute/path/to/skill
js-eyes skills trust <id>
js-eyes skills revoke <id>
js-eyes skills reload
```

Call the host-neutral runtime directly:

```bash
js-eyes skill call <id> <tool> --args '{"key":"value"}' --json
```

MCP exposes the same runtime through `skill_list`, `skill_describe`, and
`skill_call`. OpenClaw routes the same tools through
`skill/<skillId>/<action>`.

For external Skills under `prompt` or `strict` policy:

1. Link the directory.
2. Inspect its source, manifest, dependencies, declared permissions, and
   execution mode.
3. Trust it only after review.
4. Re-review it whenever its path, source digest, dependencies, manifest,
   capabilities, or execution mode changes.

Worker mode is a crash and reachability boundary, not an operating-system
sandbox. Direct filesystem, process, and network access cannot be completely
contained by a JavaScript Worker.

## Native Messaging

Native Messaging lets an allowlisted extension read the local server URL and
token without manual copy and paste:

```bash
js-eyes native-host install --browser all
js-eyes native-host status --browser all
```

Restart the browser or reload the extension after registration. If the popup
reports `token-missing`, initialize the token before synchronizing. If the
host is unavailable, use manual token entry instead.

This mechanism protects against ordinary external web pages and unlisted
extensions. A compromised local device or malicious local process is outside
its threat model.

## Troubleshooting

### Server unavailable

Run:

```bash
js-eyes status
js-eyes doctor
```

Start the server if necessary and confirm that the configured port is not
already owned by an unrelated process.

### Extension unavailable

Confirm:

- the correct extension is enabled;
- the server URL uses the configured local host and port;
- the extension and server share the same token;
- the browser was restarted after Native Messaging installation;
- at least one extension client appears in status output.

### Authentication failed

Rotate or reinitialize the token only when the user understands that all
connected clients must resynchronize:

```bash
js-eyes server token rotate
```

Never reveal the replacement token in shared output.

### Browser target required

List clients and use the exact target ID. Do not guess when multiple browsers
or profiles are connected.

### Skill not found or disabled

Check `js-eyes skills list`, source directories, enablement, compatibility, and
trust state. Use `inspect` before `trust`; do not bypass strict policy by
silently switching it to legacy.

### Skill input rejected

Read the schema returned by `skill_describe` or `skills inspect`. Correct the
arguments instead of modifying the Skill to skip validation.

### Raw execution refused

`RAW_EVAL_DISABLED` is the safe default. Prefer a first-class operation or
read-only Skill tool. Enable raw execution only when the task requires it and
the user accepts the additional authority.

## Agent operating rules

- Diagnose before changing configuration.
- Repair existing configuration by merging; never overwrite unrelated hosts,
  plugins, tools, or security settings.
- Prefer CLI or MCP unless the task specifically requires OpenClaw.
- Prefer read-only Skill tools and the MCP safe profile.
- Ask for explicit intent before enabling a full profile, raw execution,
  cookie access, file upload, destructive tools, or administrative tools.
- Report the active host surface, connected browser target, and any policy
  decision when handing the setup back to the user.
