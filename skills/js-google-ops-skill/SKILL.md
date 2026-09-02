---
name: js-google-ops-skill
description: Google Search 只读 + 浏览器导航 skill：网页 / 新闻 / 图片 / Scholar 走 DOM-first，READ 使用临时标签页，INTERACTIVE 仅 location.assign。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F50D"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
    platforms:
      - google.com
      - scholar.google.com
---

# js-google-ops-skill

面向 [Google Search](https://www.google.com/) 与 [Google Scholar](https://scholar.google.com/) 的**只读 + 仅改自身浏览器 URL** skill。架构对齐 `js-hn-ops-skill` / `js-reddit-ops-skill`：

- **数据获取**：READ 只解析当前浏览器页面 DOM，不接 Custom Search API，不访问结果外链
- **标签页**：READ 搜索默认开临时标签页，结束后关闭；不会切走或关闭用户已有 Google 标签页
- **安全分级**：READ + INTERACTIVE；**永不** DESTRUCTIVE，不登录自动化，不点同意按钮，不处理验证码

## 依赖与前置

- Node.js 22+、JS Eyes 2.8.5+；**JS Eyes Server** 已启动且浏览器扩展已连接
- 宿主设置 `security.allowRawEval: true` 以允许 bridge 注入
- Chrome 要求 135+；Chrome 138+ 还需开启 **Allow User Scripts**
- 公开搜索无需登录；本 skill 只读取已有登录态，不执行登录

## AI 工具

| 档位 | 工具 | 说明 |
|------|------|------|
| READ | `google_search` | 网页搜索（`udm=14`） |
| READ | `google_search_news` | 新闻；可选 `timeRange=h\|d\|w\|m\|y` |
| READ | `google_search_images` | 图片；只返回可见缩略图与来源页 |
| READ | `google_search_scholar` | Scholar；可选 `yearFrom` / `yearTo` / `sortBy` |
| READ | `google_session_state` | 是否已登录（不返回邮箱 / cookie） |
| INTERACTIVE | `google_navigate_search` | 仅 `location.assign`，`vertical=web\|news\|images\|scholar` |

公共参数：`query`、`limit`（默认 10，最大 50）、`maxPages`（默认 1，最大 5）、`language`、`region`、`safeSearch`。

统一返回：`platform / toolName / vertical / query / items / pageInfo / blocker / run / ok`。

命中同意页或 `/sorry/` / reCAPTCHA 时立即停止。已有部分结果则 `ok: true` 并带 `blocker`；否则失败。不要重试或绕过。

## CLI

```bash
cd /path/to/js-eyes/skills/js-google-ops-skill
npm install

node index.js doctor
node index.js search "nodejs" --limit 5 --pretty
node index.js news "openai" --time-range d
node index.js images "cat" --limit 8
node index.js scholar "attention is all you need" --year-from 2017
node index.js navigate-search "nodejs" --vertical web
```

内部踩点：`node index.js dom-dump`（截断 outline，不含整页 HTML）。

## 启用

```bash
js-eyes skills link /path/to/js-eyes/skills/js-google-ops-skill
js-eyes skills reload
```

## Page profiles

| profile | host | bridge |
|---------|------|--------|
| `search` | `www.google.com/search` | `__jse_google_search__` |
| `scholar` | `scholar.google.com/scholar` | `__jse_google_scholar__` |

Web / News / Images 共用 `search` profile，用 `tbm` / `udm` 区分 vertical。

## 明确不做

- 不接 Google Custom Search JSON API / Workspace / Gmail / Drive / Calendar
- 不自动登录、不点同意、不处理 CAPTCHA
- 不点击图片卡片追原图，不打开结果外链
- 不写入任何 Google 业务数据
