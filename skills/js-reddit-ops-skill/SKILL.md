---
name: js-reddit-ops-skill
description: Reddit 内容读取 skill，提供帖子详情、图片和评论树读取能力。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F9F5"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-reddit-ops-skill

面向 Reddit 单条帖子详情读取的 skill。首版只做详情页结构化输出，不提供 subreddit feed、搜索和用户主页。

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `reddit_get_post` | 读取 Reddit 帖子详情，返回正文、subreddit、图片和评论树 |

## CLI

```bash
node skills/js-reddit-ops-skill/index.js post "https://www.reddit.com/r/test/comments/xxxx/title/" --pretty
```

## Recording

`js-reddit-ops-skill` 现在支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- 可通过 CLI 覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-reddit-ops-skill/`，其中包含：

- `history/`：按月滚动的调用历史 `jsonl`
- `cache/`：结构化抓取结果缓存
- `debug/`：调试模式下的步骤时间线、DOM 统计与结果快照
