---
name: js-wechat-ops-skill
description: 微信公众号内容读取 skill，基于 JS-Eyes 浏览器自动化获取文章标题、作者、正文、封面和图片列表。
version: 2.0.0
metadata:
  openclaw:
    emoji: "\U0001F4F0"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-wechat-ops-skill

面向微信公众号文章详情读取的 skill。首版聚焦单篇文章，不做搜索、历史文章列表和评论区。

## 前置条件

1. JS-Eyes Server 已运行
2. 浏览器已安装 JS-Eyes 扩展并连接到服务器
3. 浏览器可正常访问微信公众号文章页面

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `wechat_get_article` | 读取微信公众号文章详情，返回标题、作者、摘要、正文、封面图和图片列表 |

## CLI

```bash
node skills/js-wechat-ops-skill/index.js article "https://mp.weixin.qq.com/s/xxxx" --pretty
```

## 编程 API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { getArticle } = require('./lib/api');

const browser = new BrowserAutomation('ws://localhost:18080');
const result = await getArticle(browser, 'https://mp.weixin.qq.com/s/xxxx');
```

## Recording

`js-wechat-ops-skill` 现已接入统一的 skill recording 底座，支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-wechat-ops-skill/`，其中包含：

- `history/`：按月滚动的调用历史 `jsonl`
- `cache/article`：文章结构化缓存
- `debug/`：调试模式下的页面步骤、DOM 统计和结果快照
