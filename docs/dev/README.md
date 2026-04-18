# JS Eyes — Developer Docs

> Last updated: 2026-04-19
>
> 用户向文档见 [../README_CN.md](../README_CN.md) / [根 README](../../README.md)。
> 本目录（`docs/dev/`）面向**想扩展 / 对接 JS Eyes 的开发者**。

## JS Eyes Skills（扩展技能体系）

遵循本仓库 `skill.contract.js` 契约、由主插件自动发现并注册到 OpenClaw 的扩展技能。

- [什么是 JS Eyes Skills](js-eyes-skills/README.md) — 概念、生命周期、命名澄清
- [开发指南（中文）](js-eyes-skills/authoring.zh.md) — 从零写一个自定义技能
- [skill.contract.js 契约规范（中文）](js-eyes-skills/contract.zh.md) — 顶层字段、工具 schema、完整性校验
- [部署与启用（中文）](js-eyes-skills/deployment.zh.md) — 三种部署模式 + `js-eyes skills enable` 流程
- 可运行样例：[`examples/js-eyes-skills/`](../../examples/js-eyes-skills/)

## Skills 通用兼容（Roadmap）

探索对外部通用 Skills 规范（Anthropic Agent Skills / Cursor Skills / Claude Code Skills 等）的兼容层，当前为预留目录。

- [Roadmap 与讨论](skills/README.md)

## 其他专题

- [Native Messaging](../native-messaging.md) — 浏览器扩展自动同步 token 的机制
- [安全模型](../../SECURITY.md) — token、consent、`.integrity.json`、`security.toolPolicies`
- [根 SKILL.md](../../SKILL.md) — 面向 OpenClaw 的安装 / 运维手册（注意：这是 OpenClaw Skill 规范，**不是** JS Eyes Skills 规范）

## 维护者流程

- [Release SOP](../../RELEASE.md) — 从 `develop` 切到 `main` 的完整清单
- [发布 `@js-eyes/*` 运行时包](../../RELEASE.md#25-publish-js-eyes-workspace-packages-first-time-or-version-bump) — `npm run publish:workspaces` 逐包拓扑发布（幂等，已发版本会跳过）
