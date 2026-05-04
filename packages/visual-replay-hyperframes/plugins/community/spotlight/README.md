# @js-eyes/spotlight

A reference plugin for [`@js-eyes/visual-replay-hyperframes`](../../..) that adds a "spotlight" effect to recorded compositions: dim the rest of the screen, highlight a circular ring around the most recent `dom_locate` rect.

## Use it

```bash
# Built-in alias (no install — bundled with hyperframes)
jse-replay <session-dir> --plugin=@js-eyes/spotlight

# Tune the look
jse-replay <session-dir> --plugin=@js-eyes/spotlight \
  --plugin-config '@js-eyes/spotlight={"radius":140,"dimAlpha":0.7,"tone":"cyan","duration":1.2}'
```

## Config

| key        | type   | default  | meaning |
| ---        | ---    | ---      | --- |
| `radius`   | number | `100`    | spotlight 圆半径（px），范围 [20, 600] |
| `dimAlpha` | number | `0.55`   | 圆外区域暗度（0 = 透明，1 = 全黑），范围 [0, 1] |
| `tone`     | string | `orange` | 圆环色调；预设：`orange` / `cyan` / `green` / `red`；任何 CSS 颜色字符串也行（如 `"rgba(255,0,0,0.8)"`） |
| `duration` | number | `0.9`    | 每次 spotlight 持续秒数，范围 [0.2, 6] |

## Anatomy

This plugin is intentionally short (~120 lines) so you can read it as a template
for writing your own. Three hooks contribute everything:

```js
{
  injectHead(ctx)     → '<style>...</style>',          // 注入 CSS
  injectBody(ctx)     → '<div id="...overlay"></div>', // 注入 fixed overlay 节点
  injectTimeline(ctx) → 'tl.add(...)' GSAP 片段,        // 在 dom_locate 时刻调 setSpotlight
  contributeSummary(ctx) → { ... }                      // 写到 replay-summary.json.pluginContributions
}
```

`ctx.timeline.dom.locate[]` 是消费源（每条带 `tStart` / `selector` / `rect`），plugin 不读 frames/*.jpg 像素（保持 hyperframes 的"plugin 不做像素层"契约）。

## What this teaches

1. Plugin lifecycle: `injectHead` (CSS) → `injectBody` (DOM) → `injectTimeline` (GSAP)
2. Reading `ctx.config` 来支持 user-tunable 参数
3. Use `console.log` 在 plugin 段输出 debug 日志（看浏览器 devtools 即可验收）
4. 用 timeline helpers `tl.add(fn, t)` 注册时刻回调，避免重新写 GSAP timeline

## See also

- [Plugin system 接口契约](../../README.md) - 主索引
- [`@builtin/hud`](../../builtin-hud) - 最简单的 plugin 示例（只 inject head + body + timeline）
- [`@builtin/flash`](../../builtin-flash) - 不 inject body、只用 timeline helpers 切 class
- [`__fixtures__/sample-local-plugin.js`](../../../__fixtures__/sample-local-plugin.js) - 本地路径加载 plugin 的最小例子
