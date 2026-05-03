'use strict';

const { escapeHtml } = require('./escape');

/**
 * 把 timeline.hud[] 翻译成一组 <div class="jse-hud" data-...> 节点。
 * 每条 HUD 都贴右上角（CSS position: fixed）；同 track（track 1），mounted 窗口
 * 不重叠（duration 由 buildTimeline 收紧到 next.tStart 之前）。
 *
 * post-2.7.0 architecture pivot：
 *   - HUD 作为 #stage 之外的 fixed overlay 出现（不再被 stage padding 偏移）
 *   - class 重命名为 jse-hud（旧名 jse-vis-clip-hud 已下线）
 *   - 子结构 .hud-action / .hud-target / .hud-detail 让 CSS 可单独控制字号与颜色
 *
 * @param {Array<object>} huds - timeline.clips.hud
 * @returns {string} HTML 片段
 */
function renderHudClips(huds){
  if (!Array.isArray(huds) || huds.length === 0) return '';
  return huds.map(renderOne).join('\n');
}

function renderOne(h){
  const tone = String(h.tone || 'info');
  const action = h.action ? '<p class="hud-action">' + escapeHtml(h.action) + '</p>' : '';
  const target = h.target ? '<p class="hud-target">' + escapeHtml(h.target) + '</p>' : '';
  const detail = h.detail ? '<p class="hud-detail">' + escapeHtml(h.detail) + '</p>' : '';
  return [
    '<aside',
    '  id="' + escapeHtml(h.id) + '"',
    '  class="clip jse-hud"',
    '  data-tone="' + escapeHtml(tone) + '"',
    '  data-start="' + h.tStart.toFixed(3) + '"',
    '  data-duration="' + h.duration.toFixed(3) + '"',
    '  data-track-index="1"',
    '>',
    action,
    target,
    detail,
    '</aside>',
  ].filter(Boolean).join('\n');
}

module.exports = { renderHudClips };
