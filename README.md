# JS Eyes

<div align="center">

**Browser Automation for AI Agent Frameworks**

Give your AI agents real eyes into the browser — WebSocket-powered automation with native OpenClaw support

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-imjszhang%2Fjs--eyes-181717?logo=github)](https://github.com/imjszhang/js-eyes)
[![Website](https://img.shields.io/badge/Website-js--eyes.com-FCD228?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjE2IiBmaWxsPSIjRkNEMjI4Ii8+PHRleHQgeD0iNjQiIHk9IjY0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI3MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzM3MzQyRiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkpTPC90ZXh0Pjwvc3ZnPg==)](https://js-eyes.com)
[![X (Twitter)](https://img.shields.io/badge/X-@imjszhang-000000?logo=x)](https://x.com/imjszhang)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Firefox](https://img.shields.io/badge/Firefox-Manifest%20V2-FF7139?logo=firefox)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

[English](#quick-install) | [中文文档](./docs/README_CN.md)

</div>

---

## Quick Install

**Linux / macOS:**

```bash
curl -fsSL https://js-eyes.com/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://js-eyes.com/install.ps1 | iex
```

This downloads the skill bundle, installs dependencies, and prints the OpenClaw registration path. The standard ClawHub/OpenClaw path expects Node.js 22+ for plugin mode. See [Manual Installation](#manual-installation) for other options.

### Optional: Auto-sync token to browser extensions

After installing the CLI (`npm i -g js-eyes` or as part of the skill install flow), register a Native Messaging host so the extension can read `server.token` locally without manual copy-paste:

```bash
npx js-eyes native-host install --browser all
```

See [docs/native-messaging.md](./docs/native-messaging.md) for details and the [threat model](#security) — the NM path defends against external web-page attacks only; a compromised local device is out of scope.

---

## Introduction

JS Eyes is a browser extension + WebSocket server that gives AI agents full browser automation capabilities. It connects to AI agent frameworks (OpenClaw, DeepSeek Cowork, or custom) and provides tools for tab management, content extraction, script execution, cookie access, and more.

```
Browser Extension  <── WebSocket ──>  JS-Eyes Server  <── WebSocket ──>  AI Agent (OpenClaw)
 (Chrome/Edge/FF)                     (packages/server-core)            (openclaw-plugin)
```

### Monorepo Layout

JS Eyes now uses a publish-oriented monorepo layout:

| Path | Purpose |
|------|---------|
| `apps/cli` | Public `js-eyes` npm CLI |
| `apps/native-host` | Browser Native Messaging host for auto-injecting `server.token` |
| `packages/protocol` | Shared protocol constants and compatibility matrix |
| `packages/runtime-paths` | Runtime directories and filesystem layout |
| `packages/config` | CLI config loading and persistence |
| `packages/client-sdk` | Browser automation SDK for Node.js / skills |
| `packages/server-core` | HTTP + WebSocket server core |
| `openclaw-plugin` | Optional OpenClaw plugin component |
| `packages/devtools` | Internal build/release tooling |
| `extensions/*` | Browser extension source assets for Chrome/Edge and Firefox |
| `skills/*` | Independent extension skills built on `@js-eyes/client-sdk` |

The source repository no longer keeps root-level compatibility trees like `server/`, `clients/`, or `cli/`. The `openclaw-plugin/` directory is now a first-class optional component at the repo root.

### Supported Agent Frameworks

| Framework | Description |
|-----------|-------------|
| [apps/cli](./apps/cli) + [packages/server-core](./packages/server-core) | Lightweight built-in server and published npm CLI |
| [OpenClaw](https://openclaw.ai/) + [openclaw-plugin](./openclaw-plugin) | Registers as OpenClaw plugin — 9 AI tools, background service, CLI commands |
| [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork) | Full-featured agent framework (separate WS port, HMAC auth, SSE, rate limiting) |

## Features

- **Real-time WebSocket Communication** — Persistent connection with server
- **Auto Server Discovery** — Automatic capability detection and endpoint configuration
- **Tab Management** — Auto-sync tab information to server
- **Remote Control** — Remote open/close tabs, execute scripts
- **Content Retrieval** — Get page HTML, text, links
- **Cookie Management** — Auto-retrieve and sync page cookies
- **Code Injection** — JavaScript execution and CSS injection
- **Health Check & Circuit Breaker** — Service health monitoring with automatic circuit breaker protection
- **Rate Limiting & Deduplication** — Request rate limiting and deduplication for stability
- **Native Messaging Token Sync (2.4.0+)** — Browser extensions auto-fetch `server.token` and HTTP URL from the local CLI via Native Messaging; no manual copy-paste in the default flow
- **Bearer Token Authentication** — WebSocket upgrades authenticated via `Sec-WebSocket-Protocol: bearer.<token>` and `?token=<token>` (loopback only). Anonymous mode gated by `security.allowAnonymous`
- **Extension Skills** — Discover and install higher-level skills (e.g. X.com search) on top of base automation

## Supported Browsers

| Browser | Version | Manifest |
|---------|---------|----------|
| Chrome | 88+ | V3 |
| Edge | 88+ | V3 |
| Firefox | 58+ | V2 |

## Download

Download the latest release from [GitHub Releases](https://github.com/imjszhang/js-eyes/releases/latest):

- **Chrome/Edge Extension**: release asset `js-eyes-chrome-v<version>.zip`
- **Firefox Extension**: release asset `js-eyes-firefox-v<version>.xpi`

Or download directly from [js-eyes.com](https://js-eyes.com). The Chrome and Firefox buttons on the website open the latest GitHub release so they always point at the current published assets.

## Manual Installation

### Browser Extension

#### Chrome / Edge

1. Open browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `extensions/chrome` folder

#### Firefox

**Signed XPI** (recommended): drag and drop the `.xpi` file into Firefox.

**Temporary** (development): open `about:debugging` > This Firefox > Load Temporary Add-on > select `extensions/firefox/manifest.json`.

### OpenClaw Skill Bundle

If you prefer manual setup instead of the [one-command install](#quick-install):

1. Download `js-eyes-skill.zip` from [js-eyes.com](https://js-eyes.com/js-eyes-skill.zip), or the versioned `js-eyes-skill-v<version>.zip` asset (e.g. `js-eyes-skill-v2.5.1.zip`) from [GitHub Releases](https://github.com/imjszhang/js-eyes/releases/latest)
2. Extract to a directory (for example `./skills/js-eyes`)
3. Run `npm install` inside the extracted folder with Node.js 22 or newer
4. Register the plugin in the resolved OpenClaw config file (see [OpenClaw Plugin](#openclaw-plugin))

### npm link Development Mode

If you want to use the public `js-eyes` command shape while debugging the current source tree, you can link the published CLI workspace into your global npm bin directory:

```bash
cd /path/to/your/js-eyes-repo
npm install

cd apps/cli
npm link
```

After that, `js-eyes` resolves to the local `apps/cli` workspace, so changes in `apps/cli` and the runtime workspace packages under `packages/*` are picked up immediately.

On Windows, replace `which js-eyes` with `where js-eyes`.

```bash
which js-eyes
js-eyes --help
js-eyes doctor
```

If you also want the linked CLI to run skills directly from this repository instead of the default runtime directory, point `skillsDir` at the repo's `skills/` folder:

```bash
js-eyes config set skillsDir "/absolute/path/to/js-eyes/skills"
js-eyes skills enable js-x-ops-skill
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

To return to a normal global install later:

```bash
cd /path/to/your/js-eyes-repo/apps/cli
npm unlink
npm uninstall -g js-eyes
```

## Usage

### 1. Start a Compatible Server

**Option A** — Built-in lightweight server:
```bash
npm run server
# Starts on http://localhost:18080 (HTTP + WebSocket)
```

Or, after publishing the CLI:

```bash
js-eyes server start
js-eyes doctor
```

**Option B** — Use as an [OpenClaw](https://openclaw.ai/) plugin (see [OpenClaw Plugin](#openclaw-plugin) section below).

**Option C** — Use a supported agent framework such as [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork).

### 2. Configure Connection

**Default flow (2.4.0+, recommended)** — install the Native Messaging host once and the extension auto-syncs both the server URL and `server.token`:

```bash
npx js-eyes native-host install --browser all
```

Open the popup and click **Sync Token From Host** (or simply wait for the auto-sync on startup) — the connection status should flip to "Connected" without any manual input.

**Manual fallback** — if Native Messaging is unavailable, expand **Advanced** in the popup and:

1. Enter the server HTTP address (e.g. `http://localhost:18080`) and click **Connect**
2. Paste `server.token` contents into **Server Token (2.2.0+)** (run `js-eyes server token show --reveal` to retrieve it) and click **Save**

**Auto-Connect:** the extension reconnects automatically on startup and after disconnections (exponential backoff); toggle it off under **Advanced** if you need manual control.

> 2.2.0 is security-hardened by default. Connections without a matching server token are rejected unless you set `security.allowAnonymous=true` in `config.json`. See [SECURITY.md](./SECURITY.md) and the [2.2.0 migration guide](./RELEASE.md#220-migration-guide-security-hardening).
>
> 2.3.0 adds a non-interactive policy engine (`task origin` + `taint` + `egress allowlist`) in front of every sink. Default `enforcement=soft` keeps existing workflows working; see the [2.3.0 migration guide](./RELEASE.md#230-migration-guide-policy-engine).

### 3. Verify Connection

```bash
openclaw js-eyes status
```

Expected output shows server uptime, connected extensions, and tab count.

### 4. Manage Skills from the CLI

`js-eyes` now acts as the host for extension skills as well:

```bash
# List remote + installed skills
js-eyes skills list

# Install and enable a skill
js-eyes skills install js-x-ops-skill
js-eyes skills enable js-x-ops-skill

# Run a skill command through the js-eyes host
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

Skill install state is tracked by the JS Eyes runtime config. OpenClaw only needs to load the main `js-eyes` plugin; the main plugin auto-discovers enabled local skills from the same runtime `skills/` directory when it starts.

> Starting with 2.2.0, `install_skill` only writes a **plan** under `runtime/pending-skills/<id>.json`. Operators finalize with `js-eyes skills approve <id>` and enable with `js-eyes skills enable <id>`. See [SECURITY.md](./SECURITY.md#supply-chain-hardening-220).

### 5. Security Quickstart (2.2.0+ / 2.3.0+)

```bash
# Generate / inspect / rotate the local server token
js-eyes server token init
js-eyes server token show --reveal
js-eyes server token rotate

# Tail the audit log (JSONL)
js-eyes audit tail

# Review and approve sensitive tool calls awaiting consent
js-eyes consent list
js-eyes consent approve <consent-id>

# 2.3.0+: Policy engine enforcement and pending-egress
js-eyes security show
js-eyes security enforce <off|soft|strict>    # soft is the 2.3.0 default
js-eyes egress list
js-eyes egress approve <id>                   # allow this destination for the session
js-eyes egress allow <domain>                 # permanent allowlist entry

# Two-step skill install with integrity pinning
js-eyes skills install js-x-ops-skill   # writes a plan; prompts to approve
js-eyes skills approve js-x-ops-skill
js-eyes skills enable js-x-ops-skill
js-eyes skills verify                   # re-check .integrity.json across installed skills

# One-shot posture check (includes 2.3 policy engine report)
js-eyes doctor
```

Secure defaults in 2.2.0:

- WebSocket/HTTP require a bearer token and an allow-listed `Origin`; non-loopback host binds require `security.allowRemoteHost=true`.
- `execute_script`, `get_cookies*`, `upload_file*`, `inject_css`, and `install_skill` default to the `confirm` policy and require a consent approval.
- Raw `eval`-style scripts are refused unless `security.allowRawEval=true`. The host pushes this value to the extension at `init_ack` handshake, so a single toggle in `~/.js-eyes/config/config.json` is enough; the `chrome.storage.local.allowRawEval` key is retained only as an explicit opt-out override for hardened deployments. Prefer `execute_action` for declarative actions when possible.
- `config.json`, `server.token`, `audit.log`, and pending-consents files are written at `0600` on POSIX and locked via `icacls` on Windows.

New in 2.3.0:

- A non-interactive policy engine (`task origin`, `taint`, `egress allowlist`) is wired through `BrowserAutomation` and server-side dispatch. Default `enforcement=soft` means no hard rejects — violating `openUrl` calls become `pending-egress` records, other sinks return `POLICY_SOFT_BLOCK` for the agent to re-plan.
- Every returned cookie is tagged with a canary (`__canary: "jse-c-..."`); sinks that serialize a canary or a raw cookie value are soft-blocked.
- HTTP responses from `server-core` now carry `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

Compatibility escape hatches (use sparingly):

- `security.allowAnonymous=true` accepts unauthenticated clients during a migration — every anonymous session is audited and `js-eyes doctor` will flag it.
- `security.toolPolicies.<tool>=allow` restores pre-2.2.0 behavior for a specific tool.
- `js-eyes security enforce off` (or `JS_EYES_POLICY_ENFORCEMENT=off`) turns the 2.3 policy engine into audit-only mode.

### CLI Runtime Directory

By default, the published `js-eyes` CLI now stores config, logs, downloads, cache, and installed skills under `~/.js-eyes` on macOS, Linux, and Windows.

- macOS: `~/.js-eyes`
- Linux: `~/.js-eyes`
- Windows: `%USERPROFILE%/.js-eyes`

If an older installation exists in a legacy OS-specific runtime directory, `js-eyes` migrates it automatically on first run:

- macOS: `~/Library/Application Support/js-eyes`
- Linux: `$XDG_CONFIG_HOME/js-eyes` or `~/.config/js-eyes`
- Windows: `%APPDATA%/js-eyes`

If `JS_EYES_HOME` is set, that override still takes precedence and automatic migration is skipped.

## OpenClaw Plugin

JS Eyes registers as an [OpenClaw](https://openclaw.ai/) plugin, providing browser automation tools directly to AI agents.

For native plugin loading, follow the OpenClaw runtime requirements for external plugins (ESM + Node 22+).

### What It Provides

- **Background Service** — Automatically starts/stops the built-in WebSocket server
- **9 AI Tools** — Browser automation + skill discovery/installation (see table below)
- **CLI Commands** — `openclaw js-eyes status`, `openclaw js-eyes tabs`, `openclaw js-eyes server start/stop`

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
| `js_eyes_install_skill` | Download, extract, and enable an extension skill so the main plugin can auto-load it |

### Setup

Use this order for the standard ClawHub/OpenClaw install path:

1. Install the browser extension in Chrome/Edge/Firefox (same as above)
2. Run `npm install` in the skill root with Node.js 22+
3. Resolve the OpenClaw config path using this precedence:
   - `OPENCLAW_CONFIG_PATH`
   - `OPENCLAW_STATE_DIR/openclaw.json`
   - `OPENCLAW_HOME/.openclaw/openclaw.json`
   - default `~/.openclaw/openclaw.json`
4. Add the plugin to the resolved OpenClaw config:

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

5. Restart or refresh OpenClaw — the server launches automatically and AI agents can control the browser via registered tools.

For local source-repo development, point `plugins.load.paths` directly to the repo-root `openclaw-plugin` directory inside your clone.

### Plugin Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverHost` | string | `"localhost"` | Server listen address |
| `serverPort` | number | `18080` | Server port |
| `autoStartServer` | boolean | `true` | Auto-start server when plugin loads |
| `requestTimeout` | number | `1800` | Request timeout in seconds (default 30 minutes; server reads this value on startup) |
| `skillsRegistryUrl` | string | `"https://js-eyes.com/skills.json"` | URL of the extension skill registry |
| `skillsDir` | string | `""` | Primary skill install directory — empty = auto-detect `skills/` under skill root. All `install` / `approve` / `uninstall` / integrity checks target this directory only. |
| `extraSkillDirs` | string[] | `[]` | Additional read-only skill sources. Each entry can be a single skill directory (contains `skill.contract.js`) or a parent directory (scanned 1 level deep). Primary wins on id conflicts; extras skip integrity checks. See [deployment mode D](./docs/dev/js-eyes-skills/deployment.zh.md#5-部署模式-dprimary--extraskilldirs). |

## Compatibility Matrix

`js-eyes doctor` now prints the local package versions, server protocol version, and compatibility status. The current expected matrix is:

| Surface | Expected version |
|---------|------------------|
| Protocol | `1.0` |
| CLI | `2.5.1` |
| Browser extension assets | `2.5.1` |
| `@js-eyes/server-core` | `2.5.1` |
| `@js-eyes/client-sdk` | `2.5.1` |
| `openclaw-plugin` | `2.5.1` |
| Skills using `@js-eyes/client-sdk` | `2.5.1` |

## Extension Skills

JS Eyes supports **extension skills** — higher-level capabilities built on top of the base browser automation. The main ClawHub bundle is intentionally minimal and does **not** preinstall child skills. Each extension skill adds new AI tools and can be installed independently after the base stack is working.

The recommended hosting model is now:
- extend the `js-eyes` CLI with skill-specific commands
- let the main `js-eyes` OpenClaw plugin discover and register enabled local skills during startup

Migration note: child skills no longer ship their own `openclaw-plugin` wrapper files. OpenClaw should keep loading only the main `js-eyes` plugin, which then auto-loads enabled local skills.

| Skill | Description | Tools |
|-------|-------------|-------|
| [js-x-ops-skill](./skills/js-x-ops-skill/) | X.com (Twitter) content operations — search content, browse timelines and feed, read post details, and handle posting flows | `x_search_tweets`, `x_get_profile`, `x_get_post`, `x_get_home_feed` |

### Discovering Skills

AI agents can discover available skills automatically:

```
# Via the AI tool
js_eyes_discover_skills

# Via the skill registry
https://js-eyes.com/skills.json
```

### Installing Extension Skills

**One-command install:**

```bash
# Linux / macOS (arg)
curl -fsSL https://js-eyes.com/install.sh | bash -s -- js-x-ops-skill

# Linux / macOS (env var, same as PowerShell)
curl -fsSL https://js-eyes.com/install.sh | JS_EYES_SKILL=js-x-ops-skill bash

# Windows PowerShell
$env:JS_EYES_SKILL="js-x-ops-skill"; irm https://js-eyes.com/install.ps1 | iex
```

**Via AI agent:** the agent calls `js_eyes_install_skill` with the skill ID. It downloads, extracts, installs dependencies, and enables the skill in the JS Eyes host config. Since 2026-04-19 the main plugin **hot-loads** the skill via `SkillRegistry` + chokidar within ~300 ms — no OpenClaw restart needed unless the skill introduces a brand-new tool name (see [deployment.zh.md §5.3](./docs/dev/js-eyes-skills/deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)).

**Via the js-eyes CLI:**

```bash
js-eyes skills install js-x-ops-skill
js-eyes skills enable js-x-ops-skill
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

**Manual:** download the skill zip from [js-eyes.com/skills/js-x-ops-skill/](https://js-eyes.com/skills/js-x-ops-skill/js-x-ops-skill-skill.zip), extract to `skills/js-eyes/skills/js-x-ops-skill/`, run `npm install`, then `js-eyes skills enable js-x-ops-skill`. A running OpenClaw + `js-eyes` plugin will hot-load the skill via the config watcher; call `js-eyes skills reload` (or Agent tool `js_eyes_reload_skills`) to force a reload. An OpenClaw restart is only required for brand-new tool names the host has never registered before.

### Authoring your own JS Eyes Skill

Custom skills don't have to live inside this repository. Two ways to hook them in:

- Point `skillsDir` at the parent folder that contains your skills (js-eyes takes full lifecycle ownership — `install` / `approve` / `verify` all act on this dir).
- Keep the default `skillsDir` and add individual skill folders (or parent folders) to `extraSkillDirs`. Extras are **read-only**: they're discovered and their tools are registered, but js-eyes never mutates them.

The fastest path for an external custom skill is **zero-restart**: `js-eyes skills link /abs/path/to/my-skill` appends the directory to `extraSkillDirs` and triggers an in-memory `registry.reload()` on the running plugin. `js-eyes skills unlink <path>` / `js-eyes skills reload` (and the `js_eyes_reload_skills` Agent tool) cover the rest of the lifecycle. See [deployment.zh.md §5.3](./docs/dev/js-eyes-skills/deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐).

See:

- [docs/dev/js-eyes-skills/](./docs/dev/js-eyes-skills/) — authoring guide, `skill.contract.js` reference, deployment modes (Chinese first).
- [examples/js-eyes-skills/js-hello-ops-skill/](./examples/js-eyes-skills/js-hello-ops-skill/) — minimal runnable sample (one tool, no side effects).

The runtime packages are published to the [`js-eyes`](https://www.npmjs.com/org/js-eyes) npm organization under the `@js-eyes/*` scope, so external skills can depend on them directly:

```bash
npm install @js-eyes/client-sdk @js-eyes/config @js-eyes/skill-recording
```

> **`@js-eyes/*` scope is reserved for official packages** published by this repository's maintainers. Third-party JS Eyes Skills and integrations must publish under their own npm scope (e.g. `@acme/js-my-cool-skill`) or an unscoped name, never under `@js-eyes/*`. See [docs/dev/js-eyes-skills/README.md](./docs/dev/js-eyes-skills/README.md#npm-scope-治理) for the full governance rule.

> Terminology: **JS Eyes Skills** refers to this repo's `skill.contract.js` contract. The `skills/` namespace under [docs/dev/](./docs/dev/) and [examples/](./examples/) is reserved for future compatibility with generic Skills specs (Anthropic Agent Skills, Cursor Skills, etc.). See [docs/README.md](./docs/README.md) for the full namespace map.

## Building

### Prerequisites

- Node.js >= 22
- Run `npm install` in the project root
- `npm run build:firefox` requires `AMO_API_KEY` and `AMO_API_SECRET` (for Mozilla signing). The repository now installs `web-ext` locally via `npm install`, so no separate global install is required.

### Build Commands

```bash
# Build the main ClawHub/OpenClaw skill bundle only
npm run build:skill

# Build site (docs/) + skill bundles + skills.json registry
npm run build:site

# Build all release artifacts
npm run build

# Build Chrome extension only
npm run build:chrome

# Build and sign Firefox extension
npm run build:firefox

# Bump version across all manifests
npm run bump -- 2.5.1
```

Output files are saved to the `dist/` directory. The main skill bundle is staged under `dist/skill-bundle/js-eyes/`, published to `docs/js-eyes-skill.zip`, and versioned for releases as `dist/js-eyes-skill-v<version>.zip`.

For ClawHub publishing, use the generated bundle output (`dist/skill-bundle/js-eyes/` or the versioned zip in `dist/`) as the source of truth instead of publishing from the monorepo root.

For the maintainer release checklist (`develop` -> `main`, npm CLI publish, GitHub Release, Firefox signed XPI, and AMO public submission), see [RELEASE.md](RELEASE.md).

## Smoke Test

Use this checklist after a fresh ClawHub install:

1. `cd ./skills/js-eyes && npm install`
2. Confirm the resolved `openclaw.json` contains:
   - `plugins.load.paths` -> absolute path to `./skills/js-eyes/openclaw-plugin`
   - `plugins.entries["js-eyes"].enabled` -> `true`
3. Restart or refresh OpenClaw
4. Run `openclaw js-eyes status`
5. Install the browser extension, connect it to `http://localhost:18080`, then run `openclaw js-eyes tabs`
6. Ask the agent to call `js_eyes_get_tabs`
7. Ask the agent to call `js_eyes_discover_skills`
8. Install one child skill with `js_eyes_install_skill` (or `js-eyes skills link <path>` for external skills). The main plugin hot-reloads within ~300 ms via the config watcher; confirm via `js_eyes_reload_skills` or the `Hot-loaded skill` / `added` entries in the gateway logs. Restart OpenClaw only if `failedDispatchers` reports a brand-new tool name the host refused to register at runtime.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension shows "Disconnected" | Check `openclaw js-eyes status`; ensure `autoStartServer` is `true` |
| `js_eyes_get_tabs` returns empty | Click extension icon, verify address, click Connect |
| `Cannot find module 'ws'` | Run `npm install` in the skill root |
| Tools not appearing in OpenClaw | Ensure `plugins.load.paths` points to the main `openclaw-plugin` subdirectory and the target child skill is not disabled in the JS Eyes host config |
| Plugin path not found (Windows) | Use forward slashes in JSON, e.g. `C:/Users/you/skills/js-eyes/openclaw-plugin` |

## Related Projects

- [OpenClaw](https://openclaw.ai/) — AI agent framework with extensible plugin system
- [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork) — AI agent framework with full-featured browser automation support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Created by **[@imjszhang](https://x.com/imjszhang)**

---

<div align="center">

**Browser automation for any AI agent framework**

[js-eyes.com](https://js-eyes.com) | [GitHub](https://github.com/imjszhang/js-eyes) | [@imjszhang](https://x.com/imjszhang)

</div>
