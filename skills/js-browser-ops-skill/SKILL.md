---
name: js-browser-ops-skill
description: 通用浏览器操作技能，提供网页内容读取、DOM 交互、页面截图等能力。
version: 2.6.0
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

1. Node.js 22+、JS Eyes 2.8.5+，且 JS-Eyes Server 已运行
2. 浏览器已安装 JS-Eyes 扩展并连接到服务器
3. `browser_click` / `browser_fill_form` / `browser_wait_for` / `browser_scroll` 使用扩展内置操作，不要求 Raw Eval；页面正文抽取等脚本能力需要宿主设置 `security.allowRawEval: true`
4. JS Eyes 2.5+ 会把宿主的 Raw Eval 设置同步到扩展；扩展存储中的显式 `false` 仍可强制关闭
5. Chrome 脚本能力要求 Chrome 135+；Chrome 138+ 还需在浏览器扩展设置中开启 **Allow User Scripts**

登录要求取决于目标网页；本 Skill 不执行登录自动化。

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `browser_read_page` | 读取任意网页正文。自开标签默认读完关闭；`keepOpen: true` 才回传可复用 `tabId`。`url`+`tabId` 会在该标签内导航。外部标签需 `allowExternalTab` |
| `browser_click` | 点击页面元素，支持 CSS 选择器、XPath、文本内容匹配 |
| `browser_fill_form` | 填写表单字段（input/textarea/select/contenteditable） |
| `browser_wait_for` | 等待元素出现或条件满足（基于 MutationObserver） |
| `browser_scroll` | 页面滚动（到顶部/底部、指定元素、指定像素偏移） |
| `browser_screenshot` | 调用 `browser.captureScreenshot` 获取截图结果 |
| `browser_cleanup_session` | 关闭本 session 仍打开的自开标签 |

## 编程 API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { readPage, clickElement, fillForm, scrollPage, cleanupTabSession } = require('./lib/api');

const browser = new BrowserAutomation('ws://localhost:18080');

// 纯读取默认会关闭自开标签，返回 tabId: null。
// 后续还要 click/fill 时必须 keepOpen，并禁用缓存以取得 live tabId。
const page = await readPage(browser, {
  url: 'https://example.com/article',
  format: 'markdown',
  noCache: true,
  keepOpen: true,
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

await cleanupTabSession(browser);
```

## CLI 命令

```bash
# 读取网页内容（默认读完关标签）
node skills/js-browser-ops-skill/index.js read "https://example.com/article" --format markdown --pretty
node skills/js-browser-ops-skill/index.js read "https://example.com/article" --keep-open --no-cache

# 读取新域名时自动加入 egressAllowlist（默认行为；可 --no-auto-allow-domain 关闭）
node skills/js-browser-ops-skill/index.js read "https://other-site.example/article" --allow-new-domain

# DOM 交互
node skills/js-browser-ops-skill/index.js interact click --tab-id 123 --selector "button.submit"
node skills/js-browser-ops-skill/index.js interact fill --tab-id 123 --selector "input[name=q]" --value "hello" --clear-first
node skills/js-browser-ops-skill/index.js interact wait --tab-id 123 --selector ".results" --timeout 10 --visible
node skills/js-browser-ops-skill/index.js interact scroll --tab-id 123 --target bottom
```

## 页面内视觉反馈（v2.2.0+）

通过 `@js-eyes/visual-bridge-kit@^0.4.0` 在每次工具调用前后注入一段 DOM overlay：
**HUD（屏幕右上角状态条）+ flash（在锚点元素周围闪一下黄/绿框）+ jsonl trace**。
浏览器里直接看到 agent 在点哪、填什么、等什么。视觉包装不改变底层 SDK 调用路径。

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
- 原生 V2 入口默认走 `enabled:true`，向后兼容。

## 工作原理

1. 通过 js-eyes 的 `openUrl` 在浏览器中打开目标页面
2. `browser_read_page` 使用 `executeScript` 注入提取脚本，在页面上下文中读取正文
3. `api.js` 将 click / fill / wait / scroll / screenshot 分别分派到 SDK 的
   `browser.click` / `browser.fill` / `browser.waitFor` / `browser.scroll` /
   `browser.captureScreenshot` 方法
4. 将结果返回给调用者

### 内容提取（browser_read_page）

使用类 Readability 算法：
- 优先查找 `<article>`、`[role="article"]`、`<main>` 等语义元素
- 回退到基于评分的候选区域选择（正文密度、ID/class 语义分析）
- 支持 markdown / text / html 三种输出格式

### API 分派

`api.js` 不再从 `browserUtils.js` 为 click / fill / wait / scroll / screenshot
生成 raw script，而是调用对应的 SDK 方法。只有 `browser_read_page` 保留正文
提取脚本生成器；这里仅描述 API 分派，不约束扩展端的具体实现语义。

## 目录结构

```text
skills/js-browser-ops-skill/
├── SKILL.md                  # 技能描述（本文件）
├── CHANGELOG.md              # 版本记录
├── package.json
├── skill.definition.js       # CLI 与 V2 入口共享的工具声明
├── index.js                  # CLI 入口
├── cli/index.js              # CLI 封装
├── bridges/
│   └── _visual-browser.js    # 站点 anchor resolver（CSS/XPath/text/url）
├── lib/
│   ├── api.js                # 业务 API（withVisual 包装）
│   ├── browserUtils.js       # browser_read_page 正文提取脚本模板
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
- 命中与未命中均在顶层返回正文业务字段、`tabId`、`_cached` 和当前
  `run.id`；默认读完关闭自开标签，因此未命中缓存时 `tabId` 也是 `null`。
  缓存命中不创建或验证 live tab，同样返回 `tabId: null`。需要后续交互时
  传 `keepOpen: true`（并建议 `--no-cache` / `noCache`）
- key 保留完整 URL（含 fragment、query 与尾斜杠），并按有效 `format` 隔离；
  URL 与 `tabId` 同时传入时不缓存，避免把运行时标签页上下文错误持久化
- 缓存条目记录 `fetchedAt` 与 `format`；cache schema v2 使旧 key 直接失效，
  避免旧 `response` 包装或历史 `tabId` 被误用
- 交互类工具（click/fill/scroll/wait/screenshot）不缓存但记录调用历史

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-browser-ops-skill/`。
