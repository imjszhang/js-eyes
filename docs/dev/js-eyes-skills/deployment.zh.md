# JS Eyes Skills 部署与启用（中文）

> 写完一个 skill 后，三种部署模式任选；启用流程统一走 `js-eyes skills enable`。
> 编写 skill 看 [authoring.zh.md](authoring.zh.md)；契约细节看 [contract.zh.md](contract.zh.md)。

## 1. skillsDir 解析优先级

主插件 [`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) 第 210-212 行决定扫描哪个目录：

```js
const skillsDir = pluginCfg.skillsDir
    ? nodePath.resolve(pluginCfg.skillsDir)
    : nodePath.join(SKILL_ROOT, "skills");
```

优先级：

1. OpenClaw `plugins.entries["js-eyes"].config.skillsDir`（绝对路径，推荐）；
2. `SKILL_ROOT/skills`（`SKILL_ROOT` = 插件目录上溯能找到 `skills/` 的位置，即 ClawHub bundle 根 / git 仓库根）。

**只接受单个目录**。要集中管理多个来源的 skill，请把它们统一挪进同一个目录，或用软链。

## 2. 部署模式 A：仓库内开发

> 适合：贡献官方 skill / 在本仓库做实验。

```text
js-eyes/
└── skills/
    └── js-foo-ops-skill/     ← 放这里
        ├── SKILL.md
        ├── skill.contract.js
        └── ...
```

步骤：

1. 把新 skill 放进 `skills/js-foo-ops-skill/`。
2. 在**仓库根** `npm install`（保证 `@js-eyes/*` 依赖可解析；skill 自身若有独立依赖也需要 `cd skills/js-foo-ops-skill && npm install`）。
3. `js-eyes skills enable js-foo-ops-skill`。
4. 重启 OpenClaw（或开新会话）。

优点：修改 `skill.contract.js` 后重启 OpenClaw 即生效；可以复用仓库内的 `packages/*` 源码（不过官方约定是**只依赖已发布的 `@js-eyes/*` npm 包**，便于未来分发）。

缺点：skill 绑定在仓库里，升级 js-eyes 容易把本地改动覆盖。

## 3. 部署模式 B：外部 skillsDir（推荐）

> 适合：自定义 / 私有 skill，不提交到 js-eyes 仓库。

```text
~/my-skills/
├── js-foo-ops-skill/
│   ├── SKILL.md
│   ├── skill.contract.js
│   └── ...
└── js-bar-ops-skill/
    └── ...
```

步骤：

1. skill 目录放任意位置（`~/my-skills/`、公司共享盘、私有 git repo 等都行）。
2. 在 skill 目录里 `npm install`（装 `@js-eyes/config`、`@js-eyes/skill-recording`、`ws` 等）。
3. 改 OpenClaw 配置：

   ```json
   {
     "tools": { "alsoAllow": ["js-eyes"] },
     "plugins": {
       "load": { "paths": ["/abs/path/to/js-eyes/openclaw-plugin"] },
       "entries": {
         "js-eyes": {
           "enabled": true,
           "config": {
             "skillsDir": "/Users/you/my-skills"
           }
         }
       }
     }
   }
   ```
4. `js-eyes skills enable js-foo-ops-skill`。
5. 重启 OpenClaw。

优点：

- 与 js-eyes 仓库完全解耦；升级 js-eyes（pull / 重装 ClawHub bundle）不会覆盖你的 skill。
- 可以一个目录放多个 skill，统一版本管理。
- 多人协作：把 `~/my-skills` 放到私有 git 仓库里，团队共享。

缺点：第一次配置多一步；skill 目录**必须自己 `npm install`**，仓库里没有统一的 hoisting。

## 4. 部署模式 C：ClawHub 注册表

> 适合：想把 skill 发布给其他人用。

### 4.1 本地安装官方注册表里的 skill

```bash
js-eyes skills install js-x-ops-skill  # 下载 + sha256 校验 + 解压到 stage
js-eyes skills approve js-x-ops-skill  # 人工确认后正式落地并生成 .integrity.json
js-eyes skills enable  js-x-ops-skill
# 重启 OpenClaw
```

或 Agent 侧调 `js_eyes_install_skill` 走同样流程。

### 4.2 发布自己的 skill（简要）

1. 把 skill 打包成 zip，文件结构和仓库内 skill 目录一致。
2. 生成 sha256、大小。
3. 上传 zip 到一个可公开 HTTP 下载的地方（GitHub Releases / CDN）。
4. 在一个 `skills.json`（可以 fork 官方格式）里添加条目：

   ```json
   {
     "id": "js-foo-ops-skill",
     "name": "JS Foo Ops Skill",
     "description": "...",
     "version": "1.0.0",
     "sha256": "abc123...",
     "size": 12345,
     "downloadUrl": "https://example.com/skills/js-foo-ops-skill-1.0.0.zip",
     "tools": ["foo_get_title"],
     "requires": { "skills": ["js-eyes"] }
   }
   ```
5. 让用户把 `plugins.entries["js-eyes"].config.skillsRegistryUrl` 指向你的 `skills.json`：

   ```bash
   js-eyes config set skillsRegistryUrl https://example.com/skills.json
   ```

官方注册表格式看 [`docs/skills.json`](../../skills.json)；完整打包/发布细节后续会有专门文档（`distribution.zh.md`，待编写）。

## 5. 启用流程（共同部分）

无论哪种部署模式，skill 第一次被主插件扫到时：

- 主插件调用 `setConfigValue('skillsEnabled.<id>', false)` 并打 warn（见 [`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) 第 137-143 行）。
- 必须显式启用才会真的加载：

```bash
js-eyes skills enable <id>       # 启用
js-eyes skills disable <id>      # 禁用
js-eyes skills list              # 查看状态
js-eyes skills verify            # 校验完整性
```

配置文件里对应项：

```json
{
  "skillsEnabled": {
    "js-x-ops-skill": true,
    "js-foo-ops-skill": true
  }
}
```

## 6. OpenClaw 工具暴露

启用只是第一步，工具真正被模型看到还需要：

| 前提 | 作用 |
|------|------|
| `plugins.entries["js-eyes"].enabled = true` | 主插件本身加载 |
| `skillsEnabled.<id> = true` | skill 工具被注册 |
| `tools.alsoAllow: ["js-eyes"]`（推荐）或 `tools.allow: ["js-eyes"]` | optional 工具被暴露给模型 |

少一项都会出现 "工具没出现" 的症状。排查顺序参考 [authoring.zh.md — 调试技巧](authoring.zh.md#8-调试技巧)。

## 7. 升级与回滚

### 通过 CLI 安装的 skill（有 `.integrity.json`）

```bash
js-eyes skills install js-foo-ops-skill --force   # 覆盖安装新版本
js-eyes skills approve js-foo-ops-skill
# 旧版 .integrity.json 会被新版覆盖
```

回滚：手动删除 skill 目录，重新 `install` 指定版本（或用 skillsDir 外部备份）。

### 外部 skillsDir 的 skill

由你自己管理（git / 手动 cp）。没有 `.integrity.json` 就不会有完整性检查，改文件即生效（改完需重启 OpenClaw）。

### 仓库内 skill

走 git 版本管理。

## 8. 故障排除

| 现象 | 最可能的原因 | 处理 |
|------|------------|------|
| `js-eyes skills list` 里看不到 skill | 目录没有 `skill.contract.js`、或不在 `skillsDir` 下直接子目录 | 确认路径、改 `skillsDir` |
| 列表里能看到但不加载 | `skillsEnabled.<id>` 是 `false` | `js-eyes skills enable <id>` |
| 加载时 `Refusing to load tampered skill` | `.integrity.json` 文件哈希与实际不符 | 删 `.integrity.json`（退回 legacy）或重新 `install` |
| `Cannot find module 'ws'` / `@js-eyes/config` | skill 目录没 `npm install` | 进 skill 目录跑 `npm install` |
| 工具不出现在 Agent 菜单 | `tools.alsoAllow` 没有 `js-eyes` | 在 OpenClaw 配置里补上 |
| 工具出现但一调就超时 | 浏览器扩展未连接 / token 不匹配 | `openclaw js-eyes status`、`js-eyes audit tail` 看 `conn.reject` |
| 并发调用之间互相影响 | skill 的 `runtime` 被多个工具共享 | 把并发敏感状态搬到 `execute` 局部 |

## 9. 快速决策表

| 场景 | 建议模式 |
|------|---------|
| 短期做实验 / 试写 | B（外部 skillsDir） |
| 要提交到官方 js-eyes 仓库 | A（仓库内） |
| 团队内部共享、闭源 | B（外部 skillsDir，放私有 git） |
| 面向公众发布、想进注册表 | C（ClawHub 注册表） |
| 紧急线上修一个 bug | B（改外部 skill，不动 js-eyes 仓库） |

---

Last updated: 2026-04-18
