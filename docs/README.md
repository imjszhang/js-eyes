# JS Eyes Documentation

This directory holds **developer and operator markdown** that ships with the
repository. It is **not** the GitHub Pages site root.

## Layout

| Path | Purpose |
|------|---------|
| [`README_CN.md`](./README_CN.md) | Chinese overview (links back to root [`README.md`](../README.md)) |
| [`native-messaging.md`](./native-messaging.md) | Native Messaging host install + token sync |
| [`dev/js-eyes-skills/`](./dev/js-eyes-skills/) | JS Eyes Skills authoring, contract, deployment guides |
| [`dev/skills/`](./dev/skills/) | Reserved namespace for future generic Skills compatibility notes |

## Site & registry artifacts (built, not committed here)

Since **2.8.3**, the public site is built from [`src/`](../src/) into
[`dist/`](../dist/):

```bash
npm run build:site   # src/ + skill zips + skills.json → dist/
npm run preview      # serve dist/ locally on :3000
```

Production deploy: GitHub Actions workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on push to
`main`.

| Artifact | Built path | Production URL |
|----------|------------|----------------|
| Landing page | `dist/index.html` | https://js-eyes.com |
| Skill registry | `dist/skills.json` | https://js-eyes.com/skills.json |
| Install scripts | `dist/install.sh`, `dist/install.ps1` | same host |
| Skill zips | `dist/skills/<id>/` | https://js-eyes.com/skills/… |

Do not edit `dist/` by hand — regenerate with `npm run build:site`.
