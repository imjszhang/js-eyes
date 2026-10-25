# Contributing to JS Eyes

Thanks for helping improve JS Eyes. This repository is a Node.js monorepo containing the CLI, runtime packages, browser extensions, developer tooling, and platform skills.

## Prerequisites

- Node.js 22 or newer
- The npm version bundled with your Node.js installation
- Git

Use the committed lockfile for reproducible installs:

```bash
npm ci
```

Do not use `npm install` solely to set up an unchanged checkout. Use it only when intentionally changing dependencies, and include the resulting `package-lock.json` update in the same pull request.

## Development commands

Run the complete local quality gate before opening a pull request:

```bash
npm test
npm run lint
npm run typecheck
npm run check:extension-shared
npm run scan:security
npm audit
npm run package:smoke
```

The build commands used by CI are:

```bash
npm run build:site
npm run build:skill
npm run build:chrome
npm run build:firefox:dev
```

Release candidates can be checked locally with `npm run release:verify` and
`npm run release:prepare-packages`. Real publication is intentionally restricted
to the manual `release-publish.yml` workflow and its `release-production`
environment.

Useful focused commands include:

```bash
npm run test:root
npm run test:workspaces
npm run test:server
npm run test:extension
npm run test:client
npm run test:cli
```

Edit cross-browser extension behavior only in `extensions/shared` — never
hand-edit injected runtime files under Chrome/Firefox. Shared modules are
injected into `dist/extensions-stage/{chrome,firefox}` at build/sync time;
platform entry modules (`background.js`, `platform-*`, manifests) stay in
`extensions/chrome` and `extensions/firefox`. After shared changes, run
`npm run sync:extension-shared` (or `npm run build:chrome` /
`npm run build:firefox:dev`) and load the unpacked extension from the staged
directory. CI runs `npm run check:extension-shared` on every PR to validate
the protocol catalog against `extensions/shared/config.js`.

## Adding a site Skill

Official Skills are V2 only. Minimum files under `skills/<id>/`:

1. `package.json` — `name` is the skill id; depend on `@js-eyes/skill-scaffold`
2. `skill.definition.js` — export `TOOL_DEFINITIONS` (each tool has `risk` and
   `capabilities`), plus skill-level `capabilities` / `requirements`
   (thin skills may use `createDefinitionEnvelope`)
3. `skill.entry.js` — `module.exports = createSkillEntry(TOOL_DEFINITIONS)`
4. `skill.manifest.json` — generate with `npm run skills:manifests`
5. `SKILL.md` — operator-facing docs

Do not export `createOpenClawAdapter`. See `examples/js-eyes-skills/` for a
minimal external template and `AGENTS.md` for Skill policy rules.

## Dependency changes

- Prefer upgrading a direct dependency over adding an override.
- Keep production and development dependency risk separate when evaluating advisories.
- Explain any override in the pull request and verify the affected tool directly.
- `web-ext` 10.8 uses `firefox-profile` 4.7.1, which accepts patched `adm-zip` 0.6 releases; the old `adm-zip` override is no longer needed.
- The root overrides keep `brace-expansion`, `fast-uri`, `undici`, and `shell-quote` on patched versions across the workspace and build tools. Keep `undici` on the compatible 7.x line. Recheck these overrides when upgrading their parent dependencies.
- Known upstream limitation (2026-10-25): `web-ext@10.8.0` brings
  `@devicefarmer/adbkit@3.3.9` and `node-forge@1.4.0` into development installs.
  [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
  has no published patched version. npm reports three high-severity entries
  for this one dependency chain. Production-only audit must remain clean;
  full audit still reports this finding. Do not apply npm's suggested downgrade
  to `web-ext@5.1.0` or suppress the advisory. Recheck when upstream ships a fix.

Official X API tests must use `tests/helpers/official-api-env.js` for mocked
requests and proxy environment changes. The helper isolates inherited proxy
settings for the duration of asynchronous work and restores them on success or
failure. Tests should pass with the developer's normal proxy environment.
- A dependency pull request must pass `npm audit`, the full test suite, and all affected builds.

## Pull requests

1. Create a focused branch from the latest `main`.
2. Keep commits scoped and describe why the change is needed.
3. Complete the pull request checklist and call out compatibility or security impact.
4. Resolve review conversations and keep the branch up to date with `main`.
5. Wait for all required checks: `quality`, `test`, `security`, `build`, and `package-smoke`.

Normal direct pushes, force pushes, and deletion of `main` are blocked. Administrators retain an emergency bypass for repository recovery. Approval is not currently required because this is maintained as a personal repository; that policy can be tightened when regular collaborators join.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](./SECURITY.md) to submit a private report.
