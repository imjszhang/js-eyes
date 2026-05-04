---
name: js-browser-ops-skill
description: 通用浏览器操作技能，提供网页内容读取、DOM 交互、页面截图等能力。
version: 2.2.0
metadata:
  openclaw:
    emoji: "\U0001F310"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-browser-ops-skill

通用浏览器操作技能 — 基于 js-eyes 浏览器自动化，提供面向任意网站的内容读取、DOM 交互和截图能力。

与其他平台特化技能（如 `js-x-ops-skill`、`js-zhihu-ops-skill`）不同，本技能不绑定特定平台，适用于所有网页。

## 依赖

本技能依赖 **js-eyes** 技能提供的浏览器自动化能力。使用前请确保：

1. JS-Eyes Server 已运行
2. 浏览器已安装 JS-Eyes 扩展并连接到服务器

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `browser_read_page` | 读取任意网页正文，返回结构化 markdown/纯文本 + 元数据（标题、作者、摘要、图片、链接） |
| `browser_click` | 点击页面元素，支持 CSS 选择器、XPath、文本内容匹配 |
| `browser_fill_form` | 填写表单字段（input/textarea/select/contenteditable） |
| `browser_wait_for` | 等待元素出现或条件满足（基于 MutationObserver） |
| `browser_scroll` | 页面滚动（到顶部/底部、指定元素、指定像素偏移） |
| `browser_screenshot` | 获取页面视口信息和截图元数据 |

## 编程 API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { readPage, clickElement, fillForm, scrollPage } = require('./lib/api');

const browser = new BrowserAutomation('ws://localhost:18080');

// 读取网页内容
const page = await readPage(browser, {
  url: 'https://example.com/article',
  format: 'markdown',
});

// 点击元素
await clickElement(browser, {
  tabId: page.tabId,
  selector: 'button.submit',
});

// 填写表单
await fillForm(browser, {
  tabId: page.tabId,
  selector: 'input[name="email"]',
  value: 'user@example.com',
  clearFirst: true,
});

// 滚动到底部
await scrollPage(browser, {
  tabId: page.tabId,
  target: 'bottom',
});
```

## CLI 命令

```bash
# 读取网页内容
node skills/js-browser-ops-skill/index.js read "https://example.com/article" --format markdown --pretty

# DOM 交互
node skills/js-browser-ops-skill/index.js interact click --tab-id 123 --selector "button.submit"
node skills/js-browser-ops-skill/index.js interact fill --tab-id 123 --selector "input[name=q]" --value "hello" --clear-first
node skills/js-browser-ops-skill/index.js interact wait --tab-id 123 --selector ".results" --timeout 10 --visible
node skills/js-browser-ops-skill/index.js interact scroll --tab-id 123 --target bottom
```

## 页面内视觉反馈（v2.2.0+）

通过 `@js-eyes/visual-bridge-kit@^0.4.0` 在每次工具调用前后注入一段 DOM overlay：
**HUD（屏幕右上角状态条）+ flash（在锚点元素周围闪一下黄/绿框）+ jsonl trace**。
浏览器里直接看到 agent 在点哪、填什么、等什么。业务脚本（`generate*Script`）一行不动。

> **post-2.7.0 architecture pivot 提示**：browser-ops 的 in-page 视觉反馈（HUD/flash）继续工作，
> 但**离线 HTML 模板这一轮还没接 browser-ops**（reddit 是首个；list/item/tree/global/navigation
> 模板套都按 `js-reddit-ops-skill` 注册）。`--visual-record` 仍然写出
> `meta.json + events.jsonl`（不再写 `frames/`），离线 `jse-replay` 会落到 `'*'` 通配模板
> 渲一份 HUD-only 的 fallback composition。`--redact-rect` / `--redact-selector` /
> `--redact-config` 仍解析但不会下发，stderr 会打一行 deprecation 提醒。

| 工具 | 视觉演出 |
|---|---|
| `browser_click` | selector 命中元素先黄框 → 点击成功后绿框 + HUD "点击 BUTTON" |
| `browser_fill_form` | input 黄框 → 绿框 + HUD `INPUT ← "hello..."` |
| `browser_wait_for` | HUD pulse `等待 .results ≤10s`；元素出现后绿框 + HUD `+1234ms` |
| `browser_scroll` | HUD `滚动 → bottom`；指定 selector 时目标元素绿框 |
| `browser_read_page` | HUD-only：`读取 example.com` → `"Article Title…"` |
| `browser_screenshot` | HUD `拍照 视口 1280×720` |

CLI 旋钮（`browser-read.js` / `browser-interact.js` 都支持）：

| flag | 默认 | 说明 |
|---|---|---|
| `--visual` / `--no-visual` | 开 | 总开关；关闭后零额外 RTT |
| `--visual-detail compact\|staged` | `staged` | `compact` 只 HUD，`staged` 全套 |
| `--visual-ms <n>` | `420` | flash 持续时长（ms，clamp 120–4000） |
| `--visual-hud` / `--no-visual-hud` | 开 | 右上角 HUD 卡片（v0.6.0 取代 `--visual-mode hud/dom`） |
| `--visual-flash` / `--no-visual-flash` | 开 | 元素 flash overlay/relation（v0.6.0 取代 `--visual-mode hud/dom`） |
| `--visual-trace <file.jsonl>` | — | 把视觉事件落 jsonl，供回放 / headless 观测 |
| `--visual-prefix <p>` | `__jse_browser_visual_` | DOM id 前缀（多 skill 共存防撞） |

```bash
# click + 视觉反馈 + jsonl 落盘
node index.js interact click --tab-id 123 --selector "button.submit" \
  --visual-trace /tmp/click.jsonl --visual-ms 600

