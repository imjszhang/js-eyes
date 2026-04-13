---
name: js-eyes
description: Install, configure, verify, and troubleshoot JS Eyes browser automation for OpenClaw.
version: 1.5.1
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
4. The user can run `openclaw js-eyes status`.
5. The browser extension is connected to `http://<serverHost>:<serverPort>` and `js_eyes_get_tabs` returns real tabs.
6. The user can later run `js_eyes_discover_skills` / `js_eyes_install_skill` to add extension skills dynamically.

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
   - if needed, create `plugins.entries["js-eyes"].config` with:
     - `serverHost: "localhost"`
     - `serverPort: 18080`
     - `autoStartServer: true`
6. Restart or refresh OpenClaw so the plugin is reloaded.
7. Verify with `openclaw js-eyes status`.
8. If the server is healthy but no browser is connected, guide the user through browser extension installation and connection.
9. After the base setup works, prefer `js_eyes_discover_skills` and `js_eyes_install_skill` for extension skills.

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

## Verification Workflow

After setup, verify the stack in this order:

1. `openclaw js-eyes status`
2. Check whether the built-in server is reachable and reports uptime.
3. Confirm that at least one browser extension client is connected.
4. Ask the agent to use `js_eyes_get_tabs` or run `openclaw js-eyes tabs`.
5. If the user wants extension skills, call `js_eyes_discover_skills` only after the base stack works.

Expected status checks:

- Server responds on `http://localhost:18080` by default.
- `openclaw js-eyes status` shows uptime and browser client counts.
- `js_eyes_get_tabs` returns tabs instead of an empty browser list.

## Browser Extension Connection

If the plugin is enabled but no browser is connected:

1. Install the JS Eyes browser extension separately from GitHub Releases or the website.
2. Open the extension popup.
3. Set the server address to `http://<serverHost>:<serverPort>`.
4. Click `Connect`.
5. Re-run `openclaw js-eyes status`.

The browser extension is not bundled inside the main ClawHub skill. It must be installed separately.

## Dynamic Extension Skills

The main `js-eyes` bundle is intentionally minimal. It does not preinstall child skills.

After the base plugin works:

- Use `js_eyes_discover_skills` to list available extension skills.
- Use `js_eyes_install_skill` to download, install dependencies, and register child skill plugins.
- Tell the user that newly installed extension skill plugins usually require an OpenClaw restart or a new session before their tools appear.

Prefer the built-in install flow over manual zip extraction when the user wants additional JS Eyes capabilities.

## Troubleshooting

### `Cannot find module 'ws'`

Run `npm install` in `{baseDir}`. The bundle expects dependencies to be installed from the skill root.

### `js_eyes_*` tools do not appear

Check all three items:

1. `plugins.load.paths` points to `{baseDir}/openclaw-plugin`
2. `plugins.entries["js-eyes"].enabled` is `true`
3. OpenClaw has been restarted or refreshed since the config change

### Browser Extension Stays Disconnected

Check:

1. `openclaw js-eyes status`
2. `serverHost` / `serverPort` in plugin config
3. The extension popup server URL
4. Whether `autoStartServer` is `true`

### Custom OpenClaw Config Location

Always resolve `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, and `OPENCLAW_HOME` before editing config or telling the user where to look.

## Notes For The Agent

- Prefer performing the setup steps for the user instead of only explaining them.
- Modify existing OpenClaw config carefully; preserve unrelated plugin entries.
- For plugin setup, edit JSON directly rather than asking the user to do it manually unless you are blocked by permissions.
- Once setup is complete, switch from installation guidance to normal use of `js_eyes_*` tools.
