# JS Eyes 2.8.3 发布文档与站点构建整理

> 日期：2026-06-26
> 项目：js-eyes
> 类型：升级迁移 / 文档治理 / 问题排查
> 来源：Cursor Agent 对话

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [分析过程](#2-分析过程)
3. [关键决策](#3-关键决策)
4. [实现要点](#4-实现要点)
5. [验证与测试](#5-验证与测试)
6. [后续注意事项](#6-后续注意事项)

---

## 1. 背景与动机

2.8.2 之后，仓库已经累计了站点构建、GitHub Pages、`js-hn-ops-skill`、`js-x-ops-skill` 官方 X API 通道、`js-browser-ops-skill` egress 自动放行等变更，但 `CHANGELOG.md` / `RELEASE_NOTES.md` 仍停在 2.8.2。

同时，站点源码已经从旧的 `docs/` 发布根迁到 `src/` → `dist/` 构建流，但 README / SKILL / 示例文档仍引用 `docs/dev/js-eyes-skills/`、`docs/native-messaging.md` 等路径。由于部分 markdown 曾被删除，仓库内链接变成 404，影响用户安装、开发者写 skill 和 release 操作。

本次目标：

- 将平台版本升级到 `2.8.3`
- 恢复并澄清 `docs/` 的职责：开发者 markdown，而不是 Pages 输出根
- 让 `dist/skills.json` 成为本地构建 registry 产物，线上入口仍是 `https://js-eyes.com/skills.json`
- 补齐 2.8.3 release notes / changelog
- 确认平台版本 bump 不会污染独立 semver 包和 `skills/*` 子技能

## 2. 分析过程

对 `v2.8.2..HEAD` 的变更进行梳理后，主要增量分为四类：

| 类别 | 代表变更 |
| ---- | -------- |
| 平台/发布 | GitHub Pages workflow、`src/` → `dist/` 站点构建、`bin/js-eyes-server-start.*` |
| 新 bundled skill | `js-hn-ops-skill@1.0.0`，Hacker News READ + INTERACTIVE |
| 子技能增强 | `js-x-ops-skill@3.5.0` 官方 X API v2、mentions/trends/delete、`budgetMs`、pinned tweet |
| browser ops | `js-browser-ops-skill` 新增 `autoAllowDomain` 和 `ServerPolicyError` |

检查中发现一个重要问题：`npm run bump -- 2.8.3` 会遍历 `packages/*`，把 `@js-eyes/visual-bridge-kit` 和 `@js-eyes/visual-replay-hyperframes` 误同步到平台版本。即使手动恢复 package 版本，`syncInternalDependencyVersions()` 仍会把 root `package.json` 里的 `@js-eyes/visual-bridge-kit: "workspace:*"` 改成平台版本。这个问题必须在 release 前修掉，否则下次 bump 会再次回归。

## 3. 关键决策

| 决策 | 选择 | 理由 |
| ---- | ---- | ---- |
| 平台版本 | `2.8.3` | 当前变更主要是 patch/minor 级发布治理、文档修复和 bundled skill 更新，没有平台协议 breaking |
| 站点产物位置 | `dist/` | 与现有 `build:site` 和 GitHub Pages workflow 一致，避免重新把 `docs/` 当 Pages 根 |
| 开发者文档位置 | 恢复 `docs/` markdown | README / examples / SKILL 已大量引用该目录，恢复比重写所有链接风险更低 |
| registry 本地路径 | `dist/skills.json` | 这是构建产物，不应再提交 `docs/skills.json` 静态副本 |
| visual 包版本 | 独立 semver | `visual-bridge-kit@0.6.x`、`visual-replay-hyperframes@0.7.x` 与平台 release train 不一致 |
| 子技能版本 | 独立 semver | `skills/*/package.json` 不随平台 bump，用户通过 `js-eyes skills update` 单独升级 |

## 4. 实现要点

### 平台版本同步

执行 `npm run bump -- 2.8.3` 同步：

- 根 `package.json`
- `apps/*`
- 平台 `packages/*`
- Chrome / Firefox manifest
- OpenClaw plugin metadata
- landing page / i18n hero badge

随后修正 `packages/devtools/lib/builder.js`：

- `collectVersionFiles()` 跳过 `visual-bridge-kit` / `visual-replay-hyperframes`
- `syncInternalDependencyVersions()` 也跳过 `@js-eyes/visual-bridge-kit` / `@js-eyes/visual-replay-hyperframes`

这样下次平台 bump 不会再把 visual 包版本或 workspace/file 依赖改成平台版本。

### 文档修复

恢复并更新：

- `docs/README.md`：说明 `docs/` 只保存 markdown，Pages 构建源是 `src/`，输出是 `dist/`
- `docs/README_CN.md`
- `docs/native-messaging.md`
- `docs/dev/js-eyes-skills/*`
- `docs/dev/skills/README.md`

主文档同步：

- `README.md`：Compatibility Matrix → 2.8.3；Extension Skills 表列出 11 个 first-party skills；registry 路径改为 `dist/skills.json` / `https://js-eyes.com/skills.json`
- `RELEASE.md`：补 GitHub Pages workflow 与 `npm run preview`
- `SECURITY.md`：版本注记改为 2.8.3，registry 元数据路径使用 `dist/skills.json`
- `CHANGELOG.md` / `RELEASE_NOTES.md`：新增 2.8.3 条目

### 子技能文档

- `skills/js-x-ops-skill/SKILL.md`：frontmatter → `3.5.0`，补 `api mentions` / `api trends` / `api delete` / `--budget-ms` 示例，路线图从“v3.1 下一步”改为“后续计划”
- `skills/js-browser-ops-skill/SKILL.md`：frontmatter → `2.5.1`，补 `autoAllowDomain` 说明和 CLI 示例
- `skills/js-browser-ops-skill/CHANGELOG.md`：新增 2.5.1
- `skills/js-browser-ops-skill/package.json`：版本同步到 2.5.1

## 5. 验证与测试

已执行：

```bash
npm test
npm run build:site
```

结果：

- tests: 260
- pass: 260
- fail: 0
- `build:site` 成功生成 `dist/skills.json`，包含 11 个 skill，`parentSkill.version` 为 `2.8.3`

额外检查：

- `rg "2\.8\.2"`：仅剩历史 changelog / release notes 中的 2.8.2 记录，以及旧 journal/历史说明
- `git diff` 检查 `builder.js`，确认 visual 包和依赖同步都有排除逻辑
- 检查 README / 中文 README / x-ops SKILL 的关键段落，修正与当前状态不一致的叙述

## 6. 后续注意事项

1. 正式发布前运行：

   ```bash
   npm run build:site
   npm run build
   ```

2. `package-lock.json` 当前历史上仍停在较早平台版本（如 2.7.0），本次没有重写 lockfile，避免把大范围 lockfile churn 混入文档修复。若 release 流程要求 lockfile 同步，应单独跑 `npm install --package-lock-only` 并独立 review。

3. `dist/` 是构建产物，不手写提交；`dist/skills.json` 由 `npm run build:site` 生成，线上通过 GitHub Pages 暴露为 `https://js-eyes.com/skills.json`。

4. 未来如果新增独立 semver 的 workspace 包，应同时加入 `PLATFORM_VERSION_EXCLUDE`，否则平台 bump 会误改版本。
