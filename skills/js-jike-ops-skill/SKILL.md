---
name: js-jike-ops-skill
description: 即刻内容读取 skill，提供帖子详情、图片、互动数据和评论读取能力。
version: 2.0.1
metadata:
  openclaw:
    emoji: "\U0001F4AC"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-jike-ops-skill

面向即刻单条帖子详情读取的 skill。首版只做详情页结构化输出，不提供用户动态流、话题流、搜索和发布。

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `jike_get_post` | 读取即刻帖子详情，返回正文、图片、作者、互动数据和评论 |

## CLI

```bash
node skills/js-jike-ops-skill/index.js post "https://web.okjike.com/originalPost/xxxx" --pretty
```

## Recording

`js-jike-ops-skill` 现已接入统一的 skill recording 底座，支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-jike-ops-skill/`，其中包含：

- `history/`：按月滚动的调用历史 `jsonl`
- `cache/post`：帖子详情结构化缓存
- `debug/`：调试模式下的页面步骤、DOM 统计和结果快照
