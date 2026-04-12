# JS Eyes Release SOP

Last updated: 2026-04-12 19:38:34 +0800

## Scope

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
npm publish --workspace apps/cli --access public
```

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