# read 通用网页 + 视觉反馈
node index.js read "https://example.com" --visual-trace /tmp/read.jsonl --pretty

# 关闭视觉（CI / 静默模式）
node index.js interact click --tab-id 123 --selector "..." --no-visual
```

技术细节：
- 每次工具调用 +2 RTT（before+install 合并、after+drain 合并）。`installVisualBridgeKit` 自带 `__installed` 短路锁，重复 inject 接近 0 成本。
- `--no-visual` 时 `withVisual` 直接 bypass，调用路径与 v2.1.1 完全一致。
- chrome:// / file:// 等受限页 visual 注入静默失败，业务返回不受影响。
- skill.contract（openclaw）默认走 `enabled:true`，向后兼容。

## 工作原理

1. 通过 js-eyes 的 `openUrl` 在浏览器中打开目标页面
2. 使用 `executeScript` 注入 JavaScript 脚本到页面中执行
3. 脚本在页面上下文中操作 DOM，提取数据或执行交互
4. 将结果返回给调用者

### 内容提取（browser_read_page）

使用类 Readability 算法：
- 优先查找 `<article>`、`[role="article"]`、`<main>` 等语义元素
- 回退到基于评分的候选区域选择（正文密度、ID/class 语义分析）
- 支持 markdown / text / html 三种输出格式

### DOM 交互

所有交互操作（click / fill / wait / scroll）均通过 `executeScript` 注入到页面：
- `browser_click` 支持 CSS selector、XPath、文本匹配三种定位策略
- `browser_fill_form` 使用 native value setter 绕过框架拦截，正确触发 React/Vue 等框架的 change 事件
- `browser_wait_for` 使用 MutationObserver 高效监听，避免轮询

## 目录结构

```text
skills/js-browser-ops-skill/
├── SKILL.md                  # 技能描述（本文件）
├── CHANGELOG.md              # 版本记录
├── package.json
├── skill.contract.js         # OpenClaw 契约
├── index.js                  # CLI 入口
├── cli/index.js              # CLI 封装
├── bridges/
│   └── _visual-browser.js    # 站点 anchor resolver（CSS/XPath/text/url）
├── lib/
│   ├── api.js                # 业务 API（withVisual 包装）
│   ├── js-eyes-client.js     # 浏览器控制客户端
│   ├── browserUtils.js       # 注入脚本模板（业务零侵入）
│   ├── visualHint.js         # 6 工具的 hint + buildSummary
│   ├── cliVisualFlags.js     # CLI 视觉旋钮解析
│   ├── runtimeConfig.js      # 配置合并
│   └── runContext.js          # Recording 上下文
└── scripts/
    ├── browser-read.js       # 读取命令
    └── browser-interact.js   # 交互命令
```

## Recording

`js-browser-ops-skill` 已接入统一的 skill recording 底座，覆盖 `read` 只读内容抓取。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

缓存策略：
- `browser_read_page` 接入缓存（URL → 结构化结果）
- 交互类工具（click/fill/scroll/wait/screenshot）不缓存但记录调用历史

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-browser-ops-skill/`。
