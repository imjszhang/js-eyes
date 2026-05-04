# Plugin system (`@js-eyes/visual-replay-hyperframes` v0.7.1+)

`jse-replay` 在 v0.7.0 把 HUD/flash 从硬编码改成 plugin 系统；v0.7.1 起 CLI 只通过 `--plugin` 加载具体效果，`--effects` **仅**保留 `auto` / `none`（mode-aware 默认 builtin 开关），不再接受 `hud,flash,all`，避免两套入口混淆。

> Plugin 只看 `events.jsonl` / timeline / 元数据，不读 `frames/*.jpg` 像素。像素层留给 hyperframes，plugin 层负责 *声明* 这一帧上要叠什么。

## 在哪写 plugin

| 位置 | 含义 |
|---|---|
| [`plugins/builtin-hud/`](builtin-hud) | 内置 plugin 1：HUD 浮层 |
| [`plugins/builtin-flash/`](builtin-flash) | 内置 plugin 2：flash 描边动画 |
| [`plugins/community/spotlight/`](community/spotlight) | reference plugin：聚光灯 |
| `<your repo>/plugins/<your-plugin>.js` | 自己的 plugin（用本地路径加载） |

## Plugin 接口

```js
module.exports = {
  name: '@my-org/my-effect',     // 必填，唯一
  version: '0.1.0',              // 必填

  // CSS / meta：拼到 <head>
  injectHead?(ctx) { return '<style>...</style>'; },

  // overlay / 节点：拼到 <body> 顶部（在 #stage 之后）
  injectBody?(ctx) { return '<div id="my-overlay"></div>'; },

  // GSAP timeline 片段：拼到 IIFE 末尾（tl 注册之前）
  // 可用变量：tl, $, $all, addClassByAnchor, removeClassByAnchor
  injectTimeline?(ctx) { return 'tl.add(function(){...}, 1.5);'; },

  // 拷贝静态资产到 composition/<to>
  collectAssets?(ctx) { return [{ from: '/abs/path/img.png', to: 'plugins/me/img.png' }]; },

  // 写到 replay-summary.json.pluginContributions[plugin.name]
  contributeSummary?(ctx) { return { runs: 3 }; },
};
```

5 个 hook 都是**同步 pure function**，按 plugin 在 CLI / `opts.plugins` 里出现的顺序执行。任何 hook throw 都会直接 fail-fast 让 `translate()` 整体失败（composition 一旦写完就不可修复）。

## Plugin Context

```ts
type PluginContext = {
  readonly session: { meta, entries };                              // 原始 events.jsonl
  readonly timeline: { hud, flash, frames, before, after, dom, relation, durationSec };
  readonly composition: { id, durationSec, viewport, outDir, snapshotMode };
  readonly config: object;                                          // --plugin-config 解析结果
  readonly logger: { warn(msg), info(msg) };                        // → stderr
};
```

`ctx.timeline.dom` 含所有 dom-bridge 事件（`navigate / locate / hover / click / typing / scroll / wait / extract`），每条都带 `tStart` / `selector` / `rect` 等结构化字段；spotlight plugin 就是消费这个字段来画聚光灯，可以照抄。

## CLI 用法

```bash
# 注册一个 plugin（按出现顺序生效）
jse-replay <session-dir> --plugin=@js-eyes/spotlight

# 加多个，按顺序叠加
jse-replay <sess> --plugin=@builtin/hud --plugin=@js-eyes/spotlight

# 私有 JSON 配置（必须是合法 JSON object）
jse-replay <sess> --plugin=@js-eyes/spotlight \
  --plugin-config '@js-eyes/spotlight={"radius":140,"tone":"cyan"}'

# 本地路径（相对 cwd 或绝对）
jse-replay <sess> --plugin=./my-plugin.js
```

## 如何引用

| id 形式 | 解析规则 |
|---|---|
| `@builtin/hud` / `@builtin/flash` | `require('<pkg>/plugins/builtin-hud')` 等内部表 |
| `@js-eyes/spotlight` | `require('<pkg>/plugins/community/spotlight')` 内部表 |
| `./foo.js`、`../bar.js` | `require(path.resolve(cwd, id))` |
| 绝对路径 | `require(id)` |
| 其他（npm 包名）| 暂不支持（v0.7.1 计划） |

## 写自己的 plugin（5 分钟版本）

1. 起一份 `__fixtures__/sample-local-plugin.js` 的 copy 改个 name
2. 在感兴趣的 hook 里 return 字符串 / array / object（不感兴趣的 hook 不写）
3. `jse-replay <sess> --plugin=./your-plugin.js --no-render --keep`
4. 打开 `<sess>/composition/index.html` 在浏览器里看效果
5. 去 `replay-summary.json.pluginContributions` 看自己 contribute 的字段

## CSS 命名约定

- **prefix**：`.your-plugin-*`（避免和别的 plugin 撞）
- **z-index 范围**：500-1100（spotlight 用 900、HUD 用 1000、watermark 用 998）
- **stage 之内** 用 `position: absolute`；**stage 之外**（fixed overlay）用 `position: fixed`
- 不强制 shadow DOM 隔离；强隔离需求留给 v0.8 major

## 示例：消费 timeline.dom 的 plugin

参见 [`@js-eyes/spotlight`](community/spotlight)。150 行总览：

```js
injectTimeline(ctx){
  const locates = ctx.timeline.dom.locate;       // 来自 events.jsonl 的 dom_locate
  const lines = [];
  for (const loc of locates) {
    if (!loc.rect) continue;
    lines.push(
      'tl.add(function(){ setSpotlight(' + JSON.stringify(loc.rect) + ', true); }, '
      + loc.tStart.toFixed(3) + ');'
    );
  }
  return lines.join('\n');
}
```

## 内置 plugin 行为

| plugin | 默认参与 |
|---|---|
| `@builtin/hud` | snapshot mode=不参与；template mode=由 `translate()` mode-aware 自动加入（无需 CLI flag） |
| `@builtin/flash` | 同上 |
| `@js-eyes/spotlight` | 永不自动启用，需 `--plugin=@js-eyes/spotlight` 显式 opt-in |

## `--effects` 与 `--plugin` 的分工（v0.7.1）

- **`--effects=auto`（默认）**：由模式决定 template 是否自动带两个 builtin（与 v0.6.0 一致）。
- **`--effects=none` / `--no-effects`**：连 template 的默认 builtin 也关掉（除非你再显式 `--plugin=...`）。
- **要 HUD/flash**：`--plugin=@builtin/hud`、`--plugin=@builtin/flash`（snapshot 上叠合成端层也一样用这个）。

不再支持 `--effects=hud,flash` / `--all-effects`。

## 不支持

- **npm 包动态加载**（`--plugin=@npm/some-pkg`）：v0.7.1 计划
- **plugin 异步 hook**（`async injectTimeline`）：v0.7.x 计划
- **plugin 修改像素帧**（覆盖 `frames/*.jpg`）：永远不会，那是 hyperframes 后处理的事
- **plugin 互相依赖**（plugin A 要 plugin B 先跑）：v0.8 major 计划

## 见也

- [主 README](../README.md) - 视觉模式 / CLI / 模板系统
- [`__fixtures__/sample-local-plugin.js`](../__fixtures__/sample-local-plugin.js) - 复制即可改的最小例子
- [`lib/pluginHost.js`](../lib/pluginHost.js) - 解析 / 调 hook 实现
- [`lib/pluginContext.js`](../lib/pluginContext.js) - ctx 工厂
