# Skill Runtime V2

Status: implemented (V1 activation removed).

## Architecture

Skill discovery reads `package.json` and `skill.manifest.json` only. It never
executes the entry module. The manifest declares compatibility, requirements,
capabilities, tools, input schemas, and risk levels. Activation happens later
through the host-owned `@js-eyes/skill-runtime`.

The same host-neutral `SkillHostService` is used independently by the CLI,
MCP, and the optional OpenClaw plugin:

```text
OpenClaw / CLI / MCP
        |
  SkillHostService
        |
  SkillRegistry (registry.js + registry/*) -- static manifest + trust
        |
  SkillRuntime -- config, browser, storage, logging, cancellation
        |
 in-process entry or runtime-owned Worker IPC
```

`packages/skill-runtime/registry.js` is the public orchestration entry
(`createSkillRegistry`, `purgeRequireCacheFor`). Cohesive helpers live under
`packages/skill-runtime/registry/`: `discover.js` (static scan / fingerprint /
require-cache purge), `trust-gate.js` (integrity and external approval),
`activate-v2.js` (V2 activation), and `reload.js` (fingerprint compare, dispose,
binding replace).

Each invocation receives an immutable context containing its id, source,
deadline, `AbortSignal`, logger, read-only config, scoped storage paths, and a
capability-gated browser proxy. The host owns the physical browser connection
and disposes resources in reverse registration order.

## External skills

`extraSkillDirs` accepts a single Skill directory or a parent directory. V2
approval is bound to the real path, manifest digest, a recursive digest of the
Skill source and installed dependencies, declared capabilities, and execution
mode. Any source, dependency, manifest, capability, path, or execution-mode
change invalidates that approval and requires review again.

Policies are:

- `prompt`: an external V2 Skill must be explicitly trusted (default).
- `strict`: requires V2 plus explicit trust.

`externalSkills.policy=legacy` is no longer accepted. Config normalization and
the registry remap it to `prompt` with a warning.

Use `js-eyes skills inspect`, `permissions`, `trust`, and `revoke`. Worker mode
uses an allowlisted environment and brokers browser operations through the host.
It is a crash/stability boundary, not an operating-system security sandbox.
Browser permissions are checked twice: the Skill-level grant is intersected
with the invoked tool's declared capabilities, including across Worker IPC.
Direct filesystem, process, and network access by JavaScript cannot be fully
contained without an OS sandbox; those declarations remain approval metadata
and policy inputs, and Worker mode must not be described as a security sandbox.

Tool input is validated against the manifest JSON Schema before its handler is
entered. Risk and capability grants are intersected by the host surface: MCP
`safe` accepts only approved read capabilities, while OpenClaw requires
explicit, one-shot consent for
`destructive` and `administrative` tools unless policy explicitly allows them.
Invocation deadlines reject the host call even if a handler ignores its
`AbortSignal`; disposal aborts and briefly drains active calls before releasing
the Worker, browser connection, and registered resources.

## Reload and host surfaces

The watcher fingerprints all relevant source files below a Skill root, purges
its module cache, disposes the old runtime, and atomically replaces bindings.
Host-config changes also recompute linked extra source paths, so adding or
removing `extraSkillDirs` updates both discovery and the live watcher.
CLI uses `js-eyes skill call <id> <tool> --args <json>`. MCP exposes
`skill_list`, `skill_describe`, and `skill_call`. Both route through the same
registry and runtime as OpenClaw.

OpenClaw configuration discovery, legacy `openclaw.json` migration, consent,
tool routing, and watcher lifecycle are owned by `openclaw-plugin/`. Core
packages do not read OpenClaw configuration or import the plugin. Official
Skills use native V2 activation only (`TOOL_DEFINITIONS` is the tool SSOT;
`skill.manifest.json` is generated from it).

## V1 removed (2.9.x, still 2.x)

V1 `skill.contract.js` / `createOpenClawAdapter` activation is **removed** in
the 2.9 platform line without a major-version bump. `externalSkills.policy=legacy`
is normalized to `prompt` with a warning. Skills must use
`skill.manifest.json` + `skill.entry.js`. See `examples/js-eyes-skills/` for
the V2 template.
