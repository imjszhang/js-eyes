# Google SERP 合约（v1）

第一版只读 `www.google.com` / `scholar.google.com` 的 DOM。不接 Custom Search API，不访问结果里的外部链接。

## Vertical → URL

实测常用参数（实现以这些为准，不向调用方暴露任意 query）：

| vertical | host + path | 识别 | 分页 |
|---|---|---|---|
| `web` | `https://www.google.com/search?q=` + `udm=14` | pathname `/search` 且无 `tbm=nws`/`tbm=isch`，或 `udm=14` | `start=0,10,20…` |
| `news` | `https://www.google.com/search?q=` + `tbm=nws` | `tbm=nws` 或 `udm=12` | `start=0,10,20…`；时间 `tbs=qdr:h\|d\|w\|m\|y` |
| `images` | `https://www.google.com/search?q=` + `tbm=isch` | `tbm=isch` 或 `udm=2` | 同页有限滚动；`start` 仅作次级 |
| `scholar` | `https://scholar.google.com/scholar?q=` | host `scholar.google.com` | `start=0,10,20…`；年份 `as_ylo`/`as_yhi`；日期排序 `scisbd=1` |

可选公共参数：`hl`（language）、`gl`（region）、`safe=active|off`。

允许导航的 host：`google.com`、`www.google.com`、`scholar.google.com`。拒绝 `consent.` / `accounts.` / `mail.` 等。

## 选择器（语义优先）

- Web：`#search h3` / `#rso h3` / `#center_col h3`，向上找 `a`；snippet 取邻近文本。
- News：同样走 `#search h3` + 邻近 source / `time`。
- Images：`#search img` / `a img`；title 用 `alt`；来源页用解包后的 `a[href]`；缩略图可用 `encrypted-tbn`。
- Scholar：`.gs_r` / `.gs_ri`，标题 `h3.gs_rt a`，cite `.gs_a`，摘要 `.gs_rs`，PDF `.gs_or_ggsm a` / `[href$=".pdf"]`。
- 混淆 class 只作末级 fallback，不作为合约字段。

## Item schema

公共字段：`rank`、`title`、`url`。

- web：`snippet`、`source?`
- news：`snippet`、`source`、`publishedAt`
- images：`thumbnailUrl`、`sourceUrl`（来源页）；不点击卡片、不追原图
- scholar：`snippet`、`cite`、`pdfUrl`、`year?`

`/url?q=` 与 `/imgres?imgurl=` 必须解包。去重键：规范化 URL。标题/snippet 截断。

## Blocker

| kind | 识别 | 行为 |
|---|---|---|
| `consent_required` | `consent.google.com`、同意标题、`#L2AGLb` | 停止，不点按钮 |
| `captcha_required` | `/sorry/`、unusual traffic、reCAPTCHA | 停止，不重试 |
| `unexpected_page` | 非 search/scholar | 失败 |
| `no_results` | 结果容器空 | 失败或空列表 |
| `dom_timeout` / `dom_unstable` | 等待失败 | 失败 |

已有 items 时：`ok: true` + `blocker` + `pageInfo.endedReason=blocker`（partial）。否则 `ok: false`。

## Envelope

`platform/toolName/vertical/query/items/pageInfo/blocker/run/ok`。
