---
name: js-zhihu-ops-skill
description: 知乎内容读取 skill，提供回答与专栏详情读取能力。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F4D8"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-zhihu-ops-skill

面向知乎回答与专栏详情读取的 skill。首版只做单篇内容读取，不做问题页多回答抓取、搜索和用户主页。

## 提供的 AI 工具

| 工具 | 说明 |
|------|------|
| `zhihu_get_answer` | 读取知乎回答详情 |
| `zhihu_get_article` | 读取知乎专栏详情 |

## CLI

```bash
node skills/js-zhihu-ops-skill/index.js answer "https://www.zhihu.com/question/1/answer/2" --pretty
node skills/js-zhihu-ops-skill/index.js article "https://zhuanlan.zhihu.com/p/123456" --pretty
```
