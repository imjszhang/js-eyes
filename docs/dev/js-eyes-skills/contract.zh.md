# skill.contract.js 契约规范（中文）

> 本文档描述 **JS Eyes Skills** 必须实现的 `skill.contract.js` 契约。
> 快速上手请先看 [authoring.zh.md](authoring.zh.md)；部署 / 启用看 [deployment.zh.md](deployment.zh.md)。

契约的加载位点：

- 发现：[`packages/protocol/skills.js`](../../../packages/protocol/skills.js) 的 `discoverLocalSkills(skillsDir)` 扫描 primary 子目录；若 openclaw-plugin 配了 `extraSkillDirs`，由 `discoverSkillsFromSources()` 统一合并 primary + extras（primary 优先，extras 只读，不做完整性校验）；
- 载入：同文件 `loadSkillContract(skillDir)` 通过 `require` 加载；
- 注册：[`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) 的 `registerLocalSkills` 调 `contract.createOpenClawAdapter(config, logger)` 拿到 `{ tools[] }` 注册到 OpenClaw。

## 1. 顶层导出字段

`module.exports` 必须是一个对象，字段如下：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | 技能 ID，**必须等于目录名**，也等于 `package.json.name`。用于 `skillsEnabled.<id>` 等处索引。 |
| `name` | `string` | 是 | 人类可读名称，用于日志与列表。 |
| `version` | `string` | 是 | 语义化版本；一般直接 `pkg.version`。 |
| `description` | `string` | 是 | 简短描述，显示在 `js-eyes skills list`。 |
| `runtime` | `object` | 建议 | 运行要求说明（见下）。 |
| `cli` | `object` | 可选 | CLI 元数据（见下）。 |
| `openclaw` | `object` | 建议 | OpenClaw 展示元数据（见下）。**真正注册工具走 `createOpenClawAdapter()`**。 |
| `createRuntime(config, logger)` | `function` | 建议 | 工厂：创建长生命周期的 `runtime`（持有 `BrowserAutomation` 实例、logger、helpers）。 |
| `createOpenClawAdapter(config, logger)` | `function` | **是** | 工厂：返回 `{ runtime, tools[] }`。**主插件唯一的注册入口**。 |

### 1.1 `runtime` 字段

```js
runtime: {
  requiresServer: true,               // 是否依赖 JS Eyes Server
  requiresBrowserExtension: true,     // 是否依赖浏览器扩展
  requiresLogin: false,               // 是否需要站点登录态（如 X.com）
  platforms: ['*'],                   // 目标站点；'*' 表示任意
}
```

当前主插件**不强制**校验这些字段，但它们：

- 进入 `js-eyes skills list` 的输出；
- 帮助 Agent / 文档自动生成；
- 未来可能用于预检（比如站点不匹配时拒绝启用）。

### 1.2 `cli` 字段

```js
cli: {
  entry: './cli/index.js',            // 相对路径；js-eyes CLI 会 spawn node <entry>
  commands: [
    { name: 'search', description: '搜索 X 平台内容' },
    { name: 'post',   description: '读取帖子详情或执行发布操作' },
  ],
}
```

`cli.entry` 用于 `js-eyes skill run <id> <command> ...`（由 `packages/protocol/skills.js` 的 `runSkillCli` 执行）。没有 CLI 的 skill 可省略此字段。

### 1.3 `openclaw` 字段

```js
openclaw: {
  tools: TOOL_DEFINITIONS.map((t) => ({
    name: t.name, label: t.label, description: t.description, parameters: t.parameters, optional: t.optional,
  })),
}
```

这里是**展示用的静态列表**，被 [`js_eyes_discover_skills`](../../../openclaw-plugin/index.mjs) 等功能读出来生成菜单。真正的 `execute` 函数走 `createOpenClawAdapter().tools[]`。

## 2. `createOpenClawAdapter(config, logger)`

**契约**：

```ts
(config: object, logger?: Logger) => {
  runtime: Runtime;
  tools: OpenClawTool[];
}
```

- `config` 由主插件从 OpenClaw 的 `plugins.entries["js-eyes"].config` 整体传入；skill 负责从中挑自己关心的字段（比如 `serverHost / serverPort / requestTimeout`），通常借道 `lib/runtimeConfig.js`。
- `logger` 形如 `{ info, warn, error }`，由主插件提供，建议用 `makeLogger(logger)` 包一层防御。
- `tools[]` 的每一项必须是 OpenClawTool（见 3. 节）。

## 3. `TOOL_DEFINITIONS` 与 OpenClawTool Schema

每个工具对象：

```js
{
  name: 'x_search_tweets',            // 字符串，全局唯一，见 §3.1
  label: 'X Ops: Search Tweets',      // 人类可读标签（菜单显示）
  description: '搜索 X.com ...',       // 给模型看的描述，尽量完整具体
  parameters: {                       // JSON Schema（OpenClaw 遵循的子集）
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '...' },
      maxPages: { type: 'number' },
      sort: { type: 'string', enum: ['top', 'latest', 'media'] },
    },
    required: ['keyword'],
  },
  optional: true,                     // 详见 §3.2
  async execute(toolCallId, params) { // 详见 §3.3
    return { content: [{ type: 'text', text: '...' }] };
  },
}
```

### 3.1 工具命名

- **全局唯一**：主插件用 `registeredNames` Set 去重，冲突时后来的被 skip 并 warn（见 [`packages/protocol/skills.js`](../../../packages/protocol/skills.js) `registerOpenClawTools`）。
- 建议带**技能前缀**：`x_*`、`browser_*`、`hello_*`，避免与内置 `js_eyes_*` 或其他 skill 撞车。
- `snake_case` 是约定。

### 3.2 `optional: true` 的含义

- **几乎所有 skill 工具都应该是 `optional: true`**。
- OpenClaw 默认不暴露 optional 工具；要暴露必须在配置里加 `tools.alsoAllow: ["js-eyes"]`（推荐）或 `tools.allow: ["js-eyes"]`（排他）。
- 若强制工具（`optional: false`），会绕过 alsoAllow 检查，容易给用户带来意料之外的工具——除非你非常确定，别这么做。

### 3.3 `execute(toolCallId, params)`

签名：

```ts
(toolCallId: string, params: object) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
}>
```

- **必须返回** `{ content: [{ type, text }] }` 形态。非此形态 OpenClaw 会当成非法响应。
- `toolCallId` 透传进你的业务层很有用（作为录制的 `runId` / 追踪日志的 key）。
- 惯用写法：业务函数返回普通对象，外层用 `runtime.jsonResult(obj)` 打包：

```js
async execute(toolCallId, params) {
  const result = await searchTweets(runtime.ensureBot(), params.keyword, { ...opts, runId: toolCallId });
  return runtime.jsonResult(result);
}
```

- 抛异常时 OpenClaw 会把错误显示给用户；务必把业务失败转成合理的 `text`，把程序 bug 以异常形式冒出来。

## 4. 敏感工具与 consent

某些工具被主插件视为"敏感工具"，默认走 `confirm` 策略（走 consent 流程），除非用户显式放行。

### 4.1 内置敏感工具列表

来自 [`packages/protocol/index.js`](../../../packages/protocol/index.js) 的 `SENSITIVE_TOOL_NAMES`：

- `js_eyes_execute_script`
- `js_eyes_get_cookies`
- `js_eyes_get_cookies_by_domain`
- `js_eyes_inject_css`
- `js_eyes_upload_file`
- `js_eyes_upload_file_to_tab`
- `js_eyes_install_skill`

### 4.2 自定义敏感工具

如果你的 skill 工具也涉及副作用或隐私（比如发帖、执行脚本的封装），可以：

1. **隐式继承**：若工具内部调用了上述敏感 API，consent 会在 `BrowserAutomation` 层触发（因为服务端也有一层审查）。
2. **显式标记**：主插件会从 `security.toolPolicies` 读取策略：

   ```json
   {
     "security": {
       "toolPolicies": {
         "foo_send_email": "confirm",
         "x_post":         "confirm",
         "js_eyes_inject_css": "allow"
       }
     }
   }
   ```

   合法值：`allow`（放行）、`confirm`（走 consent）、`deny`（拒绝并写审计日志）。

### 4.3 Consent 流程

- 触发：工具被调用 → 主插件 `wrapSensitiveTool` 判断策略 → `confirm` 就生成 pending 记录（`runtimePaths.consentsDir/<id>.json`）并按当前实现**自动继续执行**并记录 `auto-confirm`。严格模式下需要用户：

  ```bash
  js-eyes consent list
  js-eyes consent approve <id>  # 或 deny
  ```

- 审计：所有 consent 决策都会进 `logs/audit.log`，`js-eyes audit tail` 可以看。

## 5. `.integrity.json` 与完整性校验

### 5.1 是什么

每个通过 `js-eyes skills install → approve` 安装的 skill，目录里会自动生成一个 `.integrity.json`，记录每个文件的 sha256。主插件加载时会校验（见 [`packages/protocol/skills.js`](../../../packages/protocol/skills.js) `verifySkillIntegrity`）：

| 状态 | 行为 |
|------|------|
| 无 `.integrity.json` | **Legacy 模式**：允许加载，warn 一条 `no .integrity.json` |
| 有 `.integrity.json`，匹配 | 正常加载 |
| 有 `.integrity.json`，不匹配 / 缺文件 | **拒绝加载**：warn `Refusing to load tampered skill` |

### 5.2 开发期如何处理

- 本地开发 skill **不要**手写 `.integrity.json`——走 Legacy 模式就好。
- 通过 `skills install` 安装的第三方 skill 若想就地改，要么：
  - 删掉 `.integrity.json`（退回 Legacy）；
  - 或 `js-eyes skills install <id> --force` 重装以重新生成。

### 5.3 校验工具

```bash
js-eyes skills verify              # 全量（仅作用于 primary skillsDir）
js-eyes skills verify js-x-ops-skill  # 单个
js-eyes doctor                     # 安全 + 完整性体检一次出
```

### 5.4 `extraSkillDirs` 不做完整性校验

通过 [`extraSkillDirs`](deployment.zh.md#5-部署模式-dprimary--extraskilldirs) 挂接的 skill 是**只读**来源：

- 启动时会在日志里看到 `[js-eyes] Skipping integrity check for extra skill "<id>" at <path>`；
- `js-eyes skills verify <id>` 对 extra 源输出 `SKIPPED (extra source, no integrity check)`；
- `js-eyes skills install / approve <id>` 会直接拒绝并报错——生命周期由外部来源自己负责。
- 改动文件即生效：`SkillRegistry` 会通过 chokidar 监听（或 `js-eyes skills reload` / `js_eyes_reload_skills`）热重载 contract，`require.cache` 会被深清，**不需要重启 OpenClaw**。详见 [deployment.zh.md §5.3 零重启部署](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)。需要强完整性约束的 skill 请放回 primary `skillsDir` 下。

## 6. 工具执行时的上下文

`createOpenClawAdapter` 返回的 `runtime` 是**共享状态**：每个 skill 在单次加载生命周期内只实例化一次，随后同一 skill 的所有工具调用复用同一份 `runtime`。意味着：

- `BrowserAutomation` 连接是长连接，首次 `ensureBot()` 建立 WS，之后复用。
- 如果要持久化跨调用的状态（缓存、cookie jar、访问计数），挂到 `runtime` 上即可。
- 注意并发：工具调用可能并行到来，写入 runtime 时要考虑并发安全。

### `runtime.dispose()`（零重启生命周期钩子）

从零重启部署开始（见 [deployment.zh.md §5.3](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)），`dispose()` 不再只是 "主插件 stop 时收尾"，而是 `SkillRegistry` 在**以下场景**会调用的主动清理钩子：

- `js-eyes skills unlink <path>` / 从 `extraSkillDirs` 移除该 skill；
- `js-eyes skills disable <id>`；
- 代码热替换（hot reload）前的旧实例；
- 主插件 stop / 进程退出。

因此强烈建议：凡是持有 WebSocket / HTTP agent / 文件句柄 / 定时器的 skill，都实现 `async dispose()` 关闭这些资源。推荐样板见 [`examples/js-eyes-skills/js-hello-ops-skill/skill.contract.js`](../../../examples/js-eyes-skills/js-hello-ops-skill/skill.contract.js)。实现得好，热替换期间不会出现"旧 runtime 还在偷偷发请求"的泄漏现象；抛错也只会被 warn 记录，不会阻塞 reload。

## 7. 从 `package.json` 映射的字段

主插件的 `normalizeSkillMetadata()` 会在 skill 没提供 `id / name / version / description` 时**退化到 `package.json`**。推荐做法是**让契约里的这几个字段直接引用 `pkg`**，只改一个地方：

```js
const pkg = require('./package.json');
module.exports = {
  id:          pkg.name,
  name:        'JS Foo Ops Skill',   // 人类名可以跟 pkg.name 不同
  version:     pkg.version,
  description: pkg.description,
  // ...
};
```

## 8. 完整参考实现

- [`skills/js-browser-ops-skill/skill.contract.js`](../../../skills/js-browser-ops-skill/skill.contract.js) — 通用浏览器操作，6 个工具，无录制，结构清晰。
- [`skills/js-x-ops-skill/skill.contract.js`](../../../skills/js-x-ops-skill/skill.contract.js) — X.com 操作，4 个工具 + 录制 + 429 保护 + GraphQL fallback。
- [`examples/js-eyes-skills/js-hello-ops-skill/skill.contract.js`](../../../examples/js-eyes-skills/js-hello-ops-skill/skill.contract.js) — 最小样例，1 个工具。

---

Last updated: 2026-04-19
