---
name: js-jike-ops-skill
description: 即刻内容读取 skill，提供帖子详情、图片、互动数据和评论读取能力。
version: 1.0.0
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
