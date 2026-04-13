---
name: js-eyes
description: Browser automation for AI agents — control tabs, extract content, execute scripts and manage cookies via WebSocket.
version: 1.5.1
metadata:
  openclaw:
    emoji: "\U0001F441"
    homepage: https://github.com/imjszhang/js-eyes
    os:
      - windows
      - macos
      - linux
    requires:
      bins:
        - node
    install:
      - kind: node
        package: ws
        bins: []
---

# JS Eyes

Browser extension + WebSocket server that gives AI agents full browser automation capabilities.

## What it does

JS Eyes connects a browser extension (Chrome / Edge / Firefox) to an AI agent framework via WebSocket, enabling the agent to:

- List and manage browser tabs
- Open URLs and navigate pages
- Extract full HTML content from any tab
- Execute arbitrary JavaScript in page context
- Read cookies for any domain
- Monitor connected browser clients

## Architecture

```
Browser Extension  <── WebSocket ──>  JS-Eyes Server  <── WebSocket ──>  AI Agent (OpenClaw)
 (Chrome/Edge/FF)                     (packages/server-core)            (openclaw-plugin)
```

The browser extension runs in the user's browser and maintains a persistent WebSocket connection to the JS-Eyes server. The OpenClaw plugin connects to the same server and exposes 9 AI tools + a background service + CLI commands.

## Provided AI Tools

| Tool | Description |
|------|-------------|
| `js_eyes_get_tabs` | List all open browser tabs with ID, URL, title |
| `js_eyes_list_clients` | List connected browser extension clients |
| `js_eyes_open_url` | Open a URL in new or existing tab |
| `js_eyes_close_tab` | Close a tab by ID |
| `js_eyes_get_html` | Get full HTML content of a tab |
| `js_eyes_execute_script` | Run JavaScript in a tab and return result |
| `js_eyes_get_cookies` | Get all cookies for a tab's domain |
| `js_eyes_discover_skills` | Query the skill registry for available extension skills |
| `js_eyes_install_skill` | Download, extract, and register an extension skill |

## CLI Commands

```
openclaw js-eyes status          # Server connection status
openclaw js-eyes tabs            # List all browser tabs
openclaw js-eyes server start    # Start the built-in server
openclaw js-eyes server stop     # Stop the built-in server
```

## Skill Bundle Structure

This document describes the published skill bundle layout. The source repository keeps the server and SDK implementation under `packages/`, while `openclaw-plugin/` is now a real top-level optional component:

```
js-eyes/
├── SKILL.md                        ← Skill entry point (this file)
├── package.json                    ← Generated bundle root package (for npm install in extracted bundle)
├── LICENSE
├── openclaw-plugin/
│   ├── openclaw.plugin.json        ← Real plugin manifest
│   ├── package.json                ← Optional component descriptor
│   └── index.mjs                   ← Real OpenClaw plugin implementation
├── packages/
│   ├── client-sdk/                 ← Real BrowserAutomation SDK implementation
│   ├── protocol/                   ← Shared protocol + compatibility matrix
│   ├── server-core/                ← Real HTTP + WebSocket server implementation
├── server/
│   ├── index.js                    ← Compatibility wrapper → packages/server-core
│   └── ws-handler.js               ← Compatibility wrapper → packages/server-core/ws-handler
└── clients/
    └── js-eyes-client.js           ← Compatibility wrapper → packages/client-sdk
```

> The published bundle keeps the old top-level paths only as compatibility shims. The actual runtime source of truth is `packages/*`.

## Prerequisites

- **Node.js** >= 16
- **A supported browser**: Chrome 88+ / Edge 88+ / Firefox 58+

## Security & VirusTotal

This skill only communicates with **user-configured** endpoints (default: `localhost:18080`). It does not call any external APIs or send telemetry. Static analysis (e.g. VirusTotal Code Insight) may flag it as “suspicious” because it uses `fetch`/WebSocket and dynamic URLs — the same patterns used for local automation.

If ClawHub shows a VirusTotal warning, you can install with:

```bash
clawhub install js-eyes --force
```

For details (why it’s flagged, what the code does, how to report false positives), see [SECURITY.md](./SECURITY.md).

## Install

### Option A — One-command install (recommended)

Download the skill bundle and install dependencies automatically. The script tries multiple download sources (site CDN, GitHub) with automatic fallback.

**Linux / macOS:**

```bash
curl -fsSL https://js-eyes.com/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://js-eyes.com/install.ps1 | iex
```

> **Alternative (GitHub release asset):** If the site download is unavailable, use the versioned skill bundle attached to GitHub Releases:
> ```bash
> curl -L -o js-eyes-skill.zip https://github.com/imjszhang/js-eyes/releases/download/v1.5.1/js-eyes-skill-v1.5.1.zip
> ```

By default, the skill is installed to `./skills/js-eyes`. To change the location:

```bash
# Linux / macOS
curl -fsSL https://js-eyes.com/install.sh | JS_EYES_DIR=~/.openclaw/skills bash

# Windows PowerShell
$env:JS_EYES_DIR="$HOME\.openclaw\skills"; irm https://js-eyes.com/install.ps1 | iex
```

Set `JS_EYES_FORCE=1` to skip the overwrite confirmation (useful for CI).

### Option B — ClawHub

```bash
clawhub install js-eyes
```

