---
name: js-hello-ops-skill
description: JS Eyes Skills 最小样例 — 读取任意标签页的标题。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F44B"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
---

# js-hello-ops-skill

JS Eyes Skills **最小样例** — 一个工具、零副作用，用来演示 `skill.contract.js` 契约的最简形态。

## 依赖

- JS Eyes Server 已运行
- 浏览器已装 JS Eyes 扩展并连上服务器
- OpenClaw 加载 `js-eyes` 插件并 `tools.alsoAllow: ["js-eyes"]`

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `hello_get_title` | 读取指定标签页的 `title` 与 `url`（底层调 `BrowserAutomation.getPageInfo`） |

## 编程 API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { getTitle } = require('./scripts/hello');

const bot = new BrowserAutomation('ws://localhost:18080');
const { title, url } = await getTitle(bot, { tabId: 123 });
```

## CLI

```bash
# 查看所有命令
node index.js --help

# 读取 tabId=123 的标题
node index.js title 123

# 指定浏览器
node index.js title 123 --target firefox
```

## 目录结构

```text
js-hello-ops-skill/
├── SKILL.md                  # 本文件（给 Agent 读）
├── package.json              # 只依赖 ws
├── skill.contract.js         # 契约入口：导出 hello_get_title
├── index.js                  # CLI 入口
├── cli/index.js              # CLI 帮助文案
├── scripts/hello.js          # 业务实现
└── lib/
    ├── js-eyes-client.js     # 自包含 WebSocket 客户端（从 js-browser-ops-skill 复制）
    └── runtimeConfig.js      # 极简 serverUrl 解析（不依赖 @js-eyes/config）
```

## 详细教程

- 开发指南：[docs/dev/js-eyes-skills/authoring.zh.md](../../../docs/dev/js-eyes-skills/authoring.zh.md)
- 契约规范：[docs/dev/js-eyes-skills/contract.zh.md](../../../docs/dev/js-eyes-skills/contract.zh.md)
- 部署启用：[docs/dev/js-eyes-skills/deployment.zh.md](../../../docs/dev/js-eyes-skills/deployment.zh.md)
