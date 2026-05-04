#!/usr/bin/env bash
# 模板模式 visual session：--no-frames → 无 frame 事件 → jse-replay 走 template
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/cli/index.js"
SESS="$ROOT/runs/sess-template-deep-$(date +%Y%m%d-%H%M%S)"
REC=(--visual --visual-record "$SESS" --no-frames)
REPO="$(cd "$ROOT/../.." && pwd)"
JSE_REPLAY="$REPO/packages/visual-replay-hyperframes/cli/jse-replay.js"

jse(){ node "$CLI" "$@"; }

# 从工具 JSON 信封里取 result.items[0] 的链接与作者
first_url_from() {
  echo "$1" | jq -r '.result.items[0].contentHref // .result.items[0].url // empty' 2>/dev/null || true
}
first_author_from() {
  echo "$1" | jq -r '.result.items[0].author // empty' 2>/dev/null || true
}

echo "=========================================="
echo "模板模式深度调研 · session: $SESS"
echo "=========================================="

jse doctor "${REC[@]}"
jse session-state "${REC[@]}"

echo "--- list-subreddit r/MachineLearning（先拿稳定 permalink） ---"
ML_JSON="$(jse list-subreddit MachineLearning --limit 8 --sort hot "${REC[@]}")"
POST_URL="$(first_url_from "$ML_JSON")"
AUTHOR="$(first_author_from "$ML_JSON")"
echo "$ML_JSON" | jq '{ ok, returnedCount: .result.returnedCount }' 2>/dev/null || true

echo "--- search 全站 ---"
jse search "LLM reasoning evaluation 2026" --limit 8 --sort hot "${REC[@]}" | jq '{ ok, returnedCount: .result.returnedCount }' 2>/dev/null || true

jse subreddit-about MachineLearning "${REC[@]}"

if [[ -n "${POST_URL:-}" ]]; then
  echo "--- get-post ---"
  jse get-post "$POST_URL" --limit 15 "${REC[@]}"
else
  echo "WARN: 无 permalink，跳过 get-post"
fi

if [[ -n "${AUTHOR:-}" ]]; then
  echo "--- user-profile: $AUTHOR ---"
  jse user-profile "$AUTHOR" --limit 8 "${REC[@]}" || echo "WARN: user-profile 失败，跳过"
else
  echo "WARN: 无 author，跳过 user-profile"
fi

echo "--- r/MachineLearning 内搜索 ---"
jse search "LoRA fine-tune" --sub MachineLearning --limit 6 "${REC[@]}" | jq '{ ok, returnedCount: .result.returnedCount }' 2>/dev/null || true

echo "--- my-feed（可选） ---"
jse my-feed --limit 6 "${REC[@]}" || echo "WARN: my-feed 跳过"

echo "--- probe（home profile） ---"
jse probe --page home "${REC[@]}"

echo ""
echo "完成。会话目录: $SESS"
if [[ -f "$SESS/events.jsonl" ]]; then
  # grep 无匹配时 exit 1；在 pipefail 下会让整段脚本误失败，故包一层子 shell
  FRAMES="$( (grep -F '"type":"frame"' "$SESS/events.jsonl" 2>/dev/null || true) | wc -l | tr -d ' ')"
  LINES="$(wc -l < "$SESS/events.jsonl" | tr -d ' ')"
  echo "events.jsonl 行数: $LINES · frame 事件粗计: $FRAMES (模板模式应为 0)"
fi
echo "回灌: node \"$JSE_REPLAY\" \"$SESS\" --no-render --keep"
