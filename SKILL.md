---
name: js-eyes
description: Install, configure, verify, and troubleshoot JS Eyes browser automation for OpenClaw.
version: 2.4.0
metadata: {"openclaw":{"emoji":"\U0001F441","homepage":"https://github.com/imjszhang/js-eyes","os":["darwin","linux","win32"],"requires":{"bins":["node"]}}}
---

# JS Eyes

Use this skill to turn a ClawHub-installed `js-eyes` bundle into a working OpenClaw browser automation stack.

Treat `{baseDir}` as the installed skill root. The plugin path that must be registered in OpenClaw is `{baseDir}/openclaw-plugin`, not `{baseDir}` itself.

## Use This Skill When

- The user wants to install or configure JS Eyes from a ClawHub skill bundle.
- `js_eyes_*` tools are missing after installation.
- The browser extension is installed but still shows `Disconnected`.
- The user wants to verify the built-in server, plugin config, or extension connection.
- The user wants to discover or install JS Eyes extension skills after the base stack is working.

## What Success Looks Like

A successful setup has all of the following:

1. `npm install` has been run in `{baseDir}` with Node.js 22 or newer.
2. OpenClaw loads `{baseDir}/openclaw-plugin` via `plugins.load.paths`.
3. `plugins.entries["js-eyes"].enabled` is `true`.
4. `tools.alsoAllow` (preferred) or `tools.allow` includes `js-eyes`, so the plugin's optional tools are actually exposed to the model.
5. The user can run `openclaw js-eyes status`.
6. The browser extension is connected to `http://<serverHost>:<serverPort>`, the popup **Server Token** field is populated (2.2.0+), and `js_eyes_get_tabs` returns real tabs.
7. The user can later run `js_eyes_discover_skills` / `js_eyes_install_skill` to add extension skills dynamically, and the main plugin auto-loads installed skills from `{baseDir}/skills` or the configured `skillsDir`.
8. `js-eyes doctor` reports a clean security posture (token present, `allowAnonymous=false`, `allowRawEval=false`, host bound to loopback, skill integrity OK).

## Deployment Modes

Treat `{baseDir}` as the bundle or repository root that contains `openclaw-plugin/`, `skills/`, and the package manifests.

There are two supported complete deployment modes:

1. ClawHub / bundle deployment
   - `{baseDir}` is the installed JS Eyes bundle root.
   - Run `npm install` in `{baseDir}` so the plugin runtime can resolve its dependencies.
   - Register `{baseDir}/openclaw-plugin` in OpenClaw.

2. Source-repo / development deployment
   - `{baseDir}` is the root of a local `js-eyes` git clone.
   - Run `npm install` in the repo root, not inside `openclaw-plugin/`.
   - Point OpenClaw `plugins.load.paths` at the repo-root `openclaw-plugin` directory.
   - If you are debugging the browser side, load the extension from `extensions/chrome/` or `extensions/firefox/manifest.json` as appropriate.
   - After plugin/runtime code changes, restart or refresh OpenClaw so the updated plugin code is reloaded.

## Setup Workflow

When the user asks to install, configure, or repair JS Eyes, follow this exact order:

1. Determine the operating system first and choose commands accordingly.
2. Resolve the OpenClaw config path before editing anything.
3. Verify prerequisites:
   - `node -v` must be `>= 22`
   - if the user expects OpenClaw plugin mode, `openclaw --version` should work
4. From `{baseDir}`, run `npm install` if dependencies are missing or if the user just installed the bundle.
5. Update the resolved `openclaw.json`:
   - ensure `plugins.load.paths` contains the absolute path to `{baseDir}/openclaw-plugin`
   - ensure `plugins.entries["js-eyes"].enabled` is `true`
   - ensure `tools.alsoAllow` contains `js-eyes` (preferred additive mode), or ensure `tools.allow` includes `js-eyes`
   - if needed, create `plugins.entries["js-eyes"].config` with:
     - `serverHost: "localhost"`
     - `serverPort: 18080`
     - `autoStartServer: true`
6. Restart or refresh OpenClaw so the plugin is reloaded.
7. Verify with `openclaw js-eyes status`.
8. Initialize the local server token if this is a fresh 2.2.0+ install: `js-eyes server token init`. Then either (preferred, 2.4.0+) run `npx js-eyes native-host install --browser all` so the extension auto-syncs the token, or run `js-eyes server token show --reveal` and paste the value into the extension popup **Server Token** field under **Advanced**.
9. If the server is healthy but no browser is connected, guide the user through browser extension installation, server-token entry, and connection.
10. After the base setup works, prefer `js_eyes_discover_skills` and `js_eyes_install_skill` for extension skills — 2.2.0 writes a plan under `runtime/pending-skills/<id>.json`; finalize with `js-eyes skills approve <id>` then `js-eyes skills enable <id>`.
11. Run `js-eyes doctor` to confirm the hardened defaults (token present, `allowAnonymous=false`, loopback-bound, skill integrity OK) before handing off.

When asked to fix a broken setup, prefer repairing the existing config instead of repeating the whole installation.

## Resolve The OpenClaw Config Path

Use this precedence order:

1. `OPENCLAW_CONFIG_PATH`
2. `OPENCLAW_STATE_DIR/openclaw.json`
3. `OPENCLAW_HOME/.openclaw/openclaw.json`
4. Default:
   - macOS / Linux: `~/.openclaw/openclaw.json`
   - Windows: `%USERPROFILE%/.openclaw/openclaw.json`

Do not assume `~/.openclaw/openclaw.json` if any of the environment variables above are set.

## Recommended Config Shape

Update the resolved OpenClaw config so it contains the plugin path and enablement entry. Append to existing arrays and objects; do not remove unrelated plugins.

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

