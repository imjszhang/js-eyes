# JS Eyes Release SOP

Last updated: 2026-04-17

## 2.3.0 Migration Guide (Policy Engine)

JS Eyes 2.3.0 adds a non-interactive security policy engine in front of the browser automation sinks. **No breaking changes by default** — `security.enforcement` ships as `soft`, which means violating calls are audited and routed to plan-only / pending-egress records instead of being rejected.

### Default behavior

- `js-eyes server start` creates `~/.js-eyes/runtime/pending-egress/` (POSIX `0600`). No manual setup required.
- All tool calls keep working. The engine observes, emits audit events, and writes pending-egress records when an `openUrl` target is outside the task scope.
- `js-eyes doctor` gains a `Policy engine (2.3)` section; review it to see the current enforcement level, pending backlog, and skills whose `runtime.platforms` is `['*']`.

### Enabling strict protection

Once you've verified that no legitimate calls are being flagged (use `js-eyes doctor` and `js-eyes egress list` to audit):

```bash
js-eyes security enforce strict
```

At this level:
- `openUrl` to a host outside the task scope returns `{ status: 'pending-egress' }` without executing; operators approve via `js-eyes egress approve <id>` or permanently via `js-eyes egress allow <domain>`.
- `getCookies`, `getCookiesByDomain`, `executeScript`, `injectCss`, and `uploadFileToTab` are hard-rejected when the target domain / tab origin is outside the task scope.
- Cookie-canary taint hits hard-reject the sink.

### Falling back

```bash
# Audit only: rule engine never blocks (for troubleshooting).
js-eyes security enforce off

# Default: plan-only + audit (2.3.0 default).
js-eyes security enforce soft
```

`JS_EYES_POLICY_ENFORCEMENT=off|soft|strict` also overrides at process start.

### Skill author notes

- `skill.contract.runtime.platforms` is now reused as the skill's declared task origin allowlist. Declaring explicit hosts (e.g., `['github.com', 'api.github.com']`) lets the skill opt into strict scope enforcement automatically.
- `['*']` or an empty array continues to mean "no declared scope"; the engine falls back to user-message / active-tab origins.
- No contract schema change is required for 2.3.0 — existing contracts keep working.

### Operator Commands

```bash
js-eyes egress list                 # show pending egress plans
js-eyes egress approve <id>         # allow this destination for the current session
js-eyes egress allow <domain>       # add a host to security.egressAllowlist permanently
js-eyes egress clear                # drop all pending egress records
js-eyes security show               # print the resolved policy
js-eyes security enforce <level>    # off / soft / strict
```

### Audit Fields

`logs/audit.log` now includes `task_origin`, `taint_hit`, `egress_matched`, `rule_decision`, `enforcement`, `rule`, `reasons`, and `pendingId` on policy-related events (`policy.*`, `automation.soft-block`, `automation.pending-egress`).

## 2.2.0 Migration Guide (Security Hardening)

JS Eyes 2.2.0 introduces mandatory security defaults. Follow this checklist when upgrading an existing 2.1.x install.

### Server

1. `js-eyes server token init` generates `runtime/server.token` (POSIX `0600`, Windows `icacls`). Re-run on every host after upgrade.
2. Existing `~/.js-eyes/config/config.json` is migrated in place. Review the new `security` block:
   - `allowAnonymous: false` by default. Set to `true` **only** for clients that cannot yet send a token (for example, older DeepSeek Cowork builds). A warning is logged on every anonymous connection.
   - `allowRawEval: false` by default. Set to `true` only when a skill legitimately needs arbitrary JS eval; the extension refuses `execute_script` payloads otherwise.
   - `requireLockfile: true` by default. Keep this unless installing a skill that intentionally ships without `package-lock.json`.
3. The server refuses to bind to a non-loopback host unless `security.allowRemoteHost=true`.
4. `Access-Control-Allow-Origin: *` is replaced by an allowlist. Update `security.allowedOrigins` for any custom client UI (the defaults cover the bundled extensions and `http://localhost:18080`).

### Clients

- **CLI / OpenClaw plugin:** read the token from `runtime/server.token` automatically. No code changes required unless you override the config path.
- **Browser extensions:** open the extension popup, paste the `server.token` contents into the new "Server Token (2.2.0+)" field, and save. The background service worker forwards the token via `Sec-WebSocket-Protocol: bearer.<token>` and as `?token=<token>` on the WebSocket URL.
- **Custom WebSocket clients:** include the token in either the `Sec-WebSocket-Protocol` subprotocol list (`bearer.<token>, js-eyes`) or as a loopback-only `?token=<token>` query parameter. Remote clients **must** use the header form.

### Skills

- All skills are left **disabled** after upgrade. Re-enable only the ones you trust with `js-eyes skills enable <id>`.
- Skill registry entries must carry `sha256` and `size`. Re-run `npm run build:site` to regenerate `docs/skills.json` and the per-skill `.sha256` sidecars.
- New workflow:
  - `js-eyes skills install <id> --plan` downloads and stages the bundle, writing a plan file under `runtime/pending-skills/`.
  - `js-eyes skills approve <id>` applies the staged plan, runs `npm ci --ignore-scripts`, and writes `.integrity.json`.
  - `js-eyes skills verify [id]` re-validates file hashes against `.integrity.json`.
- OpenClaw's `js_eyes_install_skill` tool only produces plans; approval still requires the CLI.

