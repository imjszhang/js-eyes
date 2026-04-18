# examples/js-eyes-skills/

遵循本仓库 [`skill.contract.js`](../../docs/dev/js-eyes-skills/contract.zh.md) 契约的**可运行样例**。

## 样例索引

| 样例 | 难度 | 覆盖特性 |
|------|------|---------|
| [`js-hello-ops-skill/`](js-hello-ops-skill/) | ⭐ | 单工具、无副作用、不依赖 `@js-eyes/skill-recording` |
| 更多进阶样例 | — | 规划中（多工具、录制、consent、CLI） |

## 运行步骤

```bash
# 1. 拷到工作目录（不要放回仓库 skills/）
cp -R examples/js-eyes-skills/js-hello-ops-skill ~/my-skills/
cd ~/my-skills/js-hello-ops-skill

# 2. 安装依赖
npm install

# 3. 在 OpenClaw 配置里把 js-eyes 的 skillsDir 指向父目录
#    ~/.openclaw/openclaw.json:
#    {
#      "tools": { "alsoAllow": ["js-eyes"] },
#      "plugins": {
#        "entries": {
#          "js-eyes": {
#            "enabled": true,
#            "config": { "skillsDir": "/Users/you/my-skills" }
#          }
#        }
#      }
#    }

# 4. 启用（首次发现默认禁用）
js-eyes skills enable js-hello-ops-skill

# 5. 重启 OpenClaw（或开新会话）
#    随后 Agent 应该能看到 hello_get_title 工具

# 6. 也可以直接用 CLI 跑
node ~/my-skills/js-hello-ops-skill/index.js title 123
```

完整指南见 [docs/dev/js-eyes-skills/authoring.zh.md](../../docs/dev/js-eyes-skills/authoring.zh.md)。

## 样例的命名约定

- **目录名** = 技能 ID = `package.json.name`，统一用 `js-<domain>-ops-skill` 模式。
- **工具名**：按主题加前缀，如 `hello_*`、`browser_*`、`x_*`。避免与 [内置 `js_eyes_*` 工具](../../openclaw-plugin/index.mjs)、其他 skill 的工具名冲突（主插件通过 `registeredNames` 防撞，冲突则跳过）。
- **最小依赖**：能不引入 `@js-eyes/skill-recording` 就不引，保持样例简洁；需要录制再在进阶样例里演示。
