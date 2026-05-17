# OpenClaw 单工具 `js-eyes` 路由改造

> 日期：2026-05-17
> 项目：js-eyes
> 类型：架构设计 / 功能实现 / 升级迁移
> 来源：Cursor Agent 对话

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [分析过程](#2-分析过程)
3. [方案设计](#3-方案设计)
4. [实现要点](#4-实现要点)
5. [验证与测试](#5-验证与测试)
6. [后续演化](#6-后续演化)

---

## 1. 背景与动机

本次工作源于对 JS Eyes 作为 OpenClaw 插件时的 skill 机制分析：原实现会把内置浏览器能力和每个 skill 暴露的工具都注册成 OpenClaw tool。这样虽然直接，但 OpenClaw 侧会看到不断膨胀的工具列表，skill 的动态发现也会和 OpenClaw 的工具模型强绑定。

目标调整为：OpenClaw 只保留一个工具 `js-eyes`，其余能力全部作为 JS Eyes 内部 action 路由。这样 OpenClaw 面向的是稳定入口，JS Eyes 内部继续负责浏览器、skill、安全策略和热加载。

## 2. 分析过程

重点检查了 OpenClaw 插件入口、`SkillRegistry`、skill contract、CLI 展示和安全策略链路。结论是：原来的 `SkillRegistry` 会为 skill contract 中声明的工具建立 dispatcher，并通过 `api.registerTool` 注册到 OpenClaw；内置能力也逐个注册为 `js_eyes_*` 工具。

这意味着要达成单工具目标，不能只改文档或工具名，而要把注册边界整体内收：OpenClaw 只认识 `js-eyes`，JS Eyes 自己维护 action 到具体实现的映射。

## 3. 方案设计

最终方案是单入口 router：

| 决策 | 选择 | 理由 |
| ---- | ---- | ---- |
| OpenClaw 工具名 | `js-eyes` | 保持用户指定的唯一入口，也匹配插件品牌名 |
| 调用参数 | `action` + `args` | `action` 负责路由，`args` 保留各能力自己的参数对象 |
| action 命名 | 路径式，如 `browser/get-tabs` | 层级清晰，适合区分 browser、skills、security 和 child skill |
| 旧命名兼容 | 不保留 `js_eyes_*` action alias | 这是外部契约的硬切换，避免旧口径继续扩散 |
| skill 绑定 | `SkillRegistry` router mode | 保留热加载能力，但跳过 OpenClaw 逐工具注册 |

## 4. 实现要点

### 项目结构

```
js-eyes/
├── openclaw-plugin/
│   └── index.mjs
├── packages/protocol/
│   ├── skill-registry.js
│   ├── skills.js
│   └── index.js
├── apps/cli/src/cli.js
├── docs/skills.json
└── test/
    ├── openclaw-single-tool.test.js
    ├── skill-registry.test.js
    └── skill-bundle.test.js
```

### 关键模块

| 文件 | 职责 |
| ---- | ---- |
| `openclaw-plugin/index.mjs` | 只注册 `js-eyes`，内部通过 action map 分发 browser、skills、security 能力 |
| `packages/protocol/skill-registry.js` | 新增 router mode，维护 `skill/<skillId>/<action>` 绑定并暴露 `executeAction()` |
| `packages/protocol/skills.js` | 集中生成 skill action 名称，并把 `actions` 写入 skill metadata |
| `packages/protocol/index.js` | 将敏感工具列表切换到路径式 action |
| `apps/cli/src/cli.js` | skill 列表和安装输出改为展示 actions |
| `docs/skills.json` | registry 元数据增加 `actions`，parent skill 版本更新到 `2.8.0` |

版本层面，本次发布推进为 `2.8.0`。更新范围包括根 `package.json`、核心 `@js-eyes/*` 包、CLI、native host、OpenClaw plugin、浏览器扩展 manifest、站点版本展示、`CHANGELOG.md` 和 `RELEASE_NOTES.md`。

## 5. 验证与测试

已补充和执行的验证覆盖：

- 单工具注册：确认 OpenClaw API 只收到 `js-eyes`。
- 内置 action 路由：确认 `browser/get-tabs` 等新路径式 action 可分发。
- 旧口径拒绝：确认 `js_eyes_*` action 不被兼容。
- skill router mode：确认不注册 dispatcher，也能通过 `executeAction()` 调用 skill。
- skill metadata：确认 `actions` 能从 skill tools 稳定生成。
- 全量 `npm test` 通过，Lint 检查无新增错误。

## 6. 后续演化

- 在实际 OpenClaw 环境跑一次端到端验证：安装 2.8.0 bundle、重启 OpenClaw、用 `js-eyes` 调用 `browser/get-tabs` 与一个 child skill action。
- 如果未来 action 数继续增加，可考虑在 `skills/discover` 或 `doctor --json` 中输出 action schema 摘要，方便 agent 自动规划。
- 继续保持 OpenClaw 边界只暴露单工具，把新能力优先设计为内部 action，而不是回到逐工具注册。

---
