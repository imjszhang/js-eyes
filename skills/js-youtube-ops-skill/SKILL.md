---
name: js-youtube-ops-skill
description: YouTube 视频读取 skill，提供视频元数据与字幕读取能力。
version: 1.0.0
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
