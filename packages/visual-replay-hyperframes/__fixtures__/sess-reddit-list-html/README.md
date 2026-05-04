# sess-reddit-list-html — A-route HTML data-driven baseline (post-2.7.0 pivot)

> **Status**: ACTIVE. This is the canonical regression fixture for the
> post-2.7.0 visual-replay main pipeline. Translator + Reddit templates
> + lint behaviour all hang off this bundle.

## Why this fixture exists

After the 2.7.0 release the project pivoted (in-place, no version bump)
from "PNG screenshot + DOM-coordinate overlay" to "agent payload + HTML
template". This fixture is the smallest credible end-to-end capture of
the new wire shape:

- `events.jsonl` carries `payload.items` (the eight `r/MachineLearning`
  hot posts at capture time) — no `viewport`, no `anchor.rect`, no
  `frameRef`.
- `meta.json` carries `payloadSchemaVersion: 1`.
- No `frames/` directory: `chrome.tabs.captureVisibleTab` was not
  invoked (`captureFrame` is no longer wired into the main pipeline).

The legacy `sess-firefox-2.7.0/` PNG-mode bundle remains alongside this
folder for `@js-eyes/visual-bridge-kit/dev` regression only — see its
README.

## Original capture metadata

Captured on **2026-05-02** against:

- Firefox extension `2.7.0` (`browser.tabs.executeScript`; no
  `captureVisibleTab` invoked)
- `@js-eyes/visual-bridge-kit@0.4.0` (post-pivot — `bridge/visual.common.js@0.3.0`)
- `js-reddit-ops-skill@3.6.0` (bridge `3.5.1`)
- `@js-eyes/server-core@2.7.0`

Command:

```bash
node skills/js-reddit-ops-skill/cli/index.js \
  list-subreddit MachineLearning --limit 8 \
  --visual --visual-record runs/pivot-list
```

Active Firefox tab was on `https://www.reddit.com/r/MachineLearning/hot/`
when the bridge fired; the `_visual-reddit.js` site override resolved
`{ subreddit: 'MachineLearning' }` to a `shreddit-subreddit-icon` /
`a[href^="/r/MachineLearning/"]` element for the in-page flash. The
recorded `events.jsonl` deliberately drops that DOM measurement — only
`hint.kind`, `label`, `anchor.spec`, and `payload` survive into the
trace.

## Contents

```
sess-reddit-list-html/
├── events.jsonl          # one JSON-line entry: reddit_list_subreddit
├── meta.json             # { sessionId, payloadSchemaVersion: 1, ... }
└── README.md             # this file
```

`events.jsonl` shape (one line per tool call):

```jsonc
{
  "ts": "...",
  "sessionId": "...",
  "skillId": "js-reddit-ops-skill",
  "toolName": "reddit_list_subreddit",
  "args":  { "sub": "MachineLearning", "sort": "hot", "limit": 8 },
  "hint":  { "kind": "list", "anchor": { "subreddit": "MachineLearning" }, "tone": "pending", ... },
  "ok":    true,
  "events": [
    { "type": "flash",  "tone": "pending", "anchor": { "subreddit": "MachineLearning" }, ... },
    { "type": "hud",    "tone": "pending", ... },
    { "type": "before", "kind": "list",    "anchor": { "subreddit": "MachineLearning" }, ... },
    { "type": "flash",  "tone": "success", "anchor": { "subreddit": "MachineLearning" }, ... },
    { "type": "hud",    "tone": "success", ... },
    {
      "type": "after",
      "kind": "list",
      "ok":   true,
      "anchor":  { "subreddit": "MachineLearning" },
      "payload": {
        "items": [
          { "id": "t3_xxx", "title": "...", "author": "...", "subreddit": "MachineLearning",
            "score": 8, "comments": 10, "flair": "Discussion", "permalink": "...", ... },
          ... 8 entries ...
        ],
        "sub": "MachineLearning",
        "sort": "hot",
        "totalCount": 8
      }
    },
    { "type": "flash", "tone": "success", "anchor": { "spec": "t3_xxx" }, ... }
  ]
}
```

Note the absence of `viewport`, `anchor.rect`, `relate.from.rect`,
`frameRef`, and `redact` fields. That is the post-2.7.0 contract.

## How to regenerate

1. Connect Firefox 2.7.0 to your local `openclaw` via the extension
   popup; pin the active tab to
   `https://www.reddit.com/r/MachineLearning/hot/` (any subreddit works,
   only the bridge needs an active document).
2. From the repo root:

   ```bash
   rm -rf runs/pivot-list
   node skills/js-reddit-ops-skill/cli/index.js list-subreddit MachineLearning \
     --limit 8 --visual --visual-record runs/pivot-list
   ```

3. Sanity check:

   ```bash
   node -e 'const {events} = JSON.parse(require("fs").readFileSync("runs/pivot-list/events.jsonl","utf8")); \
     console.log("event count:", events.length); \
     console.log("after has payload:", events.some(e => e.type==="after" && e.payload));'
   ```

   Expected: `event count: 7`, `after has payload: true`.
4. Copy into the fixture folder:

   ```bash
   cp runs/pivot-list/events.jsonl runs/pivot-list/meta.json \
     packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html/
   ```

## Translator regression

```bash
rm -rf packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html/composition
node packages/visual-replay-hyperframes/cli/jse-replay.js \
  packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html \
  --no-render
npx --yes hyperframes lint \
  packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html/composition
```

Expected:

- `cardCount: 1` (one `kind: 'list'` stage)
- `totalDataItems: 8`
- `flashCount: 3` (pending + success + post-flash)
- `hudCount: 2`
- `frameCount: 0` (PNG pipeline deprecated post-2.7.0)
- `hyperframes lint`: `0 errors, 1 warning` (the only lint warning is
  `composition_file_too_large`, which is acceptable for a single-stage
  list at this level — split into sub-compositions when more stages are
  chained).

The generated `composition/index.html` is **not** committed — it is a
build artefact and large (550+ lines of inline CSS + GSAP cards).

## What this fixture proves

- Schema: events drop runtime DOM measurements; payload carries data.
- Skill side: `extractPayload` correctly normalises `result.data.items`
  into `payload.items[*]` with the documented shape.
- Translator side: `js-reddit-ops-skill/replay-templates/list.js`（经
  `--template-bootstrap` 或 `JSE_REPLAY_TEMPLATE_BOOTSTRAP`）renders 8 reddit-style
  cards (HUD, flash anchors, fullname `t3_xxx` badges).
- Lint side: composition is responsive (`vw` / `clamp`), declares
  `data-width` / `data-height`, and HUD aside elements carry
  `class="clip"`.
- Cross-version compat: regenerating against a fresh tab produces a
  byte-for-byte different `events.jsonl` (timestamps, sessionId,
  fetched titles) but the schema and stat targets above hold.
