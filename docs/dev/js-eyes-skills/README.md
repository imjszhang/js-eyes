# JS Eyes Skills

> 本文档面向**想扩展 JS Eyes 能力**的开发者。
> 用户向安装/使用文档见 [根 README](../../../README.md)、[docs/README_CN.md](../../README_CN.md)。

## 什么是 JS Eyes Skills

**JS Eyes Skills** 是本仓库定义的一类扩展技能：

- V2 技能由 `package.json`、`skill.manifest.json` 和 `skill.entry.js` 构成；
  manifest 静态声明兼容性、工具 schema、风险和权限，发现阶段不执行入口。
- `@js-eyes/skill-runtime` 的 `SkillHostService` 统一负责发现、信任、调用、
  deadline、取消和释放；CLI、MCP、可选 OpenClaw 适配器共用同一个 Runtime。
- 旧的 [`skill.contract.js`](contract.zh.md) 和
  `createOpenClawAdapter()` 仅作为 V1 迁移兼容层继续支持。
- 需要浏览器的技能通过宿主持有的 `BrowserAutomation` 能力代理驱动扩展，
  并受 manifest 与具体工具权限的双重约束。

## 命名澄清

本项目里同时存在多处 `skill` 字眼，含义各不相同。本节为**权威对照表**，所有 dev 文档都以此为准：

| 字符串 / 路径 | 实际指代 | 归类 |
|--------------|---------|------|
| `skills/`（仓库根子目录） | JS Eyes Skills 默认安装目录 | 代码层（不改名） |
| `skillsDir`（host-neutral 配置项） | JS Eyes Skills 主安装根（primary，可指向仓库外）；`install` / `approve` / `verify` 等生命周期操作作用于此处 | 代码层 |
| `extraSkillDirs`（host-neutral 配置项） | 额外只读技能来源列表，条目可为单个技能目录或父目录；同 id 冲突时 primary 优先；可结合 V2 trust policy | 代码层 |
| `skill.manifest.json` / `skill.entry.js` | JS Eyes Skills V2 静态契约与激活入口（推荐） | 代码层 |
| `skill.contract.js` | V1 兼容契约入口 | 代码层（迁移兼容） |
| `js-eyes skills <cmd>` / `js-eyes skill call` | JS Eyes Skills 管理与 host-neutral 调用命令 | 代码层 |
| `@js-eyes/skill-recording` npm 包 | JS Eyes Skills 运行录制底座 | 代码层（不改名） |
| `@js-eyes/*`（npm scope） | 对应 [npm 组织 `js-eyes`](https://www.npmjs.com/org/js-eyes)，仅官方运行时包 + 官方 JS Eyes Skills 使用 | npm 层（不改名） |
| `SKILLS_REGISTRY_URL`、`skills.json` | JS Eyes Skills 官方注册表 | 代码层（不改名） |
| [`distribution/js-eyes-skill/SKILL.template.md`](../../../distribution/js-eyes-skill/SKILL.template.md) | **可分发父 Skill 模板**（CLI / MCP / 可选 OpenClaw 运维手册，**不是** JS Eyes Skills 规范） | 构建后兼容 OpenClaw / ClawHub 生态 |
| `docs/dev/js-eyes-skills/` | 本仓库 JS Eyes Skills 的开发者文档 | 文档层（新增） |
| `examples/js-eyes-skills/` | 本仓库 JS Eyes Skills 的可运行样例 | 文档层（新增） |
| `docs/dev/skills/`、`examples/skills/` | 为未来兼容**外部通用 Skills** 预留的命名空间 | 文档层（新增） |
| 业界的 "Skills"（Anthropic Agent Skills / Cursor Skills / Claude Code Skills） | 外部通用 skill 生态，与本仓库契约不同 | 外部生态 |

> 简记：**首字母大写、空格分隔的 "JS Eyes Skills" 专指本仓库契约下的扩展技能；其他 "skill" 字眼看语境**。

## 章节索引

1. **[Skill Runtime V2 架构](../../architecture/skill-runtime-v2.md)** — 当前推荐契约、静态发现、权限、信任、Worker 与多宿主边界。
2. **[V1 开发指南（authoring.zh.md）](authoring.zh.md)** — 旧 `skill.contract.js` 兼容层的目录布局、BrowserAutomation、CLI 与调试；新技能应优先参考仓库内官方 V2 manifest。
3. **[V1 契约规范（contract.zh.md）](contract.zh.md)** — 迁移期间保留的 `skill.contract.js`、工具返回形态、敏感操作和完整性约定。
4. **[部署与启用（deployment.zh.md）](deployment.zh.md)** — 仓库内、外部目录、注册表和 primary + extras 模式，以及 V2 inspect / permissions / trust 流程。
5. **[零重启部署（deployment.zh.md §5.3）](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)** — `link / unlink / reload`、`skills/reload` action 与 watcher 边界。
6. **独立升级通道** — `skills/*` 子技能保留独立版本；registry 记录版本、摘要和最低父版本，用户通过 `skills update` 独立升级。

## 可运行样例

| 样例 | 难度 | 覆盖特性 |
|------|------|---------|
| [`js-hello-ops-skill`](../../../examples/js-eyes-skills/js-hello-ops-skill/) | ⭐ | V1 兼容样例：单工具、零副作用、无录制依赖 |
| 更多进阶样例 | — | 规划中（多工具、录制、consent、GraphQL fallback） |

拷贝样例、改名字、`npm install`，然后按 [部署与启用](deployment.zh.md) 把 `skillsDir` 指过去，或者用 `extraSkillDirs` 把样例目录挂到默认 `skills/` 之外（[模式 D](deployment.zh.md#5-部署模式-dprimary--extraskilldirs)）。

## npm scope 治理

`@js-eyes/*` 对应 npm 组织 [`js-eyes`](https://www.npmjs.com/org/js-eyes)，**仅**收录官方运行时包和官方 JS Eyes Skills。第三方 JS Eyes Skills 开发者请使用自己的 scope，例如：

- `@acme/js-eyes-skill-shopify-ops`
- `@yourname/js-eyes-skill-mastodon-ops`

第三方 skills 通过向 [`dist/skills.json`](../../../dist/skills.json)（由 `npm run build:site` 生成；线上为 [js-eyes.com/skills.json](https://js-eyes.com/skills.json)）提 PR 注册进官方 registry，**不会**被接纳进 `@js-eyes/*` scope。这样可以保证：

1. `@js-eyes/*` 的安全边界清晰——`npm i @js-eyes/...` 拿到的一定是官方代码。
2. 第三方 skill 作者保留自己的发布权与版本节奏，不依赖本仓库 maintainer。
3. `js-eyes skills install <id>` 的 registry 机制与 scope 归属互相解耦。

## 相关文件引用（便于跳转阅读源码）

- Host-neutral Runtime：[`packages/skill-runtime`](../../../packages/skill-runtime/)
- V2 契约与兼容规范：[`packages/skill-contract`](../../../packages/skill-contract/)
- 发现、registry 与 trust：[`packages/protocol/skill-registry.js`](../../../packages/protocol/skill-registry.js)
- 官方 V2 参考：[`skills/js-x-ops-skill/skill.manifest.json`](../../../skills/js-x-ops-skill/skill.manifest.json)、[`skills/js-browser-ops-skill/skill.manifest.json`](../../../skills/js-browser-ops-skill/skill.manifest.json)
- CLI：[`apps/cli/src/commands/skills`](../../../apps/cli/src/commands/skills/) 与 [`apps/cli/src/commands/skill.js`](../../../apps/cli/src/commands/skill.js)

---

Last updated: 2026-07-24
