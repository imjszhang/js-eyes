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

Cross-browser background configuration, stability helpers, and shared
`BrowserControl` methods live in `extensions/shared`. After editing them, run
`npm run sync:extension-shared`; CI and both extension builders reject stale
Chrome/Firefox runtime copies.

## Dependency changes

- Prefer upgrading a direct dependency over adding an override.
- Keep production and development dependency risk separate when evaluating advisories.
- Explain any override in the pull request and verify the affected tool directly.
- The `firefox-profile > adm-zip` override is temporary: the latest `firefox-profile` still restricts `adm-zip` to the vulnerable 0.5 line. Remove the override once upstream accepts `adm-zip` 0.6 or newer.
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
