# Repository Guidance for Coding Agents

## Project purpose

JS Eyes is a local-first browser capability and site-skill runtime for AI
agents. The browser extension, server, SDK, CLI, MCP facade, and optional host
adapters are separate layers over the same protocol and policy model.

CLI, MCP, and OpenClaw are peer host surfaces. Do not make a host-specific
adapter the owner of behavior that belongs in the host-neutral runtime.

## Repository map

- `apps/cli` contains the public `js-eyes` command.
- `apps/native-host` contains the browser Native Messaging host.
- `packages/protocol` owns shared protocol constants, browser-operation
  metadata/handlers, and browser-operation catalogs. Install helpers live in
  `@js-eyes/skill-install` (not under `protocol`).
- `packages/skill-install` owns skill discovery, install, trust, ZIP/npm, and
  registry helpers (formerly under `protocol`).
- `packages/policy` owns `PolicyContext` and related egress/taint/task-origin
  policy primitives used by server-core and the client SDK.
- `packages/client-sdk` owns the Node.js browser client (may re-export selected
  policy symbols from its main entry; prefer `@js-eyes/policy` directly).
- `packages/server-core` owns the local HTTP and WebSocket server.
- `packages/mcp-server` is the native stdio MCP facade.
- `packages/skill-contract` validates Skill metadata; `packages/skill-runtime`
  owns host-neutral Skill Runtime V2, including isolated worker execution.
- `openclaw-plugin` (`@js-eyes/openclaw-plugin`) is an optional OpenClaw
  adapter workspace. Core packages must not import it.
- `extensions/shared` is the canonical source for cross-browser extension
  behavior. Chrome and Firefox copies are generated from it.
- `skills/*` are independently versioned site skills.
- `packages/devtools` owns builds, release staging, and generated artifacts.
- `distribution` contains source templates for distributable artifacts.
- `src` contains the public website source.
- `dist` contains generated output and must not be edited by hand.

## Architecture boundaries

Preserve these dependency directions:

```text
browser extension
        |
  server-core
        |
   client-sdk
        |
host-neutral runtime
        |
CLI / MCP / optional OpenClaw adapter
```

- Keep host discovery, trust, invocation, configuration, cancellation, and
  disposal in the host-neutral Skill Runtime.
- Keep OpenClaw configuration migration, registration, consent presentation,
  and watcher integration inside `openclaw-plugin`.
- Skill discovery must inspect static metadata only. Never execute a skill
  entry module during discovery.
- A V2 skill must declare its tools, schemas, risks, and capabilities in
  `skill.manifest.json`.
- Browser permissions granted to a skill must be intersected with the
  capabilities declared by the invoked tool.
- Prefer first-class protocol operations over implementing ordinary browser
  actions through arbitrary JavaScript.
- Avoid adding compatibility aliases silently. If compatibility is necessary,
  document its lifetime and test it explicitly.

## Browser extension changes

- Edit shared cross-browser behavior in `extensions/shared` first.
- Do not independently patch injected Chrome and Firefox runtime copies.
- After shared changes, prepare staging with `npm run sync:extension-shared`
  (writes `dist/extensions-stage/{chrome,firefox}`); builders inject shared
  the same way. Load unpacked extensions from the staged directories.
- Keep Chrome MV3 and Firefox MV2 loading differences in their platform entry
  modules.
- Treat authentication, request validation, deduplication, rate limiting,
  reconnection, uploads, screenshots, and sender validation as security- or
  reliability-sensitive behavior.

## Skill changes

- Each directory under `skills/` is an independent package with its own
  version and compatibility range.
- Keep `skill.manifest.json`, `skill.entry.js`, `skill.definition.js`,
  `package.json`, and `SKILL.md` consistent for official V2 Skills. Treat
  `skill.contract.js` is no longer activated by the runtime (V1 removed).
- New tools must have a stable name, JSON Schema input, risk classification,
  and the minimum capabilities required.
- `read`, `interactive`, `destructive`, and `administrative` are meaningful
  policy inputs; do not downgrade a risk to make a tool easier to expose.
- Prefer structured, site-semantic operations over exposing low-level page
  scripts to callers.
- Document login requirements and unavailable or experimental commands
  accurately.
