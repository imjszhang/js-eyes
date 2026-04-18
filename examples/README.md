# examples/

> Last updated: 2026-04-19

本目录放**可运行样例代码**，供开发者拷贝改造。按 skill 体系分层：

| 子目录 | 指向规范 | 文档 |
|--------|---------|------|
| [`js-eyes-skills/`](js-eyes-skills/) | 本仓库 [`skill.contract.js`](../docs/dev/js-eyes-skills/contract.zh.md) 契约 | [docs/dev/js-eyes-skills/](../docs/dev/js-eyes-skills/) |
| [`skills/`](skills/) | 未来兼容外部通用 Skills（占位） | [docs/dev/skills/](../docs/dev/skills/) |

## 为什么独立于 `skills/`

仓库根 [`skills/`](../skills/) 是**真实运行目录**，会被主插件的 `discoverLocalSkills(skillsDir)` 扫描、注册工具；把教学样例放进 `skills/` 会：

- 被 `js-eyes skills list` 列出来、默认禁用、触发"first-run disable"警告；
- 被打包脚本误带进发布 artifact。

因此样例一律放 `examples/`，拷贝到自己的工作目录（或外部 `skillsDir`）后再启用。

## 快速开始（以 `js-hello-ops-skill` 为例）

```bash
cp -R examples/js-eyes-skills/js-hello-ops-skill ~/my-skills/
cd ~/my-skills/js-hello-ops-skill
npm install

# 在 OpenClaw 配置里把 js-eyes 插件的 skillsDir 指向 ~/my-skills/
# ~/.openclaw/openclaw.json:
#   plugins.entries["js-eyes"].config.skillsDir = "/Users/you/my-skills"

js-eyes skills enable js-hello-ops-skill

# 重启 OpenClaw 或开新会话后，hello_get_title 工具可见
```

详细步骤见 [docs/dev/js-eyes-skills/deployment.zh.md](../docs/dev/js-eyes-skills/deployment.zh.md)。
