# Skills 通用兼容（Roadmap）

> **状态：预留，未实现。** 本目录是为未来对**外部通用 Skills 规范**的兼容层准备的命名空间。
> JS Eyes 自家的扩展技能文档请看 [../js-eyes-skills/](../js-eyes-skills/)。

## 为什么预留这个目录

"skill" 是一个正在被多个 AI agent 生态使用的通用名词：

| 生态 | 规范 | 形态 |
|------|------|------|
| Anthropic Claude | Agent Skills | 目录 + `SKILL.md` frontmatter + 指令式 markdown |
| Cursor | Cursor Skills | 目录 + `SKILL.md` + 专属工具 |
| Claude Code | Claude Code Skills | 类似 Anthropic，可运行脚本 |
| OpenClaw | OpenClaw Skill | 目录 + `SKILL.md`（本仓库的发行产物兼容这一类） |
| **JS Eyes**（本仓库） | JS Eyes Skills | V2 `skill.manifest.json` + `skill.entry.js`；V1 `skill.contract.js` 兼容 |

这些规范**互不相同**但名字撞车，本仓库选择把"JS Eyes Skills"作为专有名词，把通用 Skills 规范留给 `skills/` 命名空间未来承接。

## 可能的兼容策略（待讨论）

1. **适配层**：在 `packages/` 下加一个 host-neutral adapter，按外部规范读取目录，桥接到 Skill Runtime V2。
2. **直通模式**：让外部通用 Skills 的目录可直接挂到 `skillsDir`，通过明确的 kind 与静态 manifest 识别类型，不在发现阶段执行入口。
3. **双轨隔离**：保留 `js-eyes-skills/` 为"强契约"入口，`skills/` 给"弱契约 / 纯 prompt"入口，互不污染。

## 待调研项

- [ ] Anthropic Agent Skills 的 `SKILL.md` frontmatter 字段全集。
- [ ] Cursor Skills 的执行时机与上下文注入方式。
- [ ] 统一安装、签名、完整性（类 `.integrity.json`）在外部 Skills 里有无对应约定。
- [ ] `js-eyes skills <cmd>` 的 CLI 是否分桶（如 `js-eyes skills list --kind=jseyes|generic`）。
- [ ] 工具暴露方式：外部 Skills 多为 markdown 指令，不注册具体 tool，则与 OpenClaw 的 tool 暴露模型如何对齐。

---

欢迎在 GitHub Issues / Discussions 里提议。实施节奏等主线稳定后再启动。

Last updated: 2026-04-18
