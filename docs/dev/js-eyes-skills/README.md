# JS Eyes Skills

> 本文档面向**想扩展 JS Eyes 能力**的开发者。
> 用户向安装/使用文档见 [根 README](../../../README.md)、[docs/README_CN.md](../../README_CN.md)。

## 什么是 JS Eyes Skills

**JS Eyes Skills** 是本仓库定义的一类扩展技能：

- 每个技能 = 一个目录 + 一份 [`skill.contract.js`](contract.zh.md) 契约入口。
- 由主插件 [`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) 在启动时扫描 `skillsDir`（primary）以及可选的 `extraSkillDirs`（extras，只读），调用 `contract.createOpenClawAdapter()`，把 `tools[]` 注册到 OpenClaw。
- 运行时借助 `BrowserAutomation`（WebSocket 客户端）驱动 JS Eyes 扩展，在浏览器中完成自动化。

## 命名澄清

本项目里同时存在多处 `skill` 字眼，含义各不相同。本节为**权威对照表**，所有 dev 文档都以此为准：

| 字符串 / 路径 | 实际指代 | 归类 |
|--------------|---------|------|
| `skills/`（仓库根子目录） | JS Eyes Skills 默认安装目录 | 代码层（不改名） |
| `skillsDir`（`openclaw-plugin` 配置项） | JS Eyes Skills 主安装根（primary，可指向仓库外）；`install` / `approve` / `uninstall` / 完整性校验只作用于此处 | 代码层（不改名） |
| `extraSkillDirs`（`openclaw-plugin` 配置项） | 额外只读技能来源列表，条目可为单个技能目录或父目录；同 id 冲突时 primary 优先；extras 不做完整性校验 | 代码层（新增） |
| `skill.contract.js` | JS Eyes Skills 契约入口（必需） | 代码层（不改名） |
| `js-eyes skills <cmd>` CLI | JS Eyes Skills 管理命令（install / enable / approve / verify） | 代码层（不改名） |
| `@js-eyes/skill-recording` npm 包 | JS Eyes Skills 运行录制底座 | 代码层（不改名） |
| `@js-eyes/*`（npm scope） | 对应 [npm 组织 `js-eyes`](https://www.npmjs.com/org/js-eyes)，仅官方运行时包 + 官方 JS Eyes Skills 使用 | npm 层（不改名） |
| `SKILLS_REGISTRY_URL`、`skills.json` | JS Eyes Skills 官方注册表 | 代码层（不改名） |
| 根目录 [`SKILL.md`](../../../SKILL.md) | **OpenClaw Skill**（运维手册，**不是** JS Eyes Skills 规范） | OpenClaw 生态 |
| `docs/dev/js-eyes-skills/` | 本仓库 JS Eyes Skills 的开发者文档 | 文档层（新增） |
| `examples/js-eyes-skills/` | 本仓库 JS Eyes Skills 的可运行样例 | 文档层（新增） |
| `docs/dev/skills/`、`examples/skills/` | 为未来兼容**外部通用 Skills** 预留的命名空间 | 文档层（新增） |
| 业界的 "Skills"（Anthropic Agent Skills / Cursor Skills / Claude Code Skills） | 外部通用 skill 生态，与本仓库契约不同 | 外部生态 |

> 简记：**首字母大写、空格分隔的 "JS Eyes Skills" 专指本仓库契约下的扩展技能；其他 "skill" 字眼看语境**。

## 章节索引

1. **[开发指南（authoring.zh.md）](authoring.zh.md)** — 从零建一个 `js-hello-ops-skill`：目录布局、最小契约、对接 `BrowserAutomation`、加 CLI、启用与调试。
2. **[契约规范（contract.zh.md）](contract.zh.md)** — `skill.contract.js` 顶层字段、`TOOL_DEFINITIONS` schema、`execute` 返回形态、敏感工具与 consent、`.integrity.json` 与完整性校验、`runtime.dispose()` 钩子。
3. **[部署与启用（deployment.zh.md）](deployment.zh.md)** — 四种部署模式（仓库内 / 外部 `skillsDir` / ClawHub 注册表 / primary + `extraSkillDirs` 混合），`js-eyes skills enable <id>` 流程，配置优先级。
4. **[零重启部署（deployment.zh.md §5.3）](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)** — `js-eyes skills link / unlink / reload`、`js_eyes_reload_skills` 工具、`SkillRegistry` + chokidar 的工作原理、边界条件（新 tool name 需要一次重启）。

## 可运行样例

| 样例 | 难度 | 覆盖特性 |
|------|------|---------|
| [`js-hello-ops-skill`](../../../examples/js-eyes-skills/js-hello-ops-skill/) | ⭐ | 单工具、零副作用、无录制依赖 |
| 更多进阶样例 | — | 规划中（多工具、录制、consent、GraphQL fallback） |

拷贝样例、改名字、`npm install`，然后按 [部署与启用](deployment.zh.md) 把 `skillsDir` 指过去，或者用 `extraSkillDirs` 把样例目录挂到默认 `skills/` 之外（[模式 D](deployment.zh.md#5-部署模式-dprimary--extraskilldirs)）。

## npm scope 治理

`@js-eyes/*` 对应 npm 组织 [`js-eyes`](https://www.npmjs.com/org/js-eyes)，**仅**收录官方运行时包和官方 JS Eyes Skills。第三方 JS Eyes Skills 开发者请使用自己的 scope，例如：

- `@acme/js-eyes-skill-shopify-ops`
- `@yourname/js-eyes-skill-mastodon-ops`

第三方 skills 通过向 [`docs/skills.json`](../../skills.json) 提 PR 注册进官方 registry，**不会**被接纳进 `@js-eyes/*` scope。这样可以保证：

1. `@js-eyes/*` 的安全边界清晰——`npm i @js-eyes/...` 拿到的一定是官方代码。
2. 第三方 skill 作者保留自己的发布权与版本节奏，不依赖本仓库 maintainer。
3. `js-eyes skills install <id>` 的 registry 机制与 scope 归属互相解耦。

## 相关文件引用（便于跳转阅读源码）

- 主插件发现与注册：[`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs)
- 契约加载与完整性校验：[`packages/protocol/skills.js`](../../../packages/protocol/skills.js)
- 现有契约实现参考：[`skills/js-x-ops-skill/skill.contract.js`](../../../skills/js-x-ops-skill/skill.contract.js)、[`skills/js-browser-ops-skill/skill.contract.js`](../../../skills/js-browser-ops-skill/skill.contract.js)
- CLI：[`apps/cli/src/cli.js`](../../../apps/cli/src/cli.js)（`js-eyes skills ...` 子命令）

---

Last updated: 2026-04-19
