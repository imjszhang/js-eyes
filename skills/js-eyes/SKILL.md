---
name: js-eyes
description: Parent skill marker for JS Eyes browser automation and extension skill dependencies.
version: 2.0.0
metadata: {"openclaw":{"emoji":"\U0001F441","homepage":"https://github.com/imjszhang/js-eyes","os":["darwin","linux","win32"],"requires":{"bins":["node"]}}}
---

# JS Eyes

This compatibility skill exists so OpenClaw can resolve `js-eyes` as the parent skill required by JS Eyes extension skills.

The actual JS Eyes bundle root is the directory that contains this `skills/` folder. The OpenClaw plugin path to register is `<bundle-root>/openclaw-plugin`.

Use this skill when:

- Verifying that the main JS Eyes plugin is installed for extension skills.
- Locating the main OpenClaw plugin path for JS Eyes.
- Troubleshooting missing `js_eyes_*` tools after installing JS Eyes extensions.

This directory is intentionally documentation-only. The runnable OpenClaw plugin lives in the main bundle's `openclaw-plugin` directory, and JS Eyes extension skills with executable adapters live alongside this folder under `skills/`.