> ClawHub may show a VirusTotal warning due to `fetch`/WebSocket patterns used for **local-only** automation. See [Security & VirusTotal](#security--virustotal). Use `clawhub install js-eyes --force` if prompted.

ClawHub installs into `./skills` under your current working directory (or your configured OpenClaw workspace). The bundle is self-contained — it includes the plugin, WebSocket server, and client SDK.

Run `npm install` in the skill root if `ws` was not auto-installed via the Skills UI:

```bash
cd ./skills/js-eyes
npm install
```

### Register the plugin

Add the plugin to `~/.openclaw/openclaw.json`. The path must point to the `openclaw-plugin` subdirectory inside the skill, **not** the skill root:

| Install method | `<SKILL_ROOT>` | Plugin path for `plugins.load.paths` |
|----------------|----------------|--------------------------------------|
| ClawHub (workspace) | `./skills/js-eyes` or `$WORKSPACE/skills/js-eyes` | `./skills/js-eyes/openclaw-plugin` (use absolute path if needed) |
| ClawHub (legacy sync) | `~/.openclaw/skills/js-eyes` | `~/.openclaw/skills/js-eyes/openclaw-plugin` |

Example config (replace the path with your actual install location — use `pwd` after `cd` into the skill to get the absolute path). If you already have other plugins, **append** this path to the existing `paths` array:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/skills/js-eyes/openclaw-plugin"]
    },
    "entries": {
      "js-eyes": {
        "enabled": true,
        "config": {
          "serverPort": 18080,
          "autoStartServer": true
        }
      }
    }
  }
}
```

> **Path note**: point `paths` at the `openclaw-plugin` subdirectory only.

Restart OpenClaw to load the plugin.

> **For developers**: clone the [full repository](https://github.com/imjszhang/js-eyes) and point `plugins.load.paths` to the repo-root `openclaw-plugin` directory.

## Browser Extension Setup

The plugin talks to browsers through the JS Eyes extension. Install it separately (independent of ClawHub):

1. Download from [GitHub Releases](https://github.com/imjszhang/js-eyes/releases/latest):
   - **Chrome / Edge**: `js-eyes-chrome-vX.Y.Z.zip` — open `chrome://extensions/` (or `edge://extensions/`), enable Developer mode, click "Load unpacked", select the extracted folder
   - **Firefox**: `js-eyes-firefox-vX.Y.Z.xpi` — drag and drop into the browser window

2. Click the JS Eyes extension icon in the toolbar, enter `http://localhost:18080` as the server address, click **Connect** — the status should turn green.

## Verify

Run the CLI command to confirm everything is working:

```bash
openclaw js-eyes status
```

Expected output:

```
=== JS-Eyes Server Status ===
  Uptime: ...s
  Browser extensions: 1
  Automation clients: ...
```

You can also ask the AI agent to list your browser tabs — it should invoke `js_eyes_get_tabs` and return the tab list.

## Using Skills from the CLI

The published `js-eyes` CLI can also host extension skills directly, without requiring OpenClaw to be the installer of record:

```bash
# Discover remote + locally installed skills
js-eyes skills list

# Install and enable a skill
js-eyes skills install js-x-ops-skill
js-eyes skills enable js-x-ops-skill

# Run a skill command through the js-eyes host
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

This keeps one shared skill directory for both the CLI host and OpenClaw. OpenClaw still loads the skill through its own `openclaw-plugin` path.

## Plugin Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverHost` | string | `"localhost"` | Server listen address |
| `serverPort` | number | `18080` | Server port (must match extension config) |
| `autoStartServer` | boolean | `true` | Auto-start server when plugin loads |
| `requestTimeout` | number | `60` | Per-request timeout in seconds |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Extension shows "Disconnected" | Server not running | Check `openclaw js-eyes status`; ensure `autoStartServer` is `true` |
| `js_eyes_get_tabs` returns empty | No extension connected | Click extension icon, verify address is correct, click Connect |
| `Cannot find module 'ws'` | Dependencies not installed | Run `npm install` in the skill root (where `package.json` declares `ws`) |
| Tools not appearing in OpenClaw | Plugin path wrong or not enabled | Ensure `plugins.load.paths` points to the `openclaw-plugin` subdirectory, not the skill root |
| Plugin path not found (Windows) | Path format | Use forward slashes in JSON, e.g. `C:/Users/you/skills/js-eyes/openclaw-plugin` |

## Extension Skills

js-eyes ships with built-in extension skills that add higher-level capabilities on top of the base browser automation:

| Skill | Location | Description |
|-------|----------|-------------|
| **js-x-ops-skill** | `skills/js-x-ops-skill/` | X.com (Twitter) content operations — search content, browse timelines and feed, read post details, and handle posting flows |

Extension skills depend on js-eyes for browser automation and can be registered as separate OpenClaw plugins. See each skill's `SKILL.md` for setup instructions.

The same installed skill can now be consumed in two ways:
- by `js-eyes skill run ...` as a CLI-hosted extension
- by OpenClaw through the skill's `openclaw-plugin` directory

To register the js-x-ops-skill plugin, add its `openclaw-plugin` path to your `openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/path/to/skills/js-eyes/openclaw-plugin",
        "/path/to/skills/js-eyes/skills/js-x-ops-skill/openclaw-plugin"
      ]
    },
    "entries": {
      "js-eyes": { "enabled": true },
      "js-x-ops-skill": { "enabled": true }
    }
  }
}
```

## Links

- Source: <https://github.com/imjszhang/js-eyes>
- Releases: <https://github.com/imjszhang/js-eyes/releases>
- ClawHub: <https://clawhub.ai/skills/js-eyes>
- Author: [@imjszhang](https://x.com/imjszhang)
- License: MIT
