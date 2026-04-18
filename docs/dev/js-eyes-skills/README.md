# JS Eyes Skills

> 本文档面向**想扩展 JS Eyes 能力**的开发者。
> 用户向安装/使用文档见 [根 README](../../../README.md)、[docs/README_CN.md](../../README_CN.md)。

## 什么是 JS Eyes Skills

**JS Eyes Skills** 是本仓库定义的一类扩展技能：

- 每个技能 = 一个目录 + 一份 [`skill.contract.js`](contract.zh.md) 契约入口。
- 由主插件 [`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) 在启动时扫描 `skillsDir`、调用 `contract.createOpenClawAdapter()`，把 `tools[]` 注册到 OpenClaw。
- 运行时借助 `BrowserAutomation`（WebSocket 客户端）驱动 JS Eyes 扩展，在浏览器中完成自动化。

## 命名澄清

本项目里同时存在多处 `skill` 字眼，含义各不相同。本节为**权威对照表**，所有 dev 文档都以此为准：

| 字符串 / 路径 | 实际指代 | 归类 |
|--------------|---------|------|
| `skills/`（仓库根子目录） | JS Eyes Skills 默认安装目录 | 代码层（不改名） |
| `skillsDir`（`openclaw-plugin` 配置项） | JS Eyes Skills 安装根（可指向仓库外） | 代码层（不改名） |
| `skill.contract.js` | JS Eyes Skills 契约入口（必需） | 代码层（不改名） |
| `js-eyes skills <cmd>` CLI | JS Eyes Skills 管理命令（install / enable / approve / verify） | 代码层（不改名） |
| `@js-eyes/skill-recording` npm 包 | JS Eyes Skills 运行录制底座 | 代码层（不改名） |
| `SKILLS_REGISTRY_URL`、`skills.json` | JS Eyes Skills 官方注册表 | 代码层（不改名） |
| 根目录 [`SKILL.md`](../../../SKILL.md) | **OpenClaw Skill**（运维手册，**不是** JS Eyes Skills 规范） | OpenClaw 生态 |
| `docs/dev/js-eyes-skills/` | 本仓库 JS Eyes Skills 的开发者文档 | 文档层（新增） |
| `examples/js-eyes-skills/` | 本仓库 JS Eyes Skills 的可运行样例 | 文档层（新增） |
| `docs/dev/skills/`、`examples/skills/` | 为未来兼容**外部通用 Skills** 预留的命名空间 | 文档层（新增） |
| 业界的 "Skills"（Anthropic Agent Skills / Cursor Skills / Claude Code Skills） | 外部通用 skill 生态，与本仓库契约不同 | 外部生态 |

> 简记：**首字母大写、空格分隔的 "JS Eyes Skills" 专指本仓库契约下的扩展技能；其他 "skill" 字眼看语境**。

## 章节索引

1. **[开发指南（authoring.zh.md）](authoring.zh.md)** — 从零建一个 `js-hello-ops-skill`：目录布局、最小契约、对接 `BrowserAutomation`、加 CLI、启用与调试。
2. **[契约规范（contract.zh.md）](contract.zh.md)** — `skill.contract.js` 顶层字段、`TOOL_DEFINITIONS` schema、`execute` 返回形态、敏感工具与 consent、`.integrity.json` 与完整性校验。
3. **[部署与启用（deployment.zh.md）](deployment.zh.md)** — 三种部署模式（仓库内 / 外部 `skillsDir` / ClawHub 注册表），`js-eyes skills enable <id>` 流程，配置优先级。

## 可运行样例

| 样例 | 难度 | 覆盖特性 |
|------|------|---------|
| [`js-hello-ops-skill`](../../../examples/js-eyes-skills/js-hello-ops-skill/) | ⭐ | 单工具、零副作用、无录制依赖 |
| 更多进阶样例 | — | 规划中（多工具、录制、consent、GraphQL fallback） |

拷贝样例、改名字、`npm install`，然后按 [部署与启用](deployment.zh.md) 把 `skillsDir` 指过去即可。

## 相关文件引用（便于跳转阅读源码）

- 主插件发现与注册：[`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs)
- 契约加载与完整性校验：[`packages/protocol/skills.js`](../../../packages/protocol/skills.js)
- 现有契约实现参考：[`skills/js-x-ops-skill/skill.contract.js`](../../../skills/js-x-ops-skill/skill.contract.js)、[`skills/js-browser-ops-skill/skill.contract.js`](../../../skills/js-browser-ops-skill/skill.contract.js)
- CLI：[`apps/cli/src/cli.js`](../../../apps/cli/src/cli.js)（`js-eyes skills ...` 子命令）

---

Last updated: 2026-04-18
