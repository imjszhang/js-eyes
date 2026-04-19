# JS Eyes Skills 开发指南（中文）

> 从零写一个自定义 **JS Eyes Skill**，让 Agent 获得新的浏览器自动化工具。
> 本文档假设你已阅读 [README](README.md) 的命名澄清表。

## 1. 前置条件

- Node.js **>= 22**（主插件要求）；skill 自身 `engines.node` 可以放宽到 `>= 16`。
- 已有可用的 JS Eyes 环境：
  - OpenClaw 能加载 `openclaw-plugin`；
  - 浏览器装了 JS Eyes 扩展并连接上服务器；
  - `openclaw js-eyes status` 能看到至少一个浏览器客户端。
- 在 OpenClaw 配置里开启了 `tools.alsoAllow: ["js-eyes"]`（`optional` 工具才会被暴露）。

如果基础栈没就位，先按根 [README.md](../../../README.md) 装好再回来。

## 2. Skill 的最小骨架

一个可被主插件识别的 skill 目录：

```text
my-skill/
├── SKILL.md                  # 可选，面向 Agent 的中文说明（强烈推荐）
├── package.json              # name 必须 = 技能 ID，声明依赖
├── skill.contract.js         # ⭐ 必需，契约入口
├── index.js                  # CLI 入口（可选，但现有样例都提供）
├── cli/index.js              # CLI 封装（帮助文案）
├── scripts/*.js              # 各命令实现
└── lib/
    ├── js-eyes-client.js     # 自包含 WebSocket 客户端（从现有 skill 复制）
    ├── runtimeConfig.js      # 解析 serverUrl / recording 配置
    └── api.js                # 你的业务函数（纯函数、不做 I/O）
```

识别判据（见 [`packages/protocol/skills.js`](../../../packages/protocol/skills.js) `discoverLocalSkills` / `discoverSkillsFromSources`）：

1. 目录是 `skillsDir`（primary）或 `extraSkillDirs`（extras）下的直接子目录；或者是 `extraSkillDirs` 里**自身就是 skill 目录**的条目（含 `skill.contract.js`）；
2. 目录里有 `skill.contract.js`。

没有 `skill.contract.js` 的目录会被静默忽略（见 `test/skill-bundle.test.js` 里 "ignores parent skill docs without a child skill contract" 这条用例）。

## 3. 推荐起点：拷贝最小样例

最快的方式是从 [`examples/js-eyes-skills/js-hello-ops-skill/`](../../../examples/js-eyes-skills/js-hello-ops-skill/) 起手：

```bash
cp -R examples/js-eyes-skills/js-hello-ops-skill ~/my-skills/js-foo-ops-skill
cd ~/my-skills/js-foo-ops-skill

# 改 package.json 的 name
# 改 SKILL.md 的 frontmatter name
# 改 skill.contract.js 的 id / name / tools / runtime.platforms
```

然后装依赖：

```bash
npm install
```

