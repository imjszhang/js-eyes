# sess-firefox-2.7.0 — PNG-mode archived baseline (DEPRECATED post-2.7.0)

> **Status**: Archived. Kept ONLY as a regression fixture for the dev / debug
> PNG path (`@js-eyes/visual-bridge-kit/dev` `makeFrameWriter` +
> `attachFrameRefsToEvents` + the `chrome.tabs.captureVisibleTab` RPC).
>
> **Main pipeline does not consume this fixture.** Post-2.7.0 the visual
> replay architecture pivoted to "agent payload → HTML template" rendering;
> see [`sess-reddit-list-html/`](../sess-reddit-list-html/) for the new
> baseline and the package [README](../../README.md) for the data flow.

## Original capture metadata

Captured on **2026-05-02** against:

- Firefox extension `2.7.0` (`browser.tabs.captureVisibleTab`)
- `@js-eyes/visual-bridge-kit@0.4.0` (top-level `makeFrameWriter` still exported at this version)
- `js-browser-ops-skill@2.3.0`
- `@js-eyes/server-core@2.7.0`

Command:

```bash
node skills/js-browser-ops-skill/scripts/browser-read.js \
  https://github.com/imjszhang/hyperframes \
  --visual --visual-record runs/sess-firefox-live --no-cache
```

## Contents (frozen)

- `meta.json` — session-bundle contract (sessionId, kitVersion, skillVersion, eventCount).
- `events.jsonl` — 4 events (`hud(pending)` → `before+frameRef` → `hud(success)` → `after+frameRef`);
  every event carries `viewport: { w:1641, h:885, dpr:1, ... }` and `anchor.rect` (DOM-measured).
- `frames/<ts>.png` — two real-tab screenshots from the Firefox `capture_screenshot` RPC
  (1641 × 885, ~270 KB each).

## Why it is archived

post-2.7.0 the main pipeline:

1. **Stopped emitting** `viewport`, `anchor.rect`, `relate.rect`, `frameRef` from `bridge/visual.common.js`.
2. **Stopped consuming** `frames/*.png`; `translator.js` now reads `event.payload` and
   routes through `templates/<skill>/<kind>` to render responsive reddit-style HTML cards.
3. **Stopped writing** `meta.redact` / `meta.frameCount`; instead writes
   `meta.payloadSchemaVersion: 1`.

This fixture pre-dates all three changes. Loading it through the new translator
will succeed (graceful fallback to "HUD-only" cards) but will not exercise the
new template path. To regression-test the dev PNG link:

```bash
# Re-import frame helpers from the dev sub-path:
node -e "
const { makeFrameWriter, attachFrameRefsToEvents } = require('@js-eyes/visual-bridge-kit/dev');
console.log(typeof makeFrameWriter, typeof attachFrameRefsToEvents);
"

# Translate this archived bundle (HUD will render; cards will be empty placeholders):
node packages/visual-replay-hyperframes/cli/jse-replay.js \
  packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0 \
  --no-render --keep-composition
```

Do not regenerate this fixture — keep it stable so future schema changes show
up as diffs against the v2.7.0 PNG-mode contract.

## See also

- [`sess-reddit-list-html/`](../sess-reddit-list-html/) — the new
  HTML data-driven baseline (post-2.7.0 main pipeline).
- [Repo CHANGELOG](../../../../CHANGELOG.md) → `2.7.0` entry → "Architecture
  pivot (post-2.7.0, in-place)" sub-section.
