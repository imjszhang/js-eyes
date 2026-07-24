# Skill Runtime V2

Status: implemented with V1 compatibility.

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
  SkillRegistry -- static manifest + trust + compatibility
        |
  SkillRuntime -- config, browser, storage, logging, cancellation
        |
 in-process entry or Worker IPC
```

Each invocation receives an immutable context containing its id, source,
deadline, `AbortSignal`, logger, read-only config, scoped storage paths, and a
capability-gated browser proxy. The host owns the physical browser connection
and disposes resources in reverse registration order. V1 `skill.contract.js`
remains supported by the normalizer during migration.

## External skills

`extraSkillDirs` accepts a single Skill directory or a parent directory. V2
approval is bound to the real path, manifest digest, a recursive digest of the
Skill source and installed dependencies, declared capabilities, and execution
mode. Any source, dependency, manifest, capability, path, or execution-mode
change invalidates that approval and requires review again.

Policies are:

- `legacy`: compatibility mode; external Skills may run in-process.
- `prompt`: an external V2 Skill must be explicitly trusted.
- `strict`: requires V2 plus explicit trust.

Use `js-eyes skills inspect`, `permissions`, `trust`, and `revoke`. Worker mode
uses an allowlisted environment and brokers browser operations through the host.
It is a crash/stability boundary, not an operating-system security sandbox.
Browser permissions are checked twice: the Skill-level grant is intersected
with the invoked tool's declared capabilities, including across Worker IPC.
Direct filesystem, process, and network access by JavaScript cannot be fully
contained without an OS sandbox; those declarations remain approval metadata
and policy inputs, and Worker mode must not be described as a security sandbox.

Tool input is validated against the manifest JSON Schema before its handler is
entered. Risk is enforced by the host surface: MCP `safe` accepts only `read`
Skill tools, while OpenClaw requires explicit, one-shot consent for
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
packages do not read OpenClaw configuration or import the plugin. The V1
`createOpenClawAdapter` name remains only as a legacy Skill-contract
compatibility shim; V2 activation is host-neutral.
