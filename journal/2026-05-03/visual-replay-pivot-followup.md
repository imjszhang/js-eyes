# 从「vi 效果调研」到「Hyperframes 架构换骨」：一次会话的完整演进

> 日期：2026-05-03（会话本身横跨多日，本日记为收口归档）
> 项目：js-eyes（`@js-eyes/visual-bridge-kit` / `@js-eyes/visual-replay-hyperframes` / `js-reddit-ops-skill` / `js-browser-ops-skill` / `@js-eyes/server-core`）
> 类型：架构设计 + 升级迁移 + 调研分析
> 来源：Cursor Agent 对话

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [分析过程：对话的七个阶段](#2-分析过程对话的七个阶段)
3. [方案设计与关键决策](#3-方案设计与关键决策)
4. [实现要点](#4-实现要点)
5. [验证与测试](#5-验证与测试)
6. [后续演化](#6-后续演化)

---

## 1. 背景与动机

会话起点是用户对比 `js-newidea-cli-test`（一个已有 vi 效果的演示项目）后提的一句话：

> 「分析 `@skills/js-reddit-ops-skill`，里面有没有类似 `js-newidea-cli-test` 那种 vi 效果？」

这句话的真实诉求并不是"调研有没有"，而是**想把同款"页面里能直观看到 agent 在干嘛"的视觉反馈引入 reddit-skill**，并且要求**未来其它技能也能复用**。会话从这里出发，一路演进出三件事：

1. **抽出 `@js-eyes/visual-bridge-kit`**：把 vi 效果（HUD / flash / relate 线）从 reddit-skill 里抽成跨技能可复用的桥；
2. **调研整合 Hyperframes**：把运行时的视觉痕迹离线渲成 MP4 视频；
3. **架构换骨（post-2.7.0 in-place pivot）**：把视频渲染从「PNG 截图 + DOM 测量坐标 overlay」彻底切到「agent payload + HTML 模板渲染」，版本号原地不动。

这份日记按对话推进的顺序复盘——重点不是某一行代码，而是**问题如何被发现、方案如何被挑战、架构如何被推翻又重建**。

## 2. 分析过程：对话的七个阶段

### 阶段 ①：vi 效果调研与可复用桥设计

| 用户提问 | 对话产出 |
| ---- | ---- |
| 「reddit-skill 里有没有类似 vi 效果？」 | 给出现状盘点：reddit-skill 已有 visualHint schema 雏形但没实际页面注入 |
| 「我还是需要引入 vi 效果……所以不管是不是 dom 模式，我都需要这个系统」 | 提出三层设计：bridge 层（页内 DOM/CSS 注入）+ Node 端 wrap（dispatch-edge hook）+ 声明式 hint schema |
| 「未来给其它技能也能复用，制定实施计划」 | 输出 Phase 1（MVP）+ Phase 2（完整版）实施计划，明确"reddit-skill 是首个消费方，browser-ops 是第二个验证可复用性的样本"|

**关键转折**：用户从一开始就把"未来其它技能复用"作为硬约束，倒逼方案不能写死成 reddit 专属 —— 这直接定义了后续 `visual-bridge-kit` 作为 monorepo 独立包的拓扑。

### 阶段 ②：browser-ops 复用同一套桥

用户说「思考把视觉模块加到 `js-browser-ops-skill`，先说下思路」。这是对阶段 ① 通用性主张的第一轮压力测试。

挑战点：browser-ops 6 个工具（read/click/scroll/fill_form/wait_for/screenshot）语义和 reddit 完全不同。结论：

- `visual-bridge-kit` 的 `wrapInjectCall` 接口足够通用，**复用零改动**；
- 各 skill 自己写 `visualHint.js`（声明 `kind` / `label` / `anchor` / `relate` / `tone`）；
- `--visual` / `--visual-record` CLI flag 由 `cliVisualFlags.js` 共享解析逻辑。

跑完后用户「检查并测试下 browser-ops」——确认 firefox 和 chrome 扩展两端的 RPC 路径都通了。

### 阶段 ③：Hyperframes 调研——「能不能把操作录屏下来？」

用户给了 `https://github.com/imjszhang/hyperframes` 的链接，问是否能整合做录像。

经过两轮调研对话（"说下思路 → 这个设计以后可以给任意其它技能用吗 → 制定实施计划"），最终确认的设计原则是 **三层解耦**：

```
[运行时录制]              [离线翻译]                    [离线渲染]
visual-bridge-kit         visual-replay-hyperframes      hyperframes (上游)
events.jsonl + frames →  composition.html (GSAP)    →   MP4
```

关键决定：录制层只产出 **session bundle**（`meta.json + events.jsonl + frames/<ts>.png`）这种**与 hyperframes 完全解耦**的中间格式；翻译层是个纯函数，将来谁想换播放器都行。

### 阶段 ④：[决策点] captureFrame RPC 来源选型

用户主动点出"Phase 2 captureFrame RPC 来源选型（plan 显式 [决策点]）"——这是计划里明确标注需要用户拍板的地方。

| 候选 | 优点 | 缺点 | 决策 |
| ---- | ---- | ---- | ---- |
| `chrome.tabs.captureVisibleTab` | 跨 chrome/firefox 统一 API、视口截图、不需 DOM 暂停 | 只截可见区域 | **选这个** |
| `chrome.debugger.captureScreenshot` | 可截全页（含 scroll） | 需要 debugger 权限、用户态会弹 banner | 否 |
| 页内 `html2canvas` | 纯前端 | 性能、字体/iframe 各种坑 | 否 |

理由：可见区域的 1:1 截图对"展示 agent 当下视觉"已经足够，而扩展权限保持最小。

### 阶段 ⑤：升级到 2.7.0 + 端到端测试

「将项目的版本都升级到 2.7.0」是一次跨包协调升级——core 包统一到 2.7.0，experimental / skill 包保留各自语义化版本。然后用户在 firefox 装好新插件「再测试下」，跑完一次 reddit list-subreddit 录制 + 离线翻译 + hyperframes render + MP4 输出，确认主链路全通。

期间踩到几个**视频可看性 bug**（已在阶段内修复，作为路标记录）：

| 现象 | 根因 | 修复 |
| ---- | ---- | ---- |
| 视频黑屏 | `translator.js` 生成 `style="background-image: url("...")"` 双引号嵌套，CSS 解析失败 | 改单引号 |
| Timeline 不播 | `timeline.js` 给 frame clip 算出负 `data-start`（被跳过的 `tab_not_active` 截图仍写元数据） | `collectFrameClips` 过滤 `ts < startMs` + `fs.existsSync` |
| `gsap_infinite_repeat` warn | `repeat: -1` 破坏可重放确定性 | 主时间轴 `paused: true`，无限循环只在 standalone preview 兜底 |
| `overlapping_clips_same_track` | flash clip 固定时长撞下一个 | `duration = Math.min(0.6, next.ts - HUD_NUDGE_SEC)` |

至此 PNG 链路看似完工，用户也确认「baseline 存起来」。

### 阶段 ⑥：用户的三连击——把整个架构推翻

这是会话的**真正分水岭**。用户连续三句话推动了架构换骨：

> ① 「`http://127.0.0.1:8765/index.html?v=3` 看这个视频效果，感觉还有很大问题」
>
> ② 「最主要的问题，屏幕尺寸问题导致，visual 的效果，在截图上的位置都错乱了」
>
> ③ 「你用截图来实现我觉得有问题，因为截图里内容不是全部都需要的，**Hyperframes 不是应该全用 html 来实现吗**」

我的初次反应是从**技术细节角度解释**：「这不是缩放 bug，PNG 是 1:1 录的、坐标也对，问题是 reddit 宽屏 DOM 里 bridge 选了语义错的锚点（"幽灵元素"）」。但这是把锅推给"运行时锚点选择不准"——技术上没错，但完全没接住用户更深层的问题。

用户第三句话才把真正的反对意见亮出来——**「截图里内容不是全部都需要的」**。这一刀切到了架构本身：

- 截图天然带噪声（reddit 边栏广告、推荐 sub 列表、评论区 floating bar），这些**视频根本不需要**；
- 屏幕尺寸 / DOM reflow 一旦变化，"DOM 测量得到的 rect" 在 replay 时就和背景图错位；
- Hyperframes 本来就是个 HTML 渲染框架，给它喂 PNG 是把刀子当螺丝刀使。

我列了三条路：A 全 HTML 数据驱动 / B 维持 PNG / C 混合。用户的回复极简：

> 「**是架构换骨，但不改变版本，按你建议的方案来，制定实施计划。**」

这十六个字定调了整个 pivot：

| 维度 | 决定 |
| ---- | ---- |
| 架构 | A 路线（全 HTML 数据驱动） |
| 版本号 | **原地不动**，只是 in-place 行为切换 |
| PNG 链路 | 主链路下线，代码降级到 `visual-bridge-kit/dev` 子路径 |
| 模板范围 | 这一轮**只接 reddit**，browser-ops 走通配兜底 |

### 阶段 ⑦：架构换骨实施 + 收尾检查 + 概念澄清

实施 22 项任务（详见 plan），核心动作：

1. `events.jsonl` 增加 `payload` 字段，移除 `viewport` / `anchor.rect` / `frameRef`；
2. `visual-bridge-kit` 暴露 `hooks.extractPayload(resp, hint, err)` 钩子，让 skill 把结构化业务数据塞进 trace；
3. `visual-replay-hyperframes` 新增 `templates/registry.js` + `templates/reddit/{list,item,tree,global,navigation}.js`；
4. `composition.html` 渲响应式 reddit 卡片（`vw` / `clamp` / `max-width`），flash 改为 `[data-anchor-id]` 上的 CSS class toggle；
5. `--redact-*` / `--visual-record-frames` / `--visual-frames-throttle` / `--width` / `--height` / `--frames-debug` 仍解析但 stderr 一行 deprecation；
6. `makeFrameWriter` / `writeFrameSync` / `buildFrameRef` / `attachFrameRefsToEvents` 迁到 `@js-eyes/visual-bridge-kit/dev`；
7. 新基线 `__fixtures__/sess-reddit-list-html/`，老 `sess-firefox-2.7.0/` 作为 dev/ 回归基线归档；

实施完用户「检查一遍看看还有什么问题」+「`@skills/js-browser-ops-skill` 更新了吗」，催生了三处收尾修复：

| 类别 | 文件 | 问题 → 修复 |
| ---- | ---- | ---- |
| 运行时崩溃 | `skills/js-browser-ops-skill/lib/api.js` | 还在 require 已迁走的 `makeFrameWriter` → 改纯 `wrapInjectCall`、移除 `frames` / `redact` 字段 |
| CLI 静默 | `skills/js-browser-ops-skill/lib/cliVisualFlags.js` | `--visual-record-frames` 等不被解析、走不到 deprecated 分支 → `applyVisualArgs` 增量解析 + `warnDeprecatedFlagsOnce` 一次性 stderr 警告 |
| 文档脱节 | `SKILL.md` × 2 / `CHANGELOG.md` × 2 / `RELEASE_NOTES.md` | 没有 post-2.7.0 提示 → 全部补 pivot 段 |

最后用户连问三个递进问题，逼我把"模板"这个概念讲透：

> 「专属 html 模板是什么意思」  
> 「这个模板是在什么时候创建和使用的？」  
> 「所以模板其实是在录制的时候创建的对吗，因为每次录制的网站是不一样的」

第三问是最关键的误解纠正点。澄清结论用一张表锁死：

| 概念 | 对应物 | 何时存在 | 谁产生 |
| ---- | ---- | ---- | ---- |
| **模板（renderer）** | PPT 母版 / Excel 列定义 | **写代码时（一次性）** | 工程师手写 `.js` 提交 git |
| **payload（数据）** | 每页 PPT 的字 / 每行 Excel | **每次录制时** | skill 的 `extractPayload` 钩子 |
| **HTML 卡片** | 渲染好的成品 | **离线翻译时** | `renderer(ctx)` 套模板 |

模板**与录制网站的具体内容无关**，只与"该 skill 的某个操作 kind 应该长什么样"有关；变的永远是 payload。

## 3. 方案设计与关键决策

### 关键决策

| # | 决策点 | 选择 | 理由 |
| ---- | ---- | ---- | ---- |
| D1 | vi 效果是否抽公共桥 | **抽** `@js-eyes/visual-bridge-kit` | 用户硬要求"未来其它技能复用" |
| D2 | hint 配置形态 | **声明式 schema**（`kind`/`label`/`anchor`/`relate`/`tone`/`dataExtractor`） | 比命令式 API 更利于跨 skill 标准化 |
| D3 | Hyperframes 整合层次 | **三层解耦**（录制 / 翻译 / 渲染） | 录制中间格式与播放器无关，将来可换 |
| D4 | captureFrame RPC | **`chrome.tabs.captureVisibleTab`** | 跨浏览器统一、视口足够、权限最小 |
| D5 | 2.7.0 版本协调 | **core 统一 / skill 各自语义化** | core 是部署单元，skill 是独立产品 |
| D6 | PNG 还是 HTML（pivot） | **A 全 HTML 数据驱动** | 截图带噪、坐标随尺寸漂移、Hyperframes 本是 HTML 框架 |
| D7 | pivot 是否升版本号 | **不升，in-place** | 用户明确"架构换骨但不改变版本" |
| D8 | 模板覆盖范围（首轮） | **只 reddit 5 + 1 个 kind** | browser-ops 模板差异大，留下个 minor 单独做 |
| D9 | PNG 旧代码去留 | **不删，迁到 `/dev` 子路径** | 留 dev/debug 通道，主链路不自动启用 |
| D10 | 老 fixture 处理 | **保留为 PNG-mode archived baseline** | 跑回归用，新 baseline 是 `sess-reddit-list-html/` |
| D11 | 显示 / 录制是否解耦 | **触发同源、输出独立、开关独立**（三个层面分别处理） | 见下文 §4.3，避免把一根管子的两个出口当成两根独立管子 |
| D12 | vi 显示效果可扩展性 | **七层定制点**：CLI → hint schema → 站点覆盖 → runtime API → 调色板 → CSS → bridge 主体 | L2+L3 是 90% 新 skill 的扩展路径，越往下层改动越重；见下文 §4.4 |

## 4. 实现要点

### 项目结构（pivot 后）

```
js-eyes/
├── packages/
│   ├── visual-bridge-kit/                 # 0.4.x
│   │   ├── index.js                       # 主链路：wrapInjectCall / wrapCallApi / appendVisualSession
│   │   ├── bridge/visual.common.js        # in-page 注入：HUD + flash + relate（VERSION='0.3.0' 强制重装）
│   │   ├── styles/                        # CSS animations
│   │   ├── node/                          # readVisualSession / appendVisualTrace
│   │   └── dev/                           # PNG 旧通道：makeFrameWriter / attachFrameRefsToEvents
│   └── visual-replay-hyperframes/          # 0.2.x
│       ├── lib/
│       │   ├── translator.js              # session bundle → composition.html
│       │   ├── timeline.js                # GSAP 时间轴
│       │   ├── hudClips.js / styleEmbed.js / timelineScript.js
│       │   └── escape.js
│       ├── templates/
│       │   ├── registry.js                # register / getTemplate（三层兜底）
│       │   └── reddit/{index,list,item,tree,global,navigation,cardTemplate}.js
│       └── __fixtures__/
│           ├── sess-reddit-list-html/     # 新 A-route baseline
│           └── sess-firefox-2.7.0/        # 旧 PNG-mode archived
└── skills/
    ├── js-reddit-ops-skill/               # 3.6.x
    │   ├── lib/visualHint.js              # 含 extractPayload(resp, hint, err)
    │   └── bridges/*.js                   # VERSION='3.5.1' 触发 bridge 重装
    └── js-browser-ops-skill/              # 2.3.x
        ├── lib/api.js                     # 主链路去 PNG 化
        ├── lib/cliVisualFlags.js          # warnDeprecatedFlagsOnce
        └── scripts/{browser-read,browser-interact}.js
```

### 关键模块

| 文件 | 职责 |
| ---- | ---- |
| `visual-bridge-kit/index.js` | dispatch-edge hook（`wrapCallApi` / `wrapInjectCall`），含 `hooks.buildSummary` / `hooks.extractPayload` 两个抽业务数据的钩子 |
| `visual-bridge-kit/bridge/visual.common.js` | 浏览器端注入。VERSION 不一致强制重装，避免 firefox 长 tab 缓存老 bridge |
| `visual-replay-hyperframes/templates/registry.js` | `(skillId, kind) → renderer` 路由，三层兜底：精确 → `('*', kind)` → `('*', 'global')` |
| `visual-replay-hyperframes/lib/translator.js` | 离线翻译入口：`require('../templates/reddit')` 副作用注册 → `buildCards()` 配对 before/after → `getTemplate().renderer(ctx)` 渲卡 |
| `js-reddit-ops-skill/lib/visualHint.js::extractPayload` | 把 reddit response（list/post/comments/user/inbox）抽成结构化 `payload`，与模板 schema 对齐 |
| `js-browser-ops-skill/lib/cliVisualFlags.js::warnDeprecatedFlagsOnce` | deprecated flag 一次性 stderr 警告（模块级 Set 去重） |

### 显示与录制的关系（pivot 后澄清）

会话末段用户问了一句"现在 visual 显示和录制是不是互相独立的"，逼我把这条架构性质讲清楚。**精确答案是「触发同源、输出独立、开关独立」，不能粗略说"独立"。**

#### 数据流：一根管子两个出口

```
Node 端 wrapCallApi / wrapInjectCall
  ↓
  ① callRaw(buildBeforeExpression(hint))
     → 浏览器执行 window.__jse_visual.before(hint)
          ├─→ flashElement / showHud / staggerFlashItems   【显示出口：DOM 操作】
          └─→ emit({type:'before', kind, label, anchor})    【录制出口：写 ring buffer】
  ↓
  ② fn() 跑业务（reddit API call / executeScript）
  ↓
  ③ callRaw(buildAfterExpression(hint, summary))
     → 浏览器执行 window.__jse_visual.after(hint, summary)
          ├─→ flashElement(success/error) / flashRelation     【显示出口】
          └─→ emit({type:'after', kind, label, anchor, payload}) 【录制出口】
  ↓
  ④ drainEvents() —— 仅当 --visual-record 时才调，把 ring buffer 取回 Node
  ↓
  ⑤ appendVisualSession → 写 events.jsonl
```

`bridge/visual.common.js` 的 `before(hint)` 和 `after(hint, summary)` 函数**同时干两件事**：操作 DOM 让眼睛看见 + 调 `emit()` 把同一份事件推进 ring buffer。这两个副作用互不知道对方存在。

#### 三个维度的独立性

| 维度 | 独立性 | 说明 |
| ---- | ---- | ---- |
| **事件源** | **不独立** | 共用 `before/after` 函数被 Node 端 wrap 触发的同一时刻 |
| **输出端** | **独立** | DOM 副作用 vs ring buffer 副作用，两条路互不干扰 |
| **开关** | **独立** | 显示和录制可以分别开关（除总闸 `enabled=false` 外） |

#### 四种典型组合

| 场景 | flag 组合 | 显示 | 录制 |
| ---- | ---- | ---- | ---- |
| 只看不录（开发调试） | `--visual` | ✅ | ❌（事件写 ring buffer 但没人取走，最多 200 条溢出） |
| 只录不看（CI / headless） | `--visual --visual-record runs/foo` + headless | ✅（无人看） | ✅ |
| 看 + 录（演示出视频） | `--visual --visual-record runs/foo` | ✅ | ✅ |
| 完全关闭（最大性能） | `--visual=false` | ❌ | ❌ |

#### 仍存在的耦合点

`config.enabled = false` 是**总开关**——`bridge.before/after` 第一行就 `if (!state.config.enabled) return false;`，关掉显示会同时关掉录制。这是有意的设计选择：关掉显示场景下用户基本不会想录（视频源就是显示内容）。

如果将来有需求"完全无显示但要录制"（比如静默监控），需要新加一个 `--visual-mode silent` 让 emit 走但不画 DOM，目前做不到。

### vi 显示效果的扩展契约（七层定制点）

会话末段用户问"这套系统可以自定义各种 vi 显示效果吗？"——可以，但**改起来由轻到重分七层**，不同层适合不同角色和场景。这是这套系统对外的扩展契约。

#### 浏览器内 vi 的七层

| 层 | 定制方式 | 改什么 | 谁改 | 例子 |
| ---- | ---- | ---- | ---- | ---- |
| **L1 CLI flag** | 命令行 | 运行时旋钮 | 终端用户 | `--visual-mode hud` 只 HUD 不闪框 |
| **L2 hint schema** | skill 业务侧声明 | 每次工具调用的 vi 语义 | skill 作者 | `kind:'list', tone:'success'` |
| **L3 站点级覆盖** | `_visual-<site>.js` | anchor 解析 / 列表呼吸演出 | skill 作者 | 把 `t3_xxx` 解析到 `<shreddit-post>` |
| **L4 runtime API** | 调 `window.__jse_visual.*` | 自定义剧本式演出 | 进阶 skill 作者 | `announceStage`+`flashElement`+`showHud` 多段动画 |
| **L5 TONE 调色板** | `TONE_MAP` 三处同步 | 颜色基调 | 包维护者 | 暗色 / 品牌色 |
| **L6 内联 CSS** | `ensureRoot()` 内 style 字符串 | 框/线/点/HUD 形状、动画 | 包维护者 | 改 pulse 曲线、HUD 位置 |
| **L7 bridge 主体** | 改 `before/after` 函数 | 新增 hint.kind / 全新动作 | 架构层 | 加 `kind:'progress'` 进度条演出 |

##### L1 暴露的旋钮

```bash
--visual                             # 总开关
--visual-mode auto|dom|hud|both|off  # 显示模式
--visual-detail compact|staged       # 详细级别
--visual-ms 420                      # flash 持续 120-4000ms
--visual-list-stride 90              # 列表呼吸步长
--visual-prefix __foo_               # DOM id 前缀（多 skill 共存）
```

##### L2 hint schema 字段

```javascript
{
  kind: 'item' | 'list' | 'tree' | 'global' | 'navigation' | 'write',
  toolName, label, target, detail,
  anchor: string | { selector } | object,
  tone:  'pending' | 'success' | 'danger' | 'info' | 'warn',
  relate: [{ from, to, label }],   // tree 类型用，连两个 anchor
}
```

##### L3 两个站点覆盖点

```javascript
window.__jse_visual.setSiteAnchorResolver(spec => Element | null);
window.__jse_visual.setSiteStaggerFlashItems({ items, stride, label, tone });
```

reddit 的 `bridges/_visual-reddit.js` 是参考实现，新 skill 抄一份改解析逻辑就接上整套视觉。

##### L4 浏览器端 runtime API

```javascript
window.__jse_visual.flashElement(el, { tone, label, durationMs })
window.__jse_visual.flashRelation(fromEl, toEl, { tone, label })
window.__jse_visual.showHud({ action, target, detail, status })
window.__jse_visual.announceStage({ stage })  // 'locate'|'execute'|'respond'|'verify'
window.__jse_visual.cleanup()
```

绕过 wrap 机制可以写"locate → verify → announce"的多段剧本。

##### L5 三处同步点

| 文件 | 用途 |
| ---- | ---- |
| `bridge/visual.common.js::TONE_MAP` | 浏览器运行时 |
| `node/visualPalette.js` | Node 端共享给离线渲染 |
| `styles/visual-runtime.css` | 离线 composition 渲染 |

包顶部有大段注释专门强调三处一致性约束。

#### 离线视频侧的另外三层（与浏览器侧正交）

视频卡片本身也是 vi 的一部分，可定制点独立：

| 维度 | 文件 | 改什么 |
| ---- | ---- | ---- |
| **HTML 模板** | `templates/<skill>/<kind>.js` | 卡片结构（reddit list 渲 8 帖卡 / tree 渲缩进评论） |
| **卡片 CSS** | `lib/styleEmbed.js` | 配色、字号、阴影、响应式断点 |
| **GSAP 入场动画** | `lib/timelineScript.js` | 卡片如何进出场、时间轴衔接 |

这三处和浏览器侧 7 层正交——改浏览器内 vi 不影响视频卡片，反之亦然。

#### 推荐扩展路径

| 场景 | 走哪几层 | 工作量 |
| ---- | ---- | ---- |
| 给新 skill 接入 vi | L2 + L3（+ 离线 HTML 模板） | 1-2 天 |
| 做差异化"剧本式"演出 | L4 + L1 多档预设 | 半天 |
| 全局换基调（暗色 / 品牌色） | L5 三处同步 | 半天 |
| 加新动作类型（进度条 / 弹窗） | L7 必须改包，建议同时引入 `kind` 注册表 | 一个 minor |

L7 是当前架构的**最大短板**——加新 `kind` 没有插件机制，必须改 `before/after` 主体。下一个 minor 值得参照离线 `templates/registry.js` 的设计，把 L7 改成 L3 级别的可注册扩展点（`registerKindHandler('progress', ({ hint, summary }) => ...)`），让"加新视觉动作"从架构层下沉到 skill 层。

## 5. 验证与测试

| 验证项 | 命令 / 方式 | 结果 |
| ---- | ---- | ---- |
| 主测试套 | `npm test` | 251 / 251 ✅ |
| `js-x-ops-skill` 测试 | `cd skills/js-x-ops-skill && npm test` | 26 / 26 ✅ |
| reddit 三个核心 smoke | `list-subreddit` / `search` / `subreddit-about` | `events.jsonl` 含 `payload`、不含 `viewport` / `anchor.rect` ✅ |
| browser-ops smoke `--visual-record` | `node skills/js-browser-ops-skill/scripts/browser-read.js ... --visual-record /tmp/sess-bo` | 不再崩溃，写出 `meta.json + events.jsonl`、无 `frames/` 目录 ✅ |
| Hyperframes lint | 3 个主 fixture 跑 `hyperframes lint` | 0 errors（仅文件大小 1 个 warning）✅ |
| 老 fixture 兼容 | `__fixtures__/sess-firefox-2.7.0/` 喂新 translator | HUD-only 优雅降级，`cards: 1`、`totalDataItems: 0` ✅ |
| deprecated flags | browser-ops 各 CLI 加 `--visual-record-frames` 等跑 | stderr 一行 deprecation ✅ |
| 残留代码扫描 | `rg 'makeFrameWriter\|frameRef\|anchor\.rect\|viewport\.\|redact'` 主链路 | 0 残留 ✅ |
| firefox 端到端 | 真插件 + 真 reddit 录制 + 翻译 + 渲染 | MP4 输出，卡片可见 ✅ |

## 6. 后续演化

### 短期（下一个 minor）

`templates/browser-ops/` 包，给 browser-ops 6 个工具写专属模板：

| 工具 | 期望卡片 |
| ---- | ---- |
| `browser_read_page` | markdown 抓取预览 + URL + 字数 + 耗时 |
| `browser_click` | "点击 `<button.submit>` (matched 1 of 3)" + selector + 点击坐标 hint |
| `browser_fill_form` | input 演示卡 + 字符数 + clearFirst |
| `browser_wait_for` | 等待条件 `false → true (1234ms)` 进度条 |
| `browser_scroll` | 滚动方向 + 距离 + 容器小图 |
| `browser_screenshot` | 拍照图标 + 视口尺寸 + 文件大小 |

同步给 `skills/js-browser-ops-skill/lib/visualHint.js` 加 `extractPayload`，定义 payload schema 与模板字段对齐。

### 中期

- 把 `extractPayload` 钩子能力下沉到 visual-bridge-kit 的标准接口；
- `templates/registry.js` 加 `validatePayload(skillId, kind, payload)` schema 校验；
- **vi 显示效果 L7 → L3 化**：参照 `templates/registry.js` 的设计，给 `bridge/visual.common.js` 引入 `registerKindHandler(kind, ({ hint, summary, ctx }) => void)` 注册表，让"加新动作类型"（progress / modal / overlay 等）从改包架构层下沉到 skill 层。这是 §4.4 七层定制中目前唯一**没有插件机制**的环节；
- 增加 `--visual-mode silent`：让 emit 走但 DOM 不画，解锁"无显示但要录制"的 CI / 监控用例；
- 文档：在 `packages/visual-replay-hyperframes/README.md` 加"为新 skill 实现专属模板"的标准操作流程。

### 长期方向

- 多 skill 模板包的版本协调机制（payload schema 演进时如何兼容老 session）；
- 模板的可视化预览工具（不依赖完整录制即可在浏览器调模板的 sandbox 模式）；
- 模板渲染从字符串拼接升级到组件化（权衡模板包体积 vs 维护性）；
- vi 调色板系统化：把 L5 三处同步点统一到一份 `tone.json` 单一源（`TONE_MAP` / `visualPalette.js` / `visual-runtime.css` 都从这里生成），消除"忘了同步其中一份"的隐患。

---

## 后记：用户在这场对话里推动了什么

通读整场对话能看到三次"用户挑战 → 架构跃迁"的清晰节奏：

| 节点 | 用户的话（简） | 推动结果 |
| ---- | ---- | ---- |
| ① | 「未来给其它技能也能复用」 | 把 vi 效果抽出 `visual-bridge-kit`，奠定可复用桥的基础 |
| ② | 「能不能录屏下来」 | 引入 Hyperframes，三层解耦设计 |
| ③ | 「Hyperframes 不是应该全用 html 来实现吗」 | 推翻 PNG 主链路，HTML 数据驱动 pivot |

第三次挑战是技术上最有杀伤力的——它没有谈实现细节，而是质问"**用截图来实现这件事本身是不是错的**"。这一击之所以致命，是因为它拒绝接受"运行时锚点选错就是当时浏览器真实情况"的辩解，要求**视频的内容应该由 agent 知道的事实生成，而不是浏览器看见的像素**。这是从 WYSIWYG（所见即所得）到 AYAYS（所知即所演）的范式转变。

设计上这条对话还沉淀出一条值得记下的工程原则：

> **用户能不能用，比技术上对不对重要。** 当用户说"看着乱"，不要急着用"DOM 测量是对的"去说服他；要回到他说的"乱"是什么——通常那是架构层面的设计问题，不是代码 bug。

下一次再遇到"看着不对"的反馈时，先问一遍："是细节实现问题，还是架构方向问题？" 走完这一轮检查再回去答辩，能省一大圈无效迭代。

---

> 同主题往期：架构换骨主战役见 `CHANGELOG.md` 的 `### Architecture pivot (post-2.7.0, in-place)` 子节、`RELEASE_NOTES.md` 的 `### Pivot note` 段。
