---
name: js-eyes
description: Parent skill marker for JS Eyes browser automation and extension skill dependencies.
version: 2.2.0
metadata: {"openclaw":{"emoji":"\U0001F441","homepage":"https://github.com/imjszhang/js-eyes","os":["darwin","linux","win32"],"requires":{"bins":["node"]}}}
---

# JS Eyes

This compatibility skill exists so OpenClaw can resolve `js-eyes` as the parent skill required by JS Eyes extension skills.

The actual JS Eyes bundle root is the directory that contains this `skills/` folder. The OpenClaw plugin path to register is `<bundle-root>/openclaw-plugin`.

A complete OpenClaw deployment also needs `plugins.entries["js-eyes"].enabled = true` and `tools.alsoAllow: ["js-eyes"]` (or an equivalent `tools.allow` entry), because the plugin registers optional tools.

This skill is a marker only. It does not ship runnable supporting files, scripts, reference files, or implementation modules under this directory.

Do not resolve relative implementation paths such as `./lib/...`, `./scripts/...`, or `./references/...` from `skills/js-eyes/`.

Use this skill when:

- Verifying that the main JS Eyes plugin is installed for extension skills.
- Locating the main OpenClaw plugin path for JS Eyes.
- Troubleshooting missing `js_eyes_*` tools after installing JS Eyes extensions.

This directory is intentionally documentation-only.

The runnable OpenClaw plugin lives in the main bundle's `openclaw-plugin` directory.

For source-repo development, `<bundle-root>` is the repository root, and you should run `npm install` there before loading the plugin from `<bundle-root>/openclaw-plugin`.

Executable extension logic lives in concrete child skill directories under `<bundle-root>/skills/<child-skill-id>/`, for example:

- `<bundle-root>/skills/js-browser-ops-skill/`
- `<bundle-root>/skills/js-zhihu-ops-skill/`
- `<bundle-root>/skills/js-x-ops-skill/`
- `<bundle-root>/skills/js-wechat-ops-skill/`
