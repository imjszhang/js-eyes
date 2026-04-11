---
name: js-xiaohongshu-ops-skill
description: 小红书内容读取 skill，提供笔记详情、图片、作者信息和评论读取。
version: 1.0.0
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
