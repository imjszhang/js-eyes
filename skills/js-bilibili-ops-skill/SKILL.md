---
name: js-bilibili-ops-skill
description: Bilibili 视频读取 skill，提供视频元数据与字幕读取能力。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F3AC"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-bilibili-ops-skill

面向 Bilibili 视频详情读取的 skill。首版聚焦视频元数据与字幕，不包含下载、音频导出和字幕抽轨。

## 前置条件

1. 本机可用 `yt-dlp`
2. 若视频需要登录态，浏览器中已有可用 cookies
3. 若后续扩展下载能力，需要 `ffmpeg`

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `bilibili_get_video` | 读取视频元数据，可选同时获取字幕 |
| `bilibili_get_subtitles` | 只读取字幕内容 |

## CLI

```bash
node skills/js-bilibili-ops-skill/index.js video "https://www.bilibili.com/video/BVxxxx"
node skills/js-bilibili-ops-skill/index.js subtitles "https://www.bilibili.com/video/BVxxxx" --pretty
```
