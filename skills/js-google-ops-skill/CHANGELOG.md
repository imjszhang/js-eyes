# js-google-ops-skill

## 1.0.1

- 网页 / 新闻 `snippet` 只从单个结果卡片提取，不再把标题、来源或相邻卡片拼进摘要
- 没有描述时 `snippet` 为空；重复链接不占用 `limit`

## 1.0.0

- 首版：Google Web / News / Images / Scholar DOM-first 只读搜索
- READ 工具使用临时标签页并在结束后关闭
- INTERACTIVE `google_navigate_search` 仅 `location.assign`
- 同意页 / CAPTCHA / unusual traffic 结构化 blocker，不绕过
