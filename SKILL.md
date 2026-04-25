---
name: js-eyes
description: Install, configure, verify, and troubleshoot JS Eyes browser automation for OpenClaw.
version: 2.6.2
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
- The user wants to mount a **custom / external** extension skill (a directory outside the bundle that contains a `skill.contract.js`) into a running OpenClaw, or to verify that such a skill is actually loaded.
- The user wants to **author a new extension skill from scratch** — in that case, point them at the starter template and authoring guide (see `Authoring A New Extension Skill` below) rather than writing files from nothing.

## What Success Looks Like

A successful setup has all of the following:

1. `npm install` has been run in `{baseDir}` with Node.js 22 or newer.
2. OpenClaw loads `{baseDir}/openclaw-plugin` via `plugins.load.paths`.
3. `plugins.entries["js-eyes"].enabled` is `true`.
4. `tools.alsoAllow` (preferred) or `tools.allow` includes `js-eyes`, so the plugin's optional tools are actually exposed to the model.
5. The user can run `openclaw js-eyes status`.
6. The browser extension is connected to `http://<serverHost>:<serverPort>`, the popup **Server Token** field is populated (2.2.0+), and `js_eyes_get_tabs` returns real tabs.
7. The user can later run `js_eyes_discover_skills` / `js_eyes_install_skill` to add extension skills dynamically, and the main plugin auto-loads installed skills from `{baseDir}/skills` or the configured `skillsDir` (primary), plus any read-only directories listed in `extraSkillDirs` (extras).
8. `js-eyes doctor` reports an acceptable security posture for this skill's deployment (token present, `allowAnonymous=false`, **`allowRawEval=true` in `~/.js-eyes/config/config.json`**, host bound to loopback, skill integrity OK). `doctor` will still label raw eval as insecure — that is expected when following this skill.

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
   - **Restart scope**: only changes to files **under `openclaw-plugin/` itself** (or any `packages/*` module the plugin imports directly) require restarting / refreshing OpenClaw so the plugin module is re-`require`d. Edits to individual skill files (`skills/<id>/skill.contract.js`, an `extraSkillDirs` entry's contract, etc.) are picked up hot by the `SkillRegistry` + chokidar watcher — no restart needed.

For **both** deployment modes above, treat **host-side raw eval** as part of the default install: merge `security.allowRawEval: true` into `~/.js-eyes/config/config.json` (Windows: `%USERPROFILE%/.js-eyes/config/config.json`) **during** deployment — not in `openclaw.json`. The js-eyes server reads this file; the browser extension syncs the value on WebSocket handshake (2.5.1+). Restart the server / OpenClaw after changing it so `execute_script` raw JavaScript is not blocked with `RAW_EVAL_DISABLED`.

Also for **both** modes, if the operator will use the extension popup **Sync Token From Host** / 从本机同步 (2.4.0+), register the Native Messaging host on that machine. **Preferred (local launcher, no network):** from the checked-out repo run `bin/js-eyes-native-host-install.sh --browser all` (macOS/Linux) or `./bin/js-eyes-native-host-install.ps1 -Browser all` (Windows); both forward to `node apps/cli/bin/js-eyes.js native-host install`, which never touches the npm registry. **Fallback:** `npx js-eyes native-host install --browser all` — only recommended when `js-eyes` is globally installed and the operator trusts the npm registry at install time. Confirm with `node apps/cli/bin/js-eyes.js native-host status` (manifest + launcher must exist; on Windows the `.bat` lives under `%LOCALAPPDATA%\js-eyes\native-host\`). Then restart the browser or reload the extension. Skipping this step leaves manual token paste as the only path and often surfaces `native-messaging-disconnected` in the popup. See `docs/native-messaging.md`.

## Safe Default Mode (no raw eval)

This section is **informational** — the default Setup Workflow below still opts
into `allowRawEval=true` for full compatibility with the 2.6.x SKILL contract.
If an operator explicitly wants the host-hardened posture (ClawHub's
`security.allowRawEval=false` default), use the guidance here; nothing outside
this section changes.

- **What still works without `allowRawEval`**: `js_eyes_open_url`,
  `js_eyes_get_tabs`, `js_eyes_screenshot`, `js_eyes_xpath*`,
  `js_eyes_click`, `js_eyes_type`, `js_eyes_hover`, `js_eyes_scroll`,
  `js_eyes_press_key`, `js_eyes_execute_action` (declarative action DSL),
  `js_eyes_find_element`, `js_eyes_reload_skills`, `js_eyes_reload_security`,
  plus every extension-skill tool that goes through `execute_action`. For the
  vast majority of browsing / form-filling / data-extraction flows this is
  sufficient.
- **What gets refused with `RAW_EVAL_DISABLED`**: `js_eyes_execute_script` and
  `js_eyes_execute_script_async` — the raw-JS entry points. Sensitive tools
  that also happen to run raw JS (e.g. some `inject_css` variants when a skill
  passes inline scripts) will soft-fail the same way; the dispatcher prints
  `reason: RAW_EVAL_DISABLED` in the audit log.
- **`doctor` output differs**: when `allowRawEval=false`,
  `js-eyes doctor` / `js-eyes doctor --json` reports **no** "expected insecure"
  footnote on that row — the default value is the safe value, so the tool
  treats it as a clean posture. Everything else (token presence,
  `allowAnonymous=false`, loopback bind, skill integrity, `extraSkillDirs`
  integrity if `verifyExtraSkillDirs=true`) is reported identically to the
  standard SKILL deployment.
- **How to opt in**: omit the `security.allowRawEval: true` merge from step 5
  of the Setup Workflow (or set it to `false` in an existing
  `~/.js-eyes/config/config.json`), restart the js-eyes server / OpenClaw, and
  optionally flip `security.verifyExtraSkillDirs=true` to close the
  extraSkillDirs gap described in
  [SECURITY_SCAN_NOTES.md](./SECURITY_SCAN_NOTES.md#c-extraskilldirs-bypass-integrity-verification).
- **Behaviour guarantee**: if an operator follows the default SKILL workflow
  below without any of these tweaks, the runtime behaviour in 2.6.2 is
  identical to 2.6.1 — Safe Default Mode is purely additive guidance.

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
   - merge or create the **JS Eyes host config** at `~/.js-eyes/config/config.json` (Windows: `%USERPROFILE%/.js-eyes/config/config.json`) with `security.allowRawEval: true` so deployment matches this skill (see `Host security config` below). Restart the js-eyes server after edits (or restart OpenClaw if it auto-starts the server).
6. Restart or refresh OpenClaw so the plugin is reloaded.
7. Verify with `openclaw js-eyes status`.
8. Initialize the local server token if this is a fresh 2.2.0+ install: `js-eyes server token init`. Then either (preferred, 2.4.0+) run the local launcher `bin/js-eyes-native-host-install.sh --browser all` (macOS/Linux) / `./bin/js-eyes-native-host-install.ps1 -Browser all` (Windows) — or the equivalent `node apps/cli/bin/js-eyes.js native-host install --browser all` — so the extension auto-syncs the token **without hitting the npm registry**. `npx js-eyes native-host install` remains as a fallback when the operator already has `js-eyes` globally installed. Otherwise run `js-eyes server token show --reveal` and paste the value into the extension popup **Server Token** field under **Advanced**.
9. If the server is healthy but no browser is connected, guide the user through browser extension installation, server-token entry, and connection.
10. After the base setup works, pick the right path for extension skills:
    - **Registry / first-party skills**: prefer `js_eyes_discover_skills` + `js_eyes_install_skill` — 2.2.0+ writes a plan under `runtime/pending-skills/<id>.json`; finalize with `js-eyes skills approve <id>` then `js-eyes skills enable <id>`.
    - **Custom / external skills** (a directory the user already has on disk): prefer `js-eyes skills link <abs-path>` — it appends the path to `extraSkillDirs`, auto-enables it on first discovery, and the running plugin hot-loads it within ~300 ms via the config watcher. Reverse with `js-eyes skills unlink <abs-path>`. No OpenClaw restart is needed for either direction; see the `Dynamic Extension Skills` section for the full zero-restart contract.
11. Run `js-eyes doctor` to confirm the deployment posture (token present, `allowAnonymous=false`, **`allowRawEval` enabled** — `doctor` may still print it as insecure, which is expected here, loopback-bound, skill integrity OK) before handing off.

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

### Host security config (`~/.js-eyes/config/config.json`)

This file is **not** `openclaw.json`. For deployments following this skill, ensure at least:

```json
{
  "security": {
    "allowRawEval": true
  }
}
```

Merge with existing keys (for example `skillsDir`, `skillsEnabled`). Operators who **do not** need raw `execute_script` may set `allowRawEval` to `false` instead; optional plugin tools then still work, but raw JS payloads are rejected until enabled.

Important details:

- The path must end in `openclaw-plugin`.
- On Windows JSON paths, prefer forward slashes such as `C:/Users/name/skills/js-eyes/openclaw-plugin`.
- If `paths` or `entries` already exist, merge rather than overwrite.
- `js-eyes` registers its tools as optional plugin tools, so a complete deployment also needs `tools.alsoAllow: ["js-eyes"]` or an equivalent `tools.allow` entry.
- To mount extension skills from outside `{baseDir}/skills` (e.g. a user's private `~/my-skills/js-foo-ops-skill`), either add absolute paths to `plugins.entries["js-eyes"].config.extraSkillDirs: [...]` directly, or let the CLI handle it: `js-eyes skills link <abs-path>` does the dedup append and also triggers an in-memory reload on the running plugin. Entries are read-only to js-eyes (no `install` / `approve` / `verify` / integrity check).
- Two new optional plugin config booleans control the hot-reload watchers (both default `true`): `watchConfig` (listen on `~/.js-eyes/config/config.json`) and `devWatchSkills` (listen on discovered skill directories). Turn them off only if fs-watch load is a concern or in sandboxed environments.

#### Host security hot-reload (2.5.2+)

Some `security.*` fields can be swapped into the running JS Eyes server **without** restarting OpenClaw or the server. The server-core ships its own chokidar watcher on `~/.js-eyes/config/config.json` (separate from the plugin's skill watcher) and a `reloadSecurity()` handle that the built-in `js_eyes_reload_security` tool calls on demand.

- **Hot-reloadable** (swap takes effect on the next automation call, ~500 ms from fs write; also immediately via `js_eyes_reload_security`):
  - `security.egressAllowlist`
  - `security.toolPolicies`
  - `security.sensitiveCookieDomains`
  - `security.allowedOrigins`
  - `security.enforcement`
- **Not hot-reloadable — server restart required** (changing these appears under `ignored` in the reload summary, with a one-line warning in the gateway log): `serverHost`, `serverPort`, `allowAnonymous`, `allowRemoteBind`, `allowRawEval`, `requireLockfile`, and anything outside `security.*` (token rotation, `requestTimeout`, etc.).
- **Caveat — session-level egress approvals reset**: when the allowlist flips, each live automation connection rebuilds its `PolicyContext`, which means per-session `js-eyes egress approve <id>` grants are dropped. Agents re-issue the approval on the next `pending-egress` response; no action needed for standard `allow <domain>` edits because those are part of the static allowlist and get picked up automatically.
- **Operator triggers** (any one is sufficient):
  1. Edit `~/.js-eyes/config/config.json` and save — chokidar debounces 300 ms and fires `reloadSecurity({ source: 'fs-watch' })`.
  2. Agent call: `js_eyes_reload_security` built-in tool (returns `{ changed, applied, ignored, generation, egressAllowlist }`).
  3. CLI preview: `js-eyes security reload` — read-only dry run that prints what would be applied (CLI does not own the server event loop, so trigger #1 or #2 is required for the actual swap).
- **Observability**: the audit log (`~/.js-eyes/logs/audit.log`) gains three new events — `config.hot-reload`, `config.hot-reload.error`, `automation.policy-rebuilt` — and `GET /api/browser/status` now includes `data.policy.generation` / `data.policy.egressAllowlist` so operators can externally confirm the live generation.

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

### Verifying A Specific Extension Skill Is Loaded

When the user asks "did my skill get picked up?", check all four:

1. `~/.js-eyes/config/config.json` has `skillsEnabled["<id>"]: true` and (for externals) the skill's directory or a parent is listed in `extraSkillDirs`.
2. Tail the gateway log and look for one of these lines from `[js-eyes]`:
   - `Skill sources: primary=<dir> extras=<N>` — confirms extras were seen at startup.
   - `Loaded local skill "<id>" with K tool(s)` — initial load at plugin boot.
   - `Hot-loaded skill "<id>" with K tool(s)` — loaded at runtime by the config / skill-dir watcher.
   - `Discovered <N> skill(s): <K> active` — gives a numeric sanity check.
3. Ask the agent to call the built-in tool `js_eyes_reload_skills`; the returned summary must contain the id under `added` or `reloaded`, and `failedDispatchers` must be empty.
4. Run `js-eyes skills list` from the host shell; each entry is annotated with `Source: primary` or `Source: extra (<path>)`.

If steps 2-4 all fail for a freshly linked external skill, see the `Custom Extension Skill Not Picked Up` troubleshooting entry below.

## Browser Extension Connection

If the plugin is enabled but no browser is connected:

1. Install the JS Eyes browser extension separately from GitHub Releases or the website.
2. (Preferred, 2.4.0+) Run the local launcher `bin/js-eyes-native-host-install.sh --browser all` (macOS/Linux) or `./bin/js-eyes-native-host-install.ps1 -Browser all` (Windows) — equivalent to `node apps/cli/bin/js-eyes.js native-host install --browser all`; this never contacts the npm registry. `npx js-eyes native-host install --browser all` remains as a fallback. Either path sets up Native Messaging so the extension auto-syncs `server.token` and the HTTP URL; then open the popup and click **Sync Token From Host**.
3. Manual fallback: open the extension popup, expand **Advanced**, set the server address to `http://<serverHost>:<serverPort>`, paste the output of `js-eyes server token show --reveal` into the **Server Token (2.2.0+)** field, and click `Connect`.
4. Re-run `openclaw js-eyes status`.

The browser extension is not bundled inside the main ClawHub skill. It must be installed separately. Connections without a matching server token are rejected unless the operator has set `security.allowAnonymous=true`.

## Authoring A New Extension Skill

When the user wants to create a brand-new extension skill (not install / mount an existing one), do not scaffold files from scratch. Guide them through the canonical starter flow:

1. **Copy the reference starter** `examples/js-eyes-skills/js-hello-ops-skill/` to a directory of their choice (typically `~/my-skills/js-<domain>-ops-skill/`). Point out that the starter already ships a working `skill.contract.js`, `package.json`, an `async runtime.dispose()` hook, a sample tool, and a `SKILL.md` frontmatter.
2. **Rename the three identifiers in lockstep**: `package.json.name`, `SKILL.md` frontmatter `name:`, and `skill.contract.js` → `id` + `name`. Discovery resolves id via `contract.id || pkg.name || path.basename(skillDir)` (see `normalizeSkillMetadata` in `packages/protocol/skills.js`), so mismatches do not break load — but `skillsEnabled.<id>`, `js-eyes skills link/enable/disable <id>`, and log messages all key off whatever the contract finally resolves to. Keeping directory name / pkg name / contract id identical is the only reliable way to keep CLI and config references coherent.
3. **Read the authoring guides before wiring real logic** — the canonical references are:
   - `docs/dev/js-eyes-skills/authoring.zh.md` — directory layout, discovery rules, quick-start.
   - `docs/dev/js-eyes-skills/contract.zh.md` — `skill.contract.js` surface (tools / runtime / `runtime.dispose()` lifecycle).
   - `docs/dev/js-eyes-skills/deployment.zh.md` — the zero-restart deployment flow the skill will end up in.
4. **Install local deps** with `npm install` inside the new skill directory so `ws` / `@js-eyes/client-sdk` resolve at load time.
5. **Mount it zero-restart** with `js-eyes skills link <abs-path>`; the running plugin auto-discovers it within ~300 ms. Iterate on `skill.contract.js` in place — saves are hot-reloaded by the `SkillRegistry` skill-dir watcher; no OpenClaw restart is needed until the skill introduces a **brand-new tool name** the host has never registered (rare, and the reload diff will say so via `failedDispatchers`).
6. **When ready to publish**, decide between contributing it back to the first-party `skills/` directory (registry / ClawHub distribution) or keeping it external via `extraSkillDirs` / `link` forever — both paths are supported and zero-restart after mount.

Do not invent a different layout. Extension skills are discovered only if they satisfy the exact contract the starter demonstrates.

## Dynamic Extension Skills

The main `js-eyes` bundle is intentionally minimal. It does not preinstall child skills.

There are two complementary discovery surfaces — pick the right one when the user asks "what skills do I have?":

- **Local / installed view** (what is actually mounted right now): `js-eyes skills list` from the host shell, or `js_eyes_reload_skills` which returns a live diff. Each entry carries a `Source: primary` vs `Source: extra (<path>)` annotation.
- **Registry / installable view** (what could be installed from `skills.json`): `js_eyes_discover_skills` (agent tool). Installed rows are marked `✓ 已安装`, installable rows `○ 未安装`.

After the base plugin works:

- Use `js_eyes_discover_skills` to list available **first-party** extension skills from the registry.
- Use `js_eyes_install_skill` to stage a **plan** — 2.2.0+ downloads the bundle, verifies its `sha256` against `skills.json`, and writes `runtime/pending-skills/<id>.json` without installing.
- Finalize the plan with `js-eyes skills approve <id>`, then enable it with `js-eyes skills enable <id>`.
- Use `js-eyes skills verify` (or `js-eyes doctor`) to confirm `.integrity.json` still matches the on-disk skill files.
- Since 2026-04-19 the main plugin **hot-loads** newly enabled or linked skills (and hot-disposes disabled ones) via `SkillRegistry` + a chokidar watcher on the host config — no OpenClaw restart needed. For external custom skills, prefer `js-eyes skills link <abs-path>` / `js-eyes skills unlink <abs-path>`; to force a refresh, call `js-eyes skills reload` or have the agent invoke the `js_eyes_reload_skills` tool (it returns an `added` / `removed` / `reloaded` / `toggledOff` / `conflicts` / `failedDispatchers` diff).
- Recommend an OpenClaw restart only when `js_eyes_reload_skills` reports non-empty `failedDispatchers` — that means the host refused to register a brand-new tool name at runtime, which a restart will resolve. Everything else (install, enable, disable, replace, unlink) is zero-restart.

### Skill Lifecycle Cheat Sheet

Use this table to pick the correct command for any user intent. All rows are zero-restart unless otherwise noted.

| Intent | Registry skill (shipped in `skills.json`) | External skill (arbitrary directory on disk) |
|---|---|---|
| Inspect what is installed locally | `js-eyes skills list` | same (entries annotated `Source: extra (<path>)`) |
| Browse what can be installed | `js_eyes_discover_skills` | N/A (externals are out-of-registry by definition) |
| Install / mount | `js_eyes_install_skill` → `js-eyes skills approve <id>` → `js-eyes skills enable <id>` | `js-eyes skills link <abs-path>` (auto-enables on first discovery) |
| Upgrade to the latest registry version | `js-eyes skills update <id>` (preserves `skillsEnabled`, honors `minParentVersion`); `js-eyes skills update --all` for every primary-source skill; rerunning `curl … \| JS_EYES_SKILL=<id> bash` works too | N/A — externals are managed in their source tree; pull/rebuild there |
| Temporarily stop without removing | `js-eyes skills disable <id>` — `runtime.dispose()` fires, tools stop responding, files stay on disk | `js-eyes skills disable <id>` (works the same; the `link` path stays in `extraSkillDirs`) |
| Re-enable | `js-eyes skills enable <id>` | `js-eyes skills enable <id>` |
| Replace / edit in place | Edit `{baseDir}/skills/<id>/skill.contract.js` and save — picked up by the skill-dir watcher, or call `js-eyes skills reload` | Same, against the external directory |
| Verify integrity | `js-eyes skills verify [<id>]` — checks `.integrity.json` | N/A — integrity manifests only exist for registry installs |
| Remove / uninstall | **The CLI intentionally has no `uninstall` subcommand.** Soft-remove: `js-eyes skills disable <id>` (recommended). Hard-remove: after disable, delete `{baseDir}/skills/<id>/` manually, then optionally clear the `skillsEnabled.<id>` key from `~/.js-eyes/config/config.json` to keep it tidy. | `js-eyes skills unlink <abs-path>` — removes the path from `extraSkillDirs` and hot-unloads every skill that was sourced from it |
| Force a re-scan | `js-eyes skills reload` or `js_eyes_reload_skills` (agent tool) | Same |

The agent SHOULD execute these commands directly when it has shell access. If it does not (read-only / "ask" mode), it SHOULD print the exact command for the user to run and then re-verify via `js-eyes skills list` or `js_eyes_reload_skills` afterwards.

Do not instruct the user to register child-skill plugin paths manually. Child skills no longer ship their own `openclaw-plugin` wrappers.

Prefer the built-in install flow over manual zip extraction when the user wants additional JS Eyes capabilities.

## Troubleshooting

### `Cannot find module 'ws'`

Run `npm install` in `{baseDir}`. The bundle expects dependencies to be installed from the skill root.

### `js_eyes_*` tools do not appear

Check:

1. `plugins.load.paths` points to `{baseDir}/openclaw-plugin`.
2. `plugins.entries["js-eyes"].enabled` is `true`.
3. `tools.alsoAllow` or `tools.allow` includes `js-eyes`.
4. For items 1-3 (OpenClaw-level plugin config), OpenClaw has been restarted or refreshed since the config change — the plugin module itself is loaded once per OpenClaw process. **Skill-level** changes (`skillsEnabled.<id>`, `extraSkillDirs`, edits to a `skill.contract.js`) do **not** need a restart; they are applied by the `SkillRegistry` config / skill-dir watcher.
5. If this is an extension skill, confirm it is not disabled in the JS Eyes host config (`skillsEnabled.<id>: true`) and that legacy OpenClaw child-plugin entries are removed.

### Custom Extension Skill Not Picked Up

For a custom external skill mounted via `js-eyes skills link <abs-path>` where no tools appear and the log has no `Loaded local skill "<id>"` / `Hot-loaded skill "<id>"` line, check in order:

1. **Path actually landed in config**: `~/.js-eyes/config/config.json` → `extraSkillDirs` contains the path; `skillsEnabled["<id>"]` is `true`.
2. **Skill is self-contained**: `cd <abs-path> && ls skill.contract.js package.json` succeed, and `npm install` has been run inside that directory so transitive deps like `ws` / `@js-eyes/client-sdk` resolve.
3. **Contract actually loads**: the gateway log contains no `Failed to load skill "<id>"` entry; if it does, the error message identifies the offending `require` or syntax issue. Fix in place and call `js-eyes skills reload` (or `js_eyes_reload_skills`) — no OpenClaw restart needed.
4. **Id conflict with primary**: look for `Skipping extra skill ... same id already loaded from primary`. Primary wins by design; rename the custom skill's `id` in its `package.json` / `skill.contract.js` or move it into primary.
5. **Brand-new tool name refused by host**: if `js_eyes_reload_skills` returns a non-empty `failedDispatchers`, OpenClaw refused to register a tool name post-boot. This is the one case that needs a one-shot OpenClaw restart; after the restart the skill loads normally.
6. **Plugin is running an outdated version** (after a `git pull` / upgrade but before restart): the running plugin may predate `SkillRegistry`. In the gateway log look for `[js-eyes] Watching host config: ...` — if it is missing, restart OpenClaw **once** to pick up the new plugin code; subsequent skill changes stay zero-restart.

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

### Open URL or automation tools fail with egress / policy messages (2.3.0+)

If `js_eyes_open_url` or other browser tools return text mentioning **pending-egress**, **出站策略**, or **POLICY_SOFT_BLOCK**, the server applied the policy engine **before** the extension ran the action (navigation may never reach the browser).

1. Run `js-eyes security show` and inspect `egressAllowlist` and `taskOrigin` (hosts must be in static allowlist, session scope, or task-origin scope — see `SECURITY.md` Policy Engine).
2. Run `js-eyes egress list`; use `js-eyes egress approve <id>` for a queued host or `js-eyes egress allow <domain>` to append to `security.egressAllowlist`.
3. If you rely on **active-tab** scope, call `js_eyes_get_tabs` (or ensure the automation client has seeded tab state) so the active tab’s host is in scope before opening URLs on that host.

This is separate from **consent** (`js-eyes consent …`) and from extension disconnect issues.

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