- Do not assume Worker execution is an operating-system sandbox. Direct
  filesystem, process, and network access remain trust decisions.

## Security invariants

- Never print or persist authentication tokens, cookie values, script bodies,
  CSS payloads, uploaded file contents, full HTML, or screenshot base64 in
  ordinary logs or error summaries.
- Keep the default MCP profile safe. Sensitive tools must remain absent from
  discovery unless the operator explicitly selects a broader profile.
- Preserve loopback binding, origin validation, token authentication, audit
  logging, task-origin tracking, taint checks, and egress policy unless the
  change explicitly targets one of those controls.
- Do not weaken a safe default as an incidental fix.
- Installation inputs are untrusted. Preserve digest verification, immutable
  release URLs, safe ZIP extraction, lockfile checks, ignored lifecycle
  scripts, trust binding, and plan/approve flows.
- Native Messaging is designed to protect against external web-page attacks;
  local device compromise is outside its threat model. Do not broaden that
  claim.

## Versions and generated artifacts

- The root package, applications, core runtime packages, browser extensions,
  and OpenClaw plugin use the coordinated platform version.
- Site skills under `skills/*` use independent versions.
- `@js-eyes/visual-bridge-kit` and
  `@js-eyes/visual-replay-hyperframes` are skill-optional libraries with
  independent versions; they are not platform runtime dependencies.
- `openclaw-plugin` (`@js-eyes/openclaw-plugin`) is an optional host adapter
  in the workspace; core packages must not import it.
- The distributable parent Skill is built from
  `distribution/js-eyes-skill/SKILL.template.md`; its version is injected from
  the root `package.json`.
- Publish the staged main Skill from `dist/skill-bundle/js-eyes`, never from
  the monorepo root.
- Do not edit generated extension copies, registries, archives, checksums, or
  files under `dist` manually.

## Editing discipline

- Preserve unrelated user changes in a dirty worktree.
- Use focused edits and keep public exports, error codes, output shapes, and
  exit codes stable unless the requested change intentionally breaks them.
- Prefer extracting and forwarding before rewriting behavior across a module
  boundary.
- Keep CommonJS in packages that currently use CommonJS and ESM in
  `openclaw-plugin` unless a deliberate migration is in scope.
- Do not add a runtime dependency when an existing package or platform API
  already provides the required behavior.
- Update nearby tests and user-facing documentation with behavior changes.

## Validation

Use the smallest relevant checks while iterating, then run the broader gate
appropriate to the change.

### Documentation only

- Check repository links and renamed paths.
- Search for stale action names, versions, and removed files.

### Skill contract or implementation

- Run the changed skill's workspace tests.
- Run manifest generation/checks when the manifest or public tools change.
- Run root contract and Skill Runtime tests when discovery or invocation
  behavior changes.

### Runtime, CLI, MCP, or OpenClaw

- Run focused workspace tests for affected packages.
- Run `npm run test:root`.
- Run `npm run typecheck`.
- Run `npm run lint`.

### Browser extension

- Run `npm run check:extension-shared`.
- Run `npm run test:extension`.
- Build Chrome and the unsigned Firefox development extension.

### Build, packaging, or release

- Run the affected build command.
- Run `npm run package:smoke`.
- Run `npm run release:verify` for coordinated release changes.
- Confirm generated archives contain the intended files and no source
  placeholders.

The complete contribution gate is documented in `CONTRIBUTING.md`.

## Release safety

- Normal builds are unsigned.
- Signing credentials and publishing tokens must only be consumed by protected
  release workflows and must never appear in logs.
- Real npm, GitHub, ClawHub, AMO, Cloudflare, or other external publication
  requires explicit release intent.
- Dependency-only changes must still pass the affected build and audit gates.

## Documentation roles

- `README.md` explains the product and normal installation paths.
- `docs/architecture` records accepted architecture and boundaries.
- `SECURITY.md` is authoritative for the runtime threat model.
- `CONTRIBUTING.md` is authoritative for contributor workflow.
- This `AGENTS.md` is authoritative for coding-agent repository guidance.
- The generated parent `SKILL.md` is an install, operation, and troubleshooting
  guide for consumers of the distributable JS Eyes Skill bundle; it is not a
  repository development guide.
