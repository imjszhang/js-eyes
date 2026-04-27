# 调研脚本模板

> 给"对某个话题/项目做 Reddit 深度调研"的标准三步法做模板。AI 不需要读，开发者参考。

## 三步法

```
1. batch-search   →  raw/<label>.json   (多 query × 子版 × 时间范围)
2. aggregate      →  aggregated.json    (去重 + 关键词严格过滤 + tag)
3. fetch-samples  →  sample-posts/<label>.json (代表帖完整评论树)
```

中间的 `aggregate` 是话题 specific 的，没有模板；前后两个跨话题通用，本目录提供。

## 推荐目录结构

> 约定：所有 reddit 深度调研都放 `work_dir/reddit/<topic>/`。其它平台（X/HN/...）平级开 `work_dir/<platform>/`，互不污染。

```
work_dir/reddit/<topic>/
├── run-searches.js     ← cp 自 batch-search.js
├── aggregate.js        ← 自己写：tag + 严格过滤 + topN + bySub/byTag/byMonth
├── fetch-samples.js    ← cp 自 fetch-samples.js
├── extract-essence.js  ← 可选：拍平 sample-posts 评论树 + topN 输出
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
cp skills/js-reddit-ops-skill/scripts/_templates/batch-search.js \
   work_dir/reddit/<topic>/run-searches.js
# 编辑 QUERIES（一般 12-20 条够了，太多 reddit 会限流）
node work_dir/reddit/<topic>/run-searches.js
```

模板内置：
- 串行调用，避免限流
- 用 `lib/runCliToFile` 直写 fd（绕过 Node 64KB stdout 截断）
- 自动写 `search-summary.json`

### 2. aggregate.js（话题 specific，无模板）
读 `raw/*.json`，按帖子 id 去重，加 tag，做严格过滤，输出 `aggregated.json`。
关键模式（参考 `work_dir/reddit/karpathy-autoresearch/aggregate.js`）：
```js
function tag(it) { /* 关键词 → 项目/概念 tag */ }
const STRONG = new Set(['<project-name-1>', '<project-name-2>']);
function isRelevant(it) {
  const tags = it._tags || [];
  if (tags.some(t => STRONG.has(t))) return true;
  // 弱信号需要 subreddit / 多 tag 共现作进一步限定
  return false;
}
```

注意：泛词 query（"automated research" / "AI scientist"）会带大量噪声（政治、天气、招聘"Chief AI Scientist"职位词等）。**严格过滤是关键步骤**，没它报告会被噪声污染。

### 3. fetch-samples.js
```bash
cp skills/js-reddit-ops-skill/scripts/_templates/fetch-samples.js \
   work_dir/reddit/<topic>/fetch-samples.js
# 把 SAMPLES 改为 aggregate 后选出的代表帖（一般 8-12 篇）
node work_dir/reddit/<topic>/fetch-samples.js
```

前置：浏览器里有任意已登录 reddit tab；脚本会自动 reuse，不导航。

## 已有调研示例

| 目录 | 调研对象 | 强相关帖数 |
|---|---|---|
| `work_dir/reddit/r-machinelearning-research/` | r/MachineLearning 子版总览 | — |
| `work_dir/reddit/r-machinelearning-weekly/` | 子版周热榜 | — |
| `work_dir/reddit/ai-self-evolution-research/` | AI 自我进化（综述） | 87 / 346 |
| `work_dir/reddit/ai-autoresearch-research/` | autoresearch 概念（误解） | 32 / 460 |
| `work_dir/reddit/karpathy-autoresearch/` | karpathy/autoresearch 仓库 | 169 / 420 |

它们都是手写的，发现共性后才抽出本模板。

## 常见踩坑

- **search 命中 < 实际**：reddit search 的精度有限。同义词扩写 + 子版 + 时间范围交叉是必修。
- **STORM / OPRO 类短词**：极易撞噪声。要么用 `<project> <团队/共现词>`，要么发现噪声后到 aggregate 阶段加 require-context 限制。
- **callRaw fetch 抛 "is not a valid URL"**：必须传绝对 URL（`https://www.reddit.com/...`），扩展隔离上下文没有 base origin。
- **stdout 截断在 65536 字节**：用 `lib/runCliToFile`，不要直接 `child.stdout.pipe(fs.createWriteStream)`。

更多见 `docs/dev/bridges-cheatsheet.md` 的故障排查章节。
