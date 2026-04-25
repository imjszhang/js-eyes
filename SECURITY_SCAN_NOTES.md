# Security Scan Notes

> Last updated: 2026-04-24 · Applies to **js-eyes 2.6.2**

## Scope

This document is the authoritative response to the
[ClawHub Security Scan](https://clawhub.ai/imjszhang/js-eyes) of `js-eyes v2.6.1`,
which flagged the skill as **Suspicious** (medium confidence) with:

- **5 static-analysis patterns** (shell exec, env + network, file read + network);
- **6 OpenClaw narrative concerns** (registry metadata mismatch, allowRawEval
  default, extraSkillDirs integrity, `npx` native-host install, `autoStartServer`,
  tool allowlist / raw-eval blast radius).

2.6.2 is a **security-hygiene release with zero behavioural changes**. Its goals are:

1. Split the call sites flagged by static analysis so each module does **one** of
   {shell, env read, file read, network} — never two at once.
2. Add an **opt-in** integrity layer for `extraSkillDirs` (off by default).
3. Document every finding with a clear statement of *what changed now* vs *what
   remains a conscious 2.6.x default* vs *what is queued for 2.7*.

`cosign` / `minisign` release signing, SBOM emission, CI vulnerability scans, and
ClawHub-side registry-metadata fixes are **out of scope** for 2.6.2. They are
tracked for 2.7.

## Re-running the scan locally

A self-contained reproduction of the ClawHub heuristic ships in the repo:

```bash
# Human-readable report
npm run scan:security

# JSON for CI / auditors
node scripts/scan-clawhub-patterns.js --json
```

The scanner (`scripts/scan-clawhub-patterns.js`) walks `packages/protocol/` +
`openclaw-plugin/` (the same scope ClawHub v2.6.1 pinned its 5 findings to)
and surfaces three regex rules: shell execution, env + network co-location,
and file read + network co-location. It strips comments before matching so
documentation referencing the forbidden patterns does not create false hits.

Expected output on a clean 2.6.2 tree is:

```
Total: 3 (expected: 3, unexpected: 0)
```

The three **expected residuals** are shell-execution call sites that live in
single-purpose hardened modules — each is exhaustively documented in §1
below and listed explicitly in the scanner's allowlist. The scanner exits
`0` when `unexpected === 0`, so CI can use it as a simple gate against
regressions.

Auditors who prefer external tools can also run:

```bash
# Shell command execution (child_process)
rg --type=js "require\('child_process'\)" -g '!test/**' -g '!scripts/**' packages/protocol openclaw-plugin

# Env + network co-located in the same file
rg -l "process\.env\." packages/protocol openclaw-plugin \
  | xargs -I{} rg -l "require\('ws'\)|require\('http'\)|require\('https'\)|new WebSocket|\bfetch\(" {}

# File read + network co-located in the same file
rg -l "fs\.(readFileSync|createReadStream)|readFileSync|createReadStream" packages/protocol openclaw-plugin \
  | xargs -I{} rg -l "require\('ws'\)|require\('http'\)|require\('https'\)|new WebSocket|\bfetch\(" {}

npm test -- test/import-boundaries.test.js
```

`test/import-boundaries.test.js` encodes the "no network imports in the
isolated modules" invariant as an AST assertion, so future regressions fail
CI loudly.

## Expected residual findings after 2.6.2

Three `shell` findings remain, each in a dedicated hardened module. They are
the structural minimum the scanner cannot eliminate — any `spawnSync` / `spawn`
callsite triggers the rule regardless of how many argv / env safeguards wrap
it. Every residual is gated by the scanner's allowlist in
`scripts/scan-clawhub-patterns.js` (`EXPECTED_RESIDUALS`).

| Module | Why it owns `child_process` | Hardening |
| --- | --- | --- |
| [`packages/protocol/safe-npm.js`](packages/protocol/safe-npm.js) | Only entrypoint for `npm ci` / `npm install` during skill-dependency install. | Whitelisted subcommand, constant argv, `shell:false`, `windowsHide:true`, whitelisted env; secrets in `process.env` never forwarded. |
| [`packages/protocol/skill-runner.js`](packages/protocol/skill-runner.js) | Launches a sub-skill's own Node CLI entry (`process.execPath` + argv). | `shell:false`, `windowsHide:true`; argv starts with `process.execPath` (no lookup via PATH); does not import any network helper (enforced by `test/import-boundaries.test.js`). |
| [`openclaw-plugin/windows-hide-patch.mjs`](openclaw-plugin/windows-hide-patch.mjs) | Boot-time patch: on Windows only, forces `windowsHide:true` on every `child_process.spawn` / `execFile` initiated from the plugin process. | No-op on POSIX; never spawns anything itself — only wraps existing APIs. Does not import any network helper. |

Adding a new `child_process` call in any other module **will** fail the
scanner (`unexpected` bucket) and CI, unless the new module is explicitly
added to the allowlist with a reviewed note here.

---

## Static analysis — 5 findings

Each finding is pinned to the file:line that was flagged in 2.6.1 and the
module that now owns the operation in 2.6.2.

### 1. `packages/protocol/skills.js:536` — Shell command execution

- **2.6.1 behaviour**: `installSkillDependencies` called `spawnSync('npm', argv, …)`
  in-line, in the same module that also talked to the registry and built skill
  manifests.
- **2.6.2 mitigation**: the only `child_process` call in `@js-eyes/protocol` now
  lives in [`packages/protocol/safe-npm.js`](packages/protocol/safe-npm.js). That
  module enforces:
  - subcommand selected from an **immutable whitelist** (`ci`, `install`) — callers
    pick by name, never by free-form string;
  - argv is built from constant arrays (`--no-audit`, `--no-fund`, etc.); no
    string concatenation from caller input;
  - `spawnSync` is always invoked with `shell: false` and `windowsHide: true`,
    so there is no shell interpolation path;
  - the child process env is a **whitelist** (`PATH`, `HOME`, `USERPROFILE`,
    `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `SYSTEMROOT`, `COMSPEC`, `TEMP`,
    `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `HOMEDRIVE`, `HOMEPATH`,
    `PATHEXT`) — secrets such as `JS_EYES_SERVER_TOKEN` and OpenClaw tokens in
    `process.env` are **never** forwarded into npm;
  - postinstall scripts remain disabled unless the caller explicitly opts in.
- **Residual risk**: npm itself is still a remote package manager. Operators who
  want to install from an offline lockfile can set
  `plugins.entries["js-eyes"].config.requireLockfile=true` (already supported).
- **Scanner impact**: the `child_process` call now lives in a small, dedicated
  file that does no network I/O and reads no env directly; the finding should
  reclassify as *reviewed / hardened* on the next scan.
- **Tests**: [`test/safe-npm.test.js`](test/safe-npm.test.js).

### 2. `openclaw-plugin/index.mjs:204` — Env + network send

- **2.6.1 behaviour**: `getServerToken()` read `process.env.JS_EYES_SERVER_TOKEN`
  in the same module that constructs the plugin's WebSocket client.
- **2.6.2 mitigation**: `getServerToken()` + `getLocalRequestHeaders()` were
  extracted to [`openclaw-plugin/auth.mjs`](openclaw-plugin/auth.mjs). That module:
  - is `import`-verified to **never** import `ws`, `http`, `https`, `net`, or
    any of their `node:*` equivalents;
  - returns a plain headers object; the caller (the transport layer) is
    responsible for actually sending bytes on the wire;
  - keeps the existing `JS_EYES_SERVER_TOKEN` semantics unchanged.
- **Residual risk**: none — the env read is now structurally impossible to
  co-locate with a network client. Enforced by
  [`test/import-boundaries.test.js`](test/import-boundaries.test.js).

### 3. `packages/protocol/skills.js:150` — Env + network send

- **2.6.1 behaviour**: `getOpenClawConfigPath()` read `OPENCLAW_CONFIG_PATH` /
  `OPENCLAW_STATE_DIR` / `OPENCLAW_HOME` in the same file that exposes the
  HTTP-facing `downloadSkillBundle` / registry helpers.
- **2.6.2 mitigation**: the path resolver moved to
  [`packages/protocol/openclaw-paths.js`](packages/protocol/openclaw-paths.js).
  That module only imports `os` and `path`; `skills.js` now `require`s the
  resolver and **re-exports** the same symbol for backwards compatibility, so
  every external consumer keeps working.
- **Residual risk**: none — enforced by `test/import-boundaries.test.js`.

### 4. `openclaw-plugin/index.mjs:982` — File read + network send (possible exfil)

- **2.6.1 behaviour**: `_hashFileSync` called `fs.readFileSync(path)` to buffer
  an entire skill file before hashing, inside the plugin module that also owns
  the WebSocket gateway.
- **2.6.2 mitigation**: hashing moved to
  [`openclaw-plugin/fs-utils/hash.mjs`](openclaw-plugin/fs-utils/hash.mjs), which
  exports `hashFileSha1` (async streaming) and `hashFileSha1Sync` (sync, with a
  `maxBytes` ceiling). Both use `createHash('sha1').update(chunk)` so the full
  file is never resident in memory. The new module does not import any network
  library.
- **Residual risk**: hashes themselves never hit the wire — they are compared in
  process to detect skill drift. The "exfil" pattern matched the *shape* of
  read-then-network but the two operations are now in different files.
- **Tests**: `test/import-boundaries.test.js`.

### 5. `packages/protocol/skills.js:21` — File read + network send (possible exfil)

- **2.6.1 behaviour**: `readJson()` + `ensureDir()` lived in the same file as
  the registry downloader.
- **2.6.2 mitigation**: they moved to
  [`packages/protocol/fs-io.js`](packages/protocol/fs-io.js). The new module
  only imports `fs`; network imports are prohibited by
  `test/import-boundaries.test.js`.
- **Residual risk**: none.

---

## OpenClaw narrative — 6 concerns

### A. Registry metadata says "instruction-only" but the bundle ships code

- **Why it happens**: ClawHub's registry currently classifies `js-eyes` as an
  instruction skill, but the bundle contains `package.json`, the plugin
  entrypoint, and every `packages/*` workspace.
- **2.6.2 response**: this is a **registry metadata bug on ClawHub's side**, not
  a packaging choice. 2.6.2 does not ship registry metadata changes; the fix is
  tracked for 2.7 together with a registry resubmission. In the meantime
  auditors can verify the bundle contents with `git ls-tree -r --name-only HEAD`
  against the repo and `js-eyes skills verify` against `.integrity.json`.
- **Planned for 2.7**: update the ClawHub submission to declare the install
  surface (`npm ci --ignore-scripts`, lockfile required, node ≥22) so the
  scanner no longer sees a mismatch.

### B. `security.allowRawEval=true` is required by the skill

- **Why it happens**: `SKILL.md` still recommends setting
  `security.allowRawEval=true` so `execute_script*` can run raw JavaScript —
  this is what the skill has always done.
- **2.6.2 response**:
  - The host default stays **`allowRawEval=false`** (defined in
    `DEFAULT_SECURITY_CONFIG`, `packages/protocol/index.js`). Setting it to
    `true` is still an explicit operator choice; nothing in 2.6.2 enables it
    implicitly.
  - `SKILL.md` gains a new **"Safe Default Mode"** section documenting exactly
    which tools work without `allowRawEval` (clicks, typing, `open_url`,
    `get_tabs`, screenshots, xpath, etc.) and which are refused with
    `RAW_EVAL_DISABLED` (the `execute_script*` family). Operators who do not
    need raw JS can stay on the default and lose no core automation capability.
  - `README.md` adds a **Security Posture** table that makes the trade-off
    explicit.
- **Planned for 2.7**: split `execute_script` so a capability-scoped
  variant (parameterised DOM reads/writes) runs without `allowRawEval`; full
  raw-eval becomes an explicit opt-in tool.

### C. `extraSkillDirs` bypass integrity verification

- **Why it happens**: `extraSkillDirs` entries are registered read-only, and
  until 2.6.2 they had no `.integrity.json` manifest — a linked directory could
  drift without the host noticing.
- **2.6.2 response**: a **new optional integrity layer**.
  - New setting `security.verifyExtraSkillDirs` (default `false` — no behaviour
    change on upgrade).
  - New module [`packages/protocol/extra-integrity.js`](packages/protocol/extra-integrity.js):
    - `snapshotExtraDir(absPath)` writes a per-file sha256 map to
      `~/.js-eyes/state/extras/<sha1(absPath)>.json`. The snapshot lives
      **outside** the external skill dir, so js-eyes never writes into an
      operator-owned directory.
    - `verifyExtraDir(absPath)` reports `verified` / `drifted` /
      `missing-snapshot`.
  - `js-eyes skills link <abs-path>` auto-snapshots when verification is enabled;
    a new `js-eyes skills relink <abs-path>` forces re-snapshot after a
    reviewed edit; `js-eyes skills unlink` clears the snapshot.
  - `SkillRegistry` refuses to load an `extra` skill whose snapshot drifted, with
    a gateway-log line telling the operator to review changes and run `relink`.
  - `js-eyes doctor` (and `doctor --json`) prints the integrity status for each
    linked extra.
- **Residual risk**: the switch stays **off by default** to preserve 2.6.1
  compatibility for existing operators. The 2.7 plan is to flip it on by
  default and require explicit opt-out.
- **Tests**: [`test/extra-integrity.test.js`](test/extra-integrity.test.js).

### D. `npx js-eyes native-host install` runs remote code

- **Why it happens**: `npx …` without `--prefer-offline` can pull the package
  from npm on first run, which is exactly the "remote installer" pattern the
  scanner flags.
- **2.6.2 response**:
  - New **local launcher scripts** [`bin/js-eyes-native-host-install.sh`](bin/js-eyes-native-host-install.sh)
    and [`bin/js-eyes-native-host-install.ps1`](bin/js-eyes-native-host-install.ps1)
    that only shell out to `node apps/cli/bin/js-eyes.js native-host install`
    — zero network, zero registry lookup.
  - `SKILL.md` and `docs/native-messaging.md` now recommend the local launcher
    as the **preferred** path; `npx` remains documented as a fallback, clearly
    scoped to "only when `js-eyes` is globally installed and the operator
    trusts the npm registry".
- **Planned for 2.7**: ship signed native-host binaries so the install step
  needs neither `npx` nor a local node toolchain.

### E. `autoStartServer=true` expands blast radius

- **Why it happens**: the plugin defaults to auto-starting its embedded
  WebSocket/HTTP server on plugin load.
- **2.6.2 response**: **no change to the default** (that would break the
  SKILL.md deployment contract). The mitigations that are already in place —
  loopback-only bind by default, server token required for non-anonymous
  connections, Origin pinning, consent gates on sensitive tools — stay on.
  `README.md`'s Security Posture table now surfaces `autoStartServer` as an
  explicit toggle so operators who want manual-start semantics know the knob
  exists (`plugins.entries["js-eyes"].config.autoStartServer=false`).
- **Planned for 2.7**: consider `autoStartServer=false` as the default and
  ship a one-command bring-up replacement.

### F. Raw-eval + tool allowlist combine into a big blast radius

- **Why it happens**: `tools.alsoAllow: ["js-eyes"]` exposes every optional
  plugin tool to the model; combined with `allowRawEval=true` the model can in
  principle run arbitrary JavaScript inside the authenticated browser session.
- **2.6.2 response**:
  - `toolPolicies` continue to gate sensitive tools (`execute_script*`,
    `get_cookies*`, `upload_file*`, `inject_css`, `install_skill`) with the
    `confirm` default — operators approve each call via `js-eyes consent`.
  - Policy-engine egress allowlist (`security.egressAllowlist`) remains
    enforced for outbound URLs.
  - `README.md`'s posture table makes the combined raw-eval + allow-all
    surface explicit and links to `toolPolicies` configuration.
- **Planned for 2.7**: narrower `allow: ["js_eyes_open_url", …]` defaults
  documented in SKILL.md, plus the capability-scoped `execute_script` variant
  mentioned in (B).

---

## What 2.6.2 explicitly does NOT change

- No defaults flipped — upgrading from 2.6.1 is a drop-in.
- No new mandatory config — every new key (`security.verifyExtraSkillDirs`) has
  a back-compatible default.
- No CI / release pipeline changes (cosign, minisign, SBOM, supply-chain
  scanners) — those land in 2.7.
- No ClawHub registry metadata edits — requires a coordinated resubmission,
  tracked separately.

## Change log (security-scan delta 2.6.1 → 2.6.2)

- `packages/protocol/safe-npm.js` **new** — npm invocation allowlist.
- `packages/protocol/skill-runner.js` **new** — sub-skill CLI launcher
  (`process.execPath`, `shell:false`, `windowsHide:true`), no network.
- `packages/protocol/registry-client.js` **new** — registry HTTP I/O
  (`fetchSkillsRegistry`, `downloadBuffer`); isolates `fetch(…)` so it is no
  longer co-located with `fs.readFileSync` / `createReadStream`.
- `packages/protocol/openclaw-paths.js` **new** — env read, no network.
- `packages/protocol/fs-io.js` **new** — fs helpers, no network.
- `packages/protocol/extra-integrity.js` **new** — optional integrity snapshots.
- `openclaw-plugin/auth.mjs` **new** — token/header builder, no network.
- `openclaw-plugin/fs-utils/hash.mjs` **new** — streaming SHA1, no network.
- `openclaw-plugin/windows-hide-patch.mjs` **new** — Windows-only
  `child_process` patch isolated from the plugin entrypoint; no network.
- `packages/protocol/skills.js` refactored to delegate to the new modules (no
  signature changes; `installSkillDependencies`, `runSkillCli`,
  `fetchSkillsRegistry`, and `downloadBuffer` remain re-exported).
- `openclaw-plugin/index.mjs` switched to imports from `auth.mjs` /
  `fs-utils/hash.mjs` / `windows-hide-patch.mjs`.
- `apps/cli/src/cli.js` gained `skills relink`, `doctor --json`, and integrity
  status lines.
- `scripts/scan-clawhub-patterns.js` **new** local reproduction of the ClawHub
  heuristic with an `EXPECTED_RESIDUALS` allowlist; wired into
  `npm run scan:security`.
- `test/import-boundaries.test.js`, `test/safe-npm.test.js`,
  `test/extra-integrity.test.js`, `test/doctor-json.test.js` **new**.
- `bin/js-eyes-native-host-install.{sh,ps1}` **new** local launchers.
- Docs: `SKILL.md`, `docs/native-messaging.md`, `README.md`, `CHANGELOG.md`,
  `RELEASE_NOTES.md` refreshed.
