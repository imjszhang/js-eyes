---
name: js-xiaohongshu-ops-skill
description: 小红书内容读取 skill，提供笔记详情、图片、作者信息和评论读取。
version: 2.0.1
metadata:
  openclaw:
    emoji: "\U0001F338"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-xiaohongshu-ops-skill

面向小红书单篇笔记读取的 skill。首版聚焦详情页与评论，不提供搜索、用户主页、话题流和发布能力。

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `xhs_get_note` | 读取小红书笔记详情，返回正文、图片、作者信息和评论 |

## CLI

```bash
node skills/js-xiaohongshu-ops-skill/index.js note "https://www.xiaohongshu.com/explore/xxxx" --max-comment-pages 2 --pretty
```

## Recording

`js-xiaohongshu-ops-skill` 现已接入统一的 skill recording 底座，支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-xiaohongshu-ops-skill/`，其中包含：

- `history/`：按月滚动的调用历史 `jsonl`
- `cache/note`：包含评论抓取参数维度的结构化结果缓存
- `debug/`：调试模式下的页面步骤、DOM 统计和结果快照