### Operator Maintenance

- `js-eyes doctor` now surfaces: `allowAnonymous`, host binding, file permissions on `config.json` / `server.token` / `audit.log`, skill integrity, and whether the configured registry URL is a known value.
- `js-eyes audit tail` streams JSONL events from `logs/audit.log` (connection, skill install, config change, sensitive tool invocation). Redirect to long-term storage if you need retention beyond rotation.
- `js-eyes consent list` / `consent approve <id>` / `consent deny <id>` manage the consent queue under `runtime/pending-consents/`.

### Backward Compatibility Toggle

If you must keep anonymous clients working during a transition window:

```bash
# As a last resort: accept unauthenticated WS/HTTP clients.
js-eyes config set security.allowAnonymous true
```

Every anonymous request is logged to `audit.log` and reported by `js-eyes doctor`. Plan to remove the toggle before the 2.3.0 release.

## Scope

## Release Scope

This checklist is for shipping a formal `vX.Y.Z` release from `develop` to `main`, including:

- npm CLI package (`apps/cli`)
- GitHub Release assets (`dist/`)
- Firefox signed `.xpi`
- Firefox AMO public submission

## Prerequisites

- Clean or intentionally prepared git worktree on `develop`
- `npm install` completed in the repository root
- `gh auth status` works
- `npm whoami` works for the npm account that owns `js-eyes`
- `.env` or shell environment contains:
  - `npm_key` (preferred npm publish token)
  - `AMO_API_KEY`
  - `AMO_API_SECRET`
- Firefox signing binary is available through the repo install:
  - `node_modules/.bin/web-ext`

## 1. Freeze The Release Candidate On `develop`

Run and confirm all of the following on `develop`:

```bash
npm test
npm run build:site
npm run build:chrome
npm run build:firefox
```

Then review:

- `CHANGELOG.md`
- `RELEASE_NOTES.md`
- `README.md`
- `docs/README_CN.md`
- `docs/skills.json`
- `dist/js-eyes-chrome-vX.Y.Z.zip`
- `dist/js-eyes-firefox-vX.Y.Z.xpi`
- `dist/js-eyes-skill-vX.Y.Z.zip`

Commit the release candidate on `develop` and push it.

## 2. Merge `develop` Into `main`

Recommended flow:

1. Push the finished `develop` branch
2. Open a PR from `develop` to `main`
3. Review and merge
4. Update local `main` and verify it matches the merged head

If you must merge locally, do it from a clean `main` and avoid tagging from `develop`.

## 3. Publish The npm CLI

The public CLI package is `apps/cli` with package name `js-eyes`.

Publish from `main`:

```bash
set -a
source ".env"
set +a

tmp="$(mktemp)"
printf '%s\n' \
  "//registry.npmjs.org/:_authToken=${npm_key}" \
  "registry=https://registry.npmjs.org/" \
  > "$tmp"

npm publish --workspace apps/cli --access public --userconfig "$tmp"
rm -f "$tmp"
```

Notes:

- Prefer publishing with the npm token from `.env` to avoid interactive OTP prompts.
- The repository currently stores the npm publish token under `npm_key`.
- If `.env` is unavailable, you can export the same value in the shell before publishing.
- Only fall back to interactive `npm publish ... --otp <code>` when token-based publish is not available for the npm account.

Verify:

```bash
npm view js-eyes version
```

## 4. Build Release Assets On `main`

Run:

```bash
npm test
npm run build
```

Expected assets:

- `dist/js-eyes-chrome-vX.Y.Z.zip`
- `dist/js-eyes-firefox-vX.Y.Z.xpi`
- `dist/js-eyes-skill-vX.Y.Z.zip`
- `docs/js-eyes-skill.zip`

## 5. Create The GitHub Release

Option A: use the maintainer helper:

```bash
npm run release
```

Option B: use `gh` directly when you want custom notes:

```bash
gh release create vX.Y.Z \
  dist/js-eyes-chrome-vX.Y.Z.zip \
  dist/js-eyes-firefox-vX.Y.Z.xpi \
  dist/js-eyes-skill-vX.Y.Z.zip \
  --title "JS Eyes vX.Y.Z" \
  --notes-file RELEASE_NOTES.md
```

After publishing, verify:

- GitHub Release page opens correctly
- All three assets download successfully
- `https://js-eyes.com` points to the expected latest files

## 6. Firefox Dual-Track Release

### GitHub Distribution

`npm run build:firefox` signs an unlisted Firefox package through `web-ext sign --channel=unlisted` and copies the final file to:

- `dist/js-eyes-firefox-vX.Y.Z.xpi`

Attach that file to GitHub Release for direct download and site distribution.

### AMO Public Listing

The repository does not automate AMO public submission. Use the Mozilla Developer Hub manually:

1. Sign in to AMO Developer Hub
2. Open the JS Eyes add-on listing
3. Upload the same release version package
4. Fill in version notes and any required review answers
5. Submit for review
6. After approval, verify the public listing shows the new version

Keep the GitHub Release and AMO version numbers identical.

## 7. Post-Release Checks

- `git tag` includes `vX.Y.Z`
- GitHub Release is public and complete
- `npm view js-eyes version` shows `X.Y.Z`
- Firefox signed `.xpi` is downloadable from GitHub Release
- AMO submission is either live or clearly tracked as pending review
- README / docs links still resolve