Important details:

- The path must end in `openclaw-plugin`.
- On Windows JSON paths, prefer forward slashes such as `C:/Users/name/skills/js-eyes/openclaw-plugin`.
- If `paths` or `entries` already exist, merge rather than overwrite.
- `js-eyes` registers its tools as optional plugin tools, so a complete deployment also needs `tools.alsoAllow: ["js-eyes"]` or an equivalent `tools.allow` entry.

## Verification Workflow

After setup, verify the stack in this order:

1. `openclaw plugins inspect js-eyes`
2. `openclaw js-eyes status`
3. Check whether the built-in server is reachable and reports uptime.
4. Confirm that at least one browser extension client is connected.
5. Ask the agent to use `js_eyes_get_tabs` or run `openclaw js-eyes tabs`.
6. If the user wants extension skills, call `js_eyes_discover_skills` only after the base stack works.

Expected status checks:

- `openclaw plugins inspect js-eyes` shows the plugin as loaded.
- Server responds on `http://localhost:18080` by default.
- `openclaw js-eyes status` shows uptime and browser client counts.
- `js_eyes_get_tabs` returns tabs instead of an empty browser list.

## Browser Extension Connection

If the plugin is enabled but no browser is connected:

1. Install the JS Eyes browser extension separately from GitHub Releases or the website.
2. (Preferred, 2.4.0+) Run `npx js-eyes native-host install --browser all` once so the extension auto-syncs `server.token` and the HTTP URL via Native Messaging; then open the popup and click **Sync Token From Host**.
3. Manual fallback: open the extension popup, expand **Advanced**, set the server address to `http://<serverHost>:<serverPort>`, paste the output of `js-eyes server token show --reveal` into the **Server Token (2.2.0+)** field, and click `Connect`.
4. Re-run `openclaw js-eyes status`.

The browser extension is not bundled inside the main ClawHub skill. It must be installed separately. Connections without a matching server token are rejected unless the operator has set `security.allowAnonymous=true`.

## Dynamic Extension Skills

The main `js-eyes` bundle is intentionally minimal. It does not preinstall child skills.

After the base plugin works:

- Use `js_eyes_discover_skills` to list available extension skills.
- Use `js_eyes_install_skill` to stage a **plan** — 2.2.0+ downloads the bundle, verifies its `sha256` against `skills.json`, and writes `runtime/pending-skills/<id>.json` without installing.
- Finalize the plan with `js-eyes skills approve <id>`, then enable it with `js-eyes skills enable <id>`.
- Use `js-eyes skills verify` (or `js-eyes doctor`) to confirm `.integrity.json` still matches the on-disk skill files.
- Tell the user that newly installed/approved extension skills usually require an OpenClaw restart or a new session before their tools appear because the main `js-eyes` plugin discovers them on startup.

Do not instruct the user to register child-skill plugin paths manually. Child skills no longer ship their own `openclaw-plugin` wrappers.

Prefer the built-in install flow over manual zip extraction when the user wants additional JS Eyes capabilities.

## Troubleshooting

### `Cannot find module 'ws'`

Run `npm install` in `{baseDir}`. The bundle expects dependencies to be installed from the skill root.

### `js_eyes_*` tools do not appear

Check all three items:

1. `plugins.load.paths` points to `{baseDir}/openclaw-plugin`
2. `plugins.entries["js-eyes"].enabled` is `true`
3. `tools.alsoAllow` or `tools.allow` includes `js-eyes`
4. OpenClaw has been restarted or refreshed since the config change
5. If this is an extension skill, confirm it is not disabled in the JS Eyes host config or legacy OpenClaw child-plugin entries

### Browser Extension Stays Disconnected

Check:

1. `openclaw js-eyes status`
2. `serverHost` / `serverPort` in plugin config
3. The extension popup server URL
4. Whether `autoStartServer` is `true`
5. (2.2.0+) The popup **Server Token** field matches `js-eyes server token show --reveal`. On 2.4.0+ installs, prefer re-running the popup's **Sync Token From Host** button (powered by the Native Messaging host — see `docs/native-messaging.md`). Tail `logs/audit.log` via `js-eyes audit tail` — `conn.reject` with `reason: token` or `reason: origin` points to token/Origin mismatches.

### Sensitive Tool Calls Hang Without Output (2.2.0+)

`execute_script*`, `get_cookies*`, `upload_file*`, `inject_css`, and `install_skill` default to the `confirm` policy and wait for operator approval.

1. `js-eyes consent list` to see pending requests.
2. `js-eyes consent approve <id>` or `js-eyes consent deny <id>` to resolve.
3. To disable the gate for a specific tool, set `security.toolPolicies.<tool>=allow` in `config.json` (logs an audit event).

### Skill Fails to Load With Integrity Error (2.2.0+)

The main plugin refuses to register skills whose files no longer match `.integrity.json`.

1. `js-eyes skills verify <id>` to see which files drifted.
2. Re-install: `js-eyes skills install <id>` → `js-eyes skills approve <id>` → `js-eyes skills enable <id>`.
3. If the drift was expected (manual patch), re-generate the manifest by reinstalling; do not edit `.integrity.json` by hand.

### Custom OpenClaw Config Location

Always resolve `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, and `OPENCLAW_HOME` before editing config or telling the user where to look.

## Notes For The Agent

- Prefer performing the setup steps for the user instead of only explaining them.
- Modify existing OpenClaw config carefully; preserve unrelated plugin entries.
- For plugin setup, edit JSON directly rather than asking the user to do it manually unless you are blocked by permissions.
- Once setup is complete, switch from installation guidance to normal use of `js_eyes_*` tools.
