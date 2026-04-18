---
name: js-youtube-ops-skill
description: YouTube 视频读取 skill，提供视频元数据与字幕读取能力。
version: 2.0.0
metadata:
  openclaw:
    emoji: "\U0001F4FA"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-youtube-ops-skill

面向 YouTube 视频详情读取的 skill。首版聚焦视频元数据与字幕，不包含下载、音频导出和本地文件回放。

## 前置条件

1. 本机可用 `yt-dlp`
2. 若视频需要登录态，浏览器中已有可用 cookies
3. 若要扩展下载能力，后续需要 `ffmpeg`

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `youtube_get_video` | 读取视频元数据，可选同时获取字幕 |
| `youtube_get_subtitles` | 只读取字幕内容 |

## CLI

```bash
node skills/js-youtube-ops-skill/index.js video "https://www.youtube.com/watch?v=xxxx"
node skills/js-youtube-ops-skill/index.js subtitles "https://www.youtube.com/watch?v=xxxx" --pretty
```

## Recording

`js-youtube-ops-skill` 现已接入统一的 skill recording 底座，支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

该技能的 debug 语义以子进程链路为主，重点记录：

- `yt-dlp` 调用命令与参数摘要
- 每次尝试的 exit code
- stderr 摘要与 cookie fallback 情况

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-youtube-ops-skill/`。