> **关于 `@js-eyes/*` 运行时依赖**：JS Eyes 的运行时包已经独立发布在 npm 组织 [`js-eyes`](https://www.npmjs.com/org/js-eyes) 下，在仓库外部写 skill 时可以直接：
>
> ```bash
> npm install @js-eyes/config @js-eyes/client-sdk @js-eyes/skill-recording
> ```
>
> 但样例 `js-hello-ops-skill` 为了**零外部依赖、开箱即跑**，选择自包含 `lib/js-eyes-client.js`（从 `@js-eyes/client-sdk` 复制来的），只依赖 `ws`。两种方式都行，官方 `skills/js-*-ops-skill/` 也沿用自包含策略。

## 4. 写 skill.contract.js

完整字段规范见 [contract.zh.md](contract.zh.md)，这里给出最简模板：

```js
'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');

function createRuntime(config = {}, logger) {
  const { serverUrl } = resolveRuntimeConfig(config);
  let bot = null;
  return {
    config: { serverUrl },
    logger: logger || console,
    ensureBot() {
      if (!bot) bot = new BrowserAutomation(serverUrl, { logger });
      return bot;
    },
    textResult(text) { return { content: [{ type: 'text', text }] }; },
    jsonResult(v)    { return this.textResult(JSON.stringify(v, null, 2)); },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'foo_get_title',
    label: 'Foo: Get Page Title',
    description: '读取指定标签页的标题。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        target: { type: 'string', description: '目标浏览器 clientId 或名称' },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      const info = await runtime.ensureBot().getPageInfo(params.tabId, { target: params.target });
      return { title: info.title, url: info.url };
    },
  },
];

function createOpenClawAdapter(config = {}, logger) {
  const runtime = createRuntime(config, logger);
  return {
    runtime,
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
      async execute(toolCallId, params) {
        return runtime.jsonResult(await tool.execute(runtime, params, { toolCallId }));
      },
    })),
  };
}

module.exports = {
  id: pkg.name,
  name: 'JS Foo Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: { requiresServer: true, requiresBrowserExtension: true, platforms: ['*'] },
  cli: { entry: './cli/index.js', commands: [{ name: 'title', description: '读取标签页标题' }] },
  openclaw: {
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name, label: t.label, description: t.description, parameters: t.parameters, optional: t.optional,
    })),
  },
  createRuntime,
  createOpenClawAdapter,
};
```

关键点：

- `optional: true` 是**默认**——主插件把 skill 工具全部注册为可选工具，要求 OpenClaw `tools.alsoAllow` 里列 `js-eyes` 才会暴露给模型。
- `execute(toolCallId, params)` **必须返回** `{ content: [{ type: 'text', text }] }`。用 `runtime.jsonResult()` 包装业务对象是惯用写法。
- 工具名要**全局唯一**：主插件的 `registeredNames` 里已经占了内置 [`js_eyes_*`](../../../openclaw-plugin/index.mjs)；其他 skill 的工具名也算在内，冲突时新来的会被跳过并 warn。

## 5. 对接 BrowserAutomation

`lib/js-eyes-client.js` 是一份**单文件自包含的 WebSocket 客户端**，现有所有 skill 都复制了同一份。新 skill 直接 cp 过来即可，不要改名。

常用方法（完整列表见 [`packages/client-sdk/index.js`](../../../packages/client-sdk/index.js)）：

| 方法 | 用途 |
|------|------|
| `bot.getTabs({ target })` | 列所有浏览器 / 标签页 |
| `bot.openUrl(url, tabId?, windowId?, { target })` | 打开 URL，返回 tabId |
| `bot.getPageInfo(tabId, { target })` | URL / title / status / favicon |
| `bot.getTabHtml(tabId, { target })` | 完整 HTML |
| `bot.executeScript(tabId, code, { target })` | **敏感** — 注入 JS |
| `bot.getCookies(tabId, { target })` | **敏感** — 读 Cookie |
| `bot.injectCss(tabId, css, { target })` | **敏感** — 注入 CSS |
| `bot.uploadFileToTab(tabId, files, opts)` | **敏感** — 上传文件 |

带"敏感"标记的调用，若 `js-eyes` 的 `security.toolPolicies` 未显式放行，会走 consent 流程或被阻断。详见 [contract.zh.md — 敏感工具](contract.zh.md#敏感工具与-consent)。

## 6. 加 CLI（可选）

CLI 方便开发时手动跑，不影响 OpenClaw 工具注册。典型结构：

```js
// index.js (CLI 入口)
const path = require('path');
const COMMANDS = {
  title: { module: './scripts/foo-title', description: '读取标签页标题' },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log('用法: node index.js <command> [args...]');
    console.log('可用命令:', Object.keys(COMMANDS).join(', '));
    return;
  }
  const info = COMMANDS[cmd];
  if (!info) throw new Error(`未知命令: ${cmd}`);
  process.argv = [process.argv[0], path.join(__dirname, 'index.js'), ...rest];
  const mod = require(info.module);
  await mod.main();
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
```

`scripts/foo-title.js` 就是一个标准 Node 脚本，内部 `new BrowserAutomation(serverUrl).getPageInfo(...)` 然后 `console.log` 结果。

## 7. 启用与验证

Skill 第一次被发现时**默认禁用**（见 [`openclaw-plugin/index.mjs`](../../../openclaw-plugin/index.mjs) `registerLocalSkills` 第 137-143 行），必须显式启用：

```bash
# 方式一（推荐）：通过 js-eyes CLI
js-eyes skills enable js-foo-ops-skill

# 方式二：直接改 js-eyes 宿主配置
js-eyes config set skillsEnabled.js-foo-ops-skill true
```

启用后**主插件会自动热加载这个 skill**（[零重启部署](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)）——无需重启 OpenClaw。外部目录的 skill 走 `js-eyes skills link <path>` 一条命令就行（300 ms 内通过 config watcher 触发 `registry.reload()`）。需要重启的只有两种情况：首次把 `openclaw-plugin` 纳入 OpenClaw，或者该 skill 带来了一个从未注册过的 tool name（`js_eyes_reload_skills` 返回里会看到 `failedDispatchers`）。

然后：

```bash
openclaw plugins inspect js-eyes   # 看 foo_* 工具是否注册
openclaw js-eyes status            # 确认服务器与浏览器连接
```

Agent 侧调 `foo_get_title` 即可验证工具可用；也可以先调 `js_eyes_reload_skills`，返回的 `added` / `reloaded` 摘要里应该包含你的 skill id。

## 8. 调试技巧

| 现象 | 排查 |
|------|------|
| `js_eyes_*` 能用，但 `foo_*` 不出现 | 1) `js-eyes skills list` 是否包含 skill；2) 是否 `enable`；3) `js-eyes skills reload`（或 Agent 调 `js_eyes_reload_skills`）看日志是否 `Hot-loaded skill "..."`、以及返回里 `failedDispatchers` 是否为空；4) `tools.alsoAllow` 是否含 `js-eyes`。若 `failedDispatchers` 非空，是插件启动后 OpenClaw 不接受新 tool name，需要重启一次 OpenClaw 让新工具名登记进去。 |
| 启动日志 `Refusing to load tampered skill` | 本地开发 **不要**手写 `.integrity.json`。若是从 zip 安装的 skill 想改动，删掉 `.integrity.json` 或重装（见 [contract.zh.md — 完整性校验](contract.zh.md#integrity-与完整性校验)）。 |
| 工具名冲突，日志 `Skipping tool ... already registered` | 改工具名（建议带技能前缀，如 `foo_`）。 |
| 调用超时 | 默认 1800 秒；`new BrowserAutomation(url, { defaultTimeout: 秒 })` 或 contract 中调大 `requestTimeout`。 |
| 敏感工具被 consent 拦截 | `js-eyes consent list` / `approve`，或设置 `security.toolPolicies.<tool>=allow`（会写审计日志）。 |
| 想看审计日志 | `js-eyes audit tail`；连接失败多为 token / Origin 不匹配。 |

## 9. 常见坑

1. **不要把样例放 `skills/`**。放样例会被当真技能扫到、默认禁用、产生 warn。样例统一放 [`examples/js-eyes-skills/`](../../../examples/js-eyes-skills/)。
2. **工具名冲突**。内置 [`js_eyes_*`](../../../openclaw-plugin/index.mjs) 先占位，其他本地 skill 的工具也算在内——起名带技能前缀最稳。
3. **工具的 `execute` 必须返回 `{ content: [...] }`**。直接 `return data` 会被 OpenClaw 当成非法响应。用 `runtime.textResult` / `jsonResult` 最稳。
4. **`require('../../packages/...')` 不要用**。skill 要能独立分发，全部走 `@js-eyes/*` npm 包（已发布到 [npm 组织 `js-eyes`](https://www.npmjs.com/org/js-eyes)）或自包含 `lib/js-eyes-client.js` 的约定。
5. **`@js-eyes/skill-recording` 可按需引入**。简单 skill 不用；要做跨会话缓存 / debug bundle 再加。
6. **改完 `skill.contract.js` 可以零重启生效**。`SkillRegistry` 会在 reload 时递归清理该 skill 目录下的 `require.cache`（排除 `node_modules`）并重新 `require` contract；触发方式见 [deployment.zh.md §5.3](deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐)。只有改到 `openclaw-plugin/` 自身的代码才需要重启 OpenClaw。
7. **新版本的 `version` 字段**要同步改 `package.json.version`、`SKILL.md` frontmatter `version`、`skill.contract.js` 导出的 `version`（后者其实读的是 `pkg.version`，省心做法就是只改 `package.json`）。

## 10. 让别人通过 `extraSkillDirs` 纳入你的外部 skill

如果你把 skill 维护在仓库外（单独的 git repo / 本地目录），用户不想动 `skillsDir` 就能接入，只要在 OpenClaw 配置里加：

```jsonc
"plugins": {
  "entries": {
    "js-eyes": {
      "enabled": true,
      "config": {
        "extraSkillDirs": [
          "/abs/path/to/your-skill-dir"   // 可以是单个 skill 根，也可以是父目录
        ]
      }
    }
  }
}
```

作为 skill 作者，只需要保证：

1. 目录根含 `skill.contract.js` + `package.json`（单 skill 模式），或者是一个父目录、里面每个子目录自成一个 skill（父目录模式）；哪种由 js-eyes 自动识别。
2. README 写清楚用户要 `cd <your-skill-dir> && npm install`。
3. 和 primary 里的 skill `id` 不要撞名——撞名时 primary 优先，你的 skill 会在启动日志里被跳过。
4. extras 不受 `.integrity.json` 完整性校验约束（js-eyes 只读不接管），因此**你自己要对源码可信度负责**。

详细语义看 [deployment.zh.md — 部署模式 D：primary + extraSkillDirs](deployment.zh.md#5-部署模式-dprimary--extraskilldirs)。

## 11. 接下来

- 看 [contract.zh.md](contract.zh.md) 学清楚每个契约字段能做什么。
- 看 [deployment.zh.md](deployment.zh.md) 决定用哪种部署模式、准备发布到 ClawHub 注册表。
- 想做复杂的带录制 / consent / GraphQL fallback 的 skill，参考 [`skills/js-x-ops-skill/`](../../../skills/js-x-ops-skill/)。

---

Last updated: 2026-04-19
