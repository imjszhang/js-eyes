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

因此样例一律放 `examples/`，拷贝到自己的工作目录后再通过 `skillsDir`（primary）或 `extraSkillDirs`（只读 extras）接入 js-eyes。

## 快速开始（以 `js-hello-ops-skill` 为例）

```bash
cp -R examples/js-eyes-skills/js-hello-ops-skill ~/my-skills/
cd ~/my-skills/js-hello-ops-skill
npm install
```

两种接入方式任选：

### A. 把它作为 primary `skillsDir`

```jsonc
// ~/.openclaw/openclaw.json
"plugins": { "entries": { "js-eyes": { "enabled": true, "config": {
  "skillsDir": "/Users/you/my-skills"
} } } }
```

`js-eyes skills install/approve/verify` 都会作用在这里。

### B. 保留默认 `skills/`，用 `extraSkillDirs` 加挂

```jsonc
// ~/.openclaw/openclaw.json
"plugins": { "entries": { "js-eyes": { "enabled": true, "config": {
  "extraSkillDirs": [
    "/Users/you/my-skills/js-hello-ops-skill"
    // 父目录写法（会扫 1 层子目录）：
    // "/Users/you/my-skills"
  ]
} } } }
```

`extraSkillDirs` 里的 skill 只被发现、不被 js-eyes 接管生命周期（`install` / `approve` / `verify` 对它们是拒绝的）。

两种方式都需要最后一步：

```bash
js-eyes skills enable js-hello-ops-skill
# 运行中的 js-eyes 主插件会在 ~300 ms 内通过 chokidar watcher 自动热加载
# 之后 hello_get_title 工具即可见，无需重启 OpenClaw。

# 零重启快捷方式（等价）：
# js-eyes skills link /Users/you/my-skills/js-hello-ops-skill   # 外部 skill 直接挂到当前主机
# js-eyes skills reload                                           # 强制触发一次 reload
# 或 Agent 侧调 js_eyes_reload_skills 工具拿 diff 摘要
```

> 仅当 `openclaw-plugin` 第一次纳入 OpenClaw 或该 skill 带来了一个**从未注册过的 tool name** 时，`js_eyes_reload_skills` 返回的 `failedDispatchers` 会要求一次 OpenClaw 重启。其他变更（启用/禁用、热替换实现、unlink）全部零重启。

详细步骤见 [docs/dev/js-eyes-skills/deployment.zh.md](../docs/dev/js-eyes-skills/deployment.zh.md)。
