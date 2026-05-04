#!/usr/bin/env bash
# screenshot / snapshot 模式 visual session（X 版，对齐 reddit-ops 的同名脚本）：
#   默认带 PNG·JPEG 截图（不传 --no-frames）→ events 含 frame → jse-replay 走 snapshot
#   所有 CLI 调用共享同一 SESS 目录 → meta.toolNames 收纳整套深度调研
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/cli/index.js"
SESS="$ROOT/runs/sess-snapshot-deep-$(date +%Y%m%d-%H%M%S)"
REC=(--visual --visual-record "$SESS")
REPO="$(cd "$ROOT/../.." && pwd)"
JSE_REPLAY="$REPO/packages/visual-replay-hyperframes/cli/jse-replay.js"

jse(){ node "$CLI" "$@"; }

first_url_from() {
  echo "$1" | jq -r '.result.tweets[0].tweetUrl // empty' 2>/dev/null || true
}

echo "=========================================="
echo "Screenshot(snapshot) 模式深度调研 · session: $SESS"
echo "=========================================="

jse doctor "${REC[@]}" || true
jse session-state "${REC[@]}" || true

echo "--- search · top labs (top, 1 page) ---"
jse navigate-search "OpenAI OR Anthropic OR xAI" --sort top > /dev/null 2>&1 || true
sleep 2
LABS_JSON="$(jse search "OpenAI OR Anthropic OR xAI" --sort top --max-pages 1 "${REC[@]}")"
LAB_URL="$(first_url_from "$LABS_JSON")"
echo "$LABS_JSON" | jq '{ ok, used: .usedMethod, fallback, total: .result.total }' 2>/dev/null || true

echo "--- search · chips (latest, 1 page) ---"
jse navigate-search "AI chip OR semiconductor" --sort latest > /dev/null 2>&1 || true
sleep 2
jse search "AI chip OR semiconductor" --sort latest --max-pages 1 "${REC[@]}" \
  | jq '{ ok, used: .usedMethod, total: .result.total }' 2>/dev/null || true

echo "--- search · regulation (top, 1 page) ---"
jse navigate-search "AI regulation OR EU AI Act" --sort top > /dev/null 2>&1 || true
sleep 2
jse search "AI regulation OR EU AI Act" --sort top --max-pages 1 "${REC[@]}" \
  | jq '{ ok, used: .usedMethod, total: .result.total }' 2>/dev/null || true

if [[ -n "${LAB_URL:-}" ]]; then
  echo "--- post · 头部推文 with-thread + with-replies ---"
  jse navigate-post "$LAB_URL" > /dev/null 2>&1 || true
  sleep 2
  jse post "$LAB_URL" --with-thread --with-replies 10 "${REC[@]}" \
    | jq '{ ok, used: .usedMethod, replies: (.result.replies | length) }' 2>/dev/null || true
else
  echo "WARN: 无 LAB_URL，跳过 post"
fi

echo "--- home foryou (1 page) ---"
jse navigate-home --feed foryou > /dev/null 2>&1 || true
sleep 2
jse home --feed foryou --max-pages 1 "${REC[@]}" \
  | jq '{ ok, used: .usedMethod, total: .result.total }' 2>/dev/null || true

echo ""
echo "完成。会话目录: $SESS"
if [[ -f "$SESS/events.jsonl" ]]; then
  FRAMES="$( (grep -F '"type":"frame"' "$SESS/events.jsonl" 2>/dev/null || true) | wc -l | tr -d ' ')"
  LINES="$(wc -l < "$SESS/events.jsonl" | tr -d ' ')"
  echo "events.jsonl 行数: $LINES · frame 事件粗计: $FRAMES (snapshot 模式应 >0)"
fi
if [[ -d "$SESS/frames" ]]; then
  FCOUNT="$(find "$SESS/frames" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "frames/ 文件数: $FCOUNT"
fi

echo ""
echo "--- jse-replay --no-render --keep-composition ---"
# snapshot 默认 plugins=[]；flash 已由页内 flashElement + 延后截图烘进 JPEG，
# 无需再叠 @builtin/flash。若仍要离线 HTML 卡片增强可手动加 plugin。
node "$JSE_REPLAY" "$SESS" --no-render --keep-composition || true
echo "composition: $SESS/composition"
