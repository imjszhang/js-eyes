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
```

### 3. 在 OpenClaw 配置里接入（二选一）

**A. 把 `skillsDir` 指向父目录（primary 模式，js-eyes 接管生命周期）**

```jsonc
// ~/.openclaw/openclaw.json
{
  "tools": { "alsoAllow": ["js-eyes"] },
  "plugins": {
    "entries": {
      "js-eyes": {
        "enabled": true,
        "config": { "skillsDir": "/Users/you/my-skills" }
      }
    }
  }
}
```

**B. 保留默认 `skills/`，用 `extraSkillDirs` 挂接（extra 模式，只读）**

```jsonc
// ~/.openclaw/openclaw.json
{
  "tools": { "alsoAllow": ["js-eyes"] },
  "plugins": {
    "entries": {
      "js-eyes": {
        "enabled": true,
        "config": {
          "extraSkillDirs": [
            "/Users/you/my-skills/js-hello-ops-skill"
            // 父目录写法（扫 1 层子目录）：
            // "/Users/you/my-skills"
          ]
        }
      }
    }
  }
}
```

> `extraSkillDirs` 里的 skill 不受 `js-eyes skills install/approve/verify` 管辖，只被发现并注册工具。详见[部署模式 D](../../docs/dev/js-eyes-skills/deployment.zh.md#5-部署模式-dprimary--extraskilldirs)。

### 4. 启用与调用（零重启路径推荐）

```bash
# 零重启：把外部目录接入当前主机并自动启用
js-eyes skills link ~/my-skills/js-hello-ops-skill

# 已在运行的 OpenClaw 会在 ~300ms 内通过 config 监听器热加载这个技能
# 对应的 js_eyes_reload_skills 工具也能主动驱动 reload 并拿到 diff 摘要

# 也可以直接用 CLI 跑
node ~/my-skills/js-hello-ops-skill/index.js title 123

# 如果未来要临时停掉该 skill
js-eyes skills disable js-hello-ops-skill   # 立即热卸载
js-eyes skills unlink ~/my-skills/js-hello-ops-skill  # 从 extraSkillDirs 移除
```

### 4.1 在你的 skill 里实现 `runtime.dispose()`

热卸载/热替换时，`SkillRegistry` 会调用 `runtime.dispose()` 清理长连接。建议模板：

```js
function createRuntime(config = {}, logger) {
  let bot = null;
  return {
    ensureBot() {
      if (!bot) bot = new BrowserAutomation(serverUrl, { logger });
      return bot;
    },
    async dispose() {
      if (bot) {
        try { bot.disconnect(); } catch {}
        bot = null;
      }
    },
  };
}
```

参考 [`js-hello-ops-skill/skill.contract.js`](js-hello-ops-skill/skill.contract.js)。


完整指南见 [docs/dev/js-eyes-skills/authoring.zh.md](../../docs/dev/js-eyes-skills/authoring.zh.md)。

## 样例的命名约定

- **目录名** = 技能 ID = `package.json.name`，统一用 `js-<domain>-ops-skill` 模式。
- **工具名**：按主题加前缀，如 `hello_*`、`browser_*`、`x_*`。避免与 [内置 `js_eyes_*` 工具](../../openclaw-plugin/index.mjs)、其他 skill 的工具名冲突（主插件通过 `registeredNames` 防撞，冲突则跳过）。
- **最小依赖**：能不引入 `@js-eyes/skill-recording` 就不引，保持样例简洁；需要录制再在进阶样例里演示。
