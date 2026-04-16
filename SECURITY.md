# Security and Network Behavior

## Overview

JS Eyes is a **local-first** browser automation stack. Its normal runtime loop talks only to the JS Eyes server you configure, which defaults to `localhost:18080`.

There are two deployment shapes to keep in mind:

- **ClawHub / bundle deployment:** install the JS Eyes bundle, run `npm install` in the bundle root, register `openclaw-plugin`, and allow the plugin tools in OpenClaw.
- **Source-repo / development deployment:** clone this repository, run `npm install` in the repo root, point OpenClaw at the repo-root `openclaw-plugin`, and optionally load the unpacked browser extension directly from `extensions/chrome/` or `extensions/firefox/`.

Those two modes share the same local runtime behavior, but the source repository also contains release tooling, docs, site assets, and extension source files that reference public URLs for packaging and documentation workflows.

## Complete OpenClaw Deployment Notes

A complete local OpenClaw deployment needs all of the following:

- `plugins.load.paths` points to the bundle or repo-root `openclaw-plugin` directory.
- `plugins.entries["js-eyes"].enabled` is `true`.
- `tools.alsoAllow: ["js-eyes"]` or an equivalent `tools.allow` entry is present, because `js-eyes` registers optional plugin tools.
- The browser extension is configured to connect to the chosen `serverHost` / `serverPort`.

Without the tool allowlist step, the plugin can load successfully while `js_eyes_*` tools still remain unavailable to the model.

## Runtime Network Behavior

Base runtime behavior:

- **OpenClaw plugin:** connects via WebSocket to `ws://serverHost:serverPort` and uses HTTP only for JS Eyes server endpoints such as `/api/browser/status` and `/api/browser/tabs`.
- **Client SDK and browser extension:** connect only to the JS Eyes server URL you configure.
- **Server:** listens on a single HTTP+WebSocket port and does not need outbound internet access for the core browser automation loop.

By default this is all local traffic. No browser content is sent to a third-party service unless you explicitly point JS Eyes at a remote server you control.

## Explicitly User-Initiated Network Access

Some features intentionally access external URLs, but only when the user or agent explicitly chooses those workflows:

- **Extension skill discovery/install:** `js_eyes_discover_skills`, `js_eyes_install_skill`, and the install scripts may fetch the configured registry URL such as `https://js-eyes.com/skills.json`.
- **Release, docs, and packaging workflows in the source repo:** development tooling may reference GitHub Releases, project websites, Cloudflare deployment targets, Mozilla AMO, or similar public endpoints.
- **Browser automation targets:** once connected, JS Eyes can automate whatever websites the user asks it to open; that traffic is the intended workload, not telemetry.

These are different from hidden analytics or call-home behavior. They happen only when the corresponding feature is invoked.

## Why VirusTotal May Flag JS Eyes

Static analysis tools, including VirusTotal Code Insight, often flag projects that:

- use `fetch()` or `WebSocket`
- build URLs dynamically, such as `http://${host}:${port}/api/...`
- expose an API or automation surface
- include installer scripts or release/download URLs in the repository

In JS Eyes, those patterns map to local browser automation, optional skill installation, or developer-facing release workflows. They are not used for silent telemetry or covert outbound control.

## ClawHub Bundle vs Full Repository

The ClawHub-distributed skill bundle is narrower than the full source repository:

- **Included in the bundle:** the runtime pieces needed for JS Eyes skill/plugin behavior.
- **Not shipped in the ClawHub bundle:** browser extension source, most docs, tests, and release/publishing tooling.

That means a scan of the full repository can surface external URLs that are irrelevant to the base ClawHub runtime package.

## If ClawHub Shows a VirusTotal Warning

- **Review the behavior in context:** the most common triggers are the local automation patterns above, not remote-control malware behavior.
- **Report a false positive:** use the [VirusTotal false positive process](https://docs.virustotal.com/docs/false-positive) for the specific vendor(s) that flagged the file.
- **Use manual review when needed:** if you maintain an internal allowlist or review process for OpenClaw/ClawHub skills, JS Eyes is a good candidate for a reviewed exception because its behavior is inspectable and mostly local-first.

## Dependencies

- **Core runtime dependency:** `ws` is required for WebSocket communication.
- **Full development repository:** includes additional packages, build tools, docs, and browser extension assets needed for local development and release workflows.

---

*Last updated: 2026-04-16 — aligned with the 2.1.x JS Eyes/OpenClaw plugin deployment flow.*
