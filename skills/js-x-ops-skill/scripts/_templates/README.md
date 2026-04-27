# 调研脚本模板（X 版）

> 给"对某个话题/项目做 X.com 深度调研"的标准三步法做模板。AI 不需要读，开发者参考。

## 三步法

```
1. batch-search   →  raw/<label>.json   (多 query × sort × 时间范围)
2. aggregate      →  aggregated.json    (去重 + 关键词严格过滤 + tag)
3. fetch-samples  →  sample-posts/<label>.json (代表推完整字段+回复)
```

中间的 `aggregate` 是话题 specific 的，没有模板；前后两个跨话题通用，本目录提供。

## 推荐目录结构

> 约定：所有 X 深度调研都放 `work_dir/x/<topic>/`。其它平台（reddit/HN/...）平级开 `work_dir/<platform>/`，互不污染。

```
work_dir/x/<topic>/
├── run-searches.js     ← cp 自 batch-search.js
├── aggregate.js        ← 自己写：tag + 严格过滤 + topN + byAuthor/byTag/byMonth
├── fetch-samples.js    ← cp 自 fetch-samples.js
├── extract-essence.js  ← 可选：拍平 sample-posts 回复树 + topN 输出
├── REPORT.md           ← 写给人/AI 看的最终报告
├── search-summary.json
├── aggregated.json
├── essence.txt         ← 可选
├── raw/                ← run-searches 产物
└── sample-posts/       ← fetch-samples 产物
```

## 使用

### 1. batch-search.js
```bash
cp skills/js-x-ops-skill/scripts/_templates/batch-search.js \
   work_dir/x/<topic>/run-searches.js
# 编辑 QUERIES（建议 8-15 条；X 限流偏严，太多容易触发 429）
node work_dir/x/<topic>/run-searches.js
```

模板内置：
- 串行调用，避开 X 限流
- 用 `lib/runCliToFile` 直写 fd（绕过 Node 64KB stdout 截断）
- 自动写 `search-summary.json`

### 2. aggregate.js（话题 specific，无模板）
读 `raw/*.json`，按 tweetId 去重，加 tag，做严格过滤，输出 `aggregated.json`。
关键模式：
```js
function tag(t) { /* 关键词 → 项目/概念 tag */ }
const STRONG = new Set(['<project-name-1>', '<project-name-2>']);
function isRelevant(t) {
  const tags = t._tags || [];
  if (tags.some(x => STRONG.has(x))) return true;
  // 弱信号需要 author / 多 tag 共现作进一步限定
  return false;
}
```

注意：X 的 search query 会受时区/语言/关注图影响，命中量与浏览器登录账号相关。
泛词 query（"AI agent" / "autonomous"）会带大量噪声（广告号、转推机器人）。
**严格过滤是关键步骤**，没它报告会被噪声污染。

### 3. fetch-samples.js
```bash
cp skills/js-x-ops-skill/scripts/_templates/fetch-samples.js \
   work_dir/x/<topic>/fetch-samples.js
# 把 SAMPLES 改为 aggregate 后选出的代表推（一般 8-12 条）
node work_dir/x/<topic>/fetch-samples.js
```

前置：浏览器里有任意已登录 X tab；脚本会自动 reuse，不导航。
模板用 Session::callApi 复用同一个 bridge 实例，N 条样本翻几秒。

## 常见踩坑

- **search 命中 < 实际**：X search 受语言/时区/账号订阅影响极大。同义词扩写 + lang + from 限定 + 时间范围交叉是必修。
- **GraphQL queryId 失效**：bridge 会自动重新 discover 并 invalidate cache，但首次失败可能丢一页结果，重跑即可。
- **429 连续 3 次 → 暂停 5 分钟**：bridge 内置保护，触发后整个 Session 静默 5 分钟；建议把矩阵改小或拉长间隔。
- **stdout 截断在 65536 字节**：用 `lib/runCliToFile`，不要直接 `child.stdout.pipe(fs.createWriteStream)`。
- **TweetDetail 拿不到隐藏回复 / Sensitive**：bridge 用当前账号 cookie，登录态决定可见性；切到目标号再跑。

更多见 `docs/dev/bridges-cheatsheet.md` 的故障排查章节。
