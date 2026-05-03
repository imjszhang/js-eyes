'use strict';

// translator.js
// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot：把会话包目录 → hyperframes composition.html。
//
// 主流程：
//   readVisualSession(sessionDir)
//     ↓
//   buildTimeline(entries) → { hud, flash, relation, before, after }
//     ↓
//   for each (before, after) pair → 按 hint.kind 查 template registry → 渲 HTML 卡片
//     ↓
//   组装 composition.html：reddit-style 卡片 + HUD overlay + flash class 动画
//
// composition 不再有 PNG 背景、不再依赖 DOM 实测坐标；视口任意尺寸下卡片自适应、
// flash 跟随，零错位。
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const { readVisualSession } = require('@js-eyes/visual-bridge-kit');

const { buildTimeline } = require('./timeline');
const { renderHudClips } = require('./hudClips');
const { buildStyleBlock } = require('./styleEmbed');
const { buildTimelineScript } = require('./timelineScript');
const { escapeHtml } = require('./escape');

// 注册默认模板（reddit）。如未来有其它 skill，自行 require 'templates/<skill>'
require('../templates/reddit');
const { getTemplate } = require('../templates/registry');

const DEFAULT_TITLE = 'JS-Eyes Visual Replay';

// 卡片在场默认时长（秒）：从 after 时刻起，下一组 before 之前都保持显示
const CARD_GAP_BEFORE_NEXT = 0.2;
const CARD_TAIL_AFTER_LAST = 1.6;

/**
 * @param {string} sessionDir
 * @param {string} outDir
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.skillId] 显式覆盖 meta.skillId（影响模板路由）
 */
function translate(sessionDir, outDir, opts){
  const o = opts || {};
  const session = readVisualSession(sessionDir);
  if (!session.meta && (!session.entries || session.entries.length === 0)) {
    throw new Error('translate: empty or missing session bundle at ' + sessionDir);
  }

  const tl = buildTimeline(session.entries);
  const skillId = o.skillId || (session.meta && session.meta.skillId) || '';
  const cards = buildCards(tl, skillId);

  const title = o.title || DEFAULT_TITLE;
  const compositionId = (session.meta && session.meta.sessionId) || ('replay-' + Date.now().toString(36));

  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml({
    title,
    compositionId,
    durationSec: tl.durationSec,
    hud: tl.clips.hud,
    flash: tl.clips.flash,
    relation: tl.clips.relation,
    cards,
    meta: session.meta,
  });

  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');

  const totalDataItems = cards.reduce((acc, c) => acc + (Number.isFinite(c.itemCount) ? c.itemCount : 0), 0);

  const summaryPath = path.join(outDir, 'replay-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    compositionId,
    durationSec: tl.durationSec,
    hudCount: tl.clips.hud.length,
    flashCount: tl.clips.flash.length,
    relationCount: tl.clips.relation.length,
    cardCount: cards.length,
    totalDataItems,
    frameCount: 0,
    eventEntries: session.entries ? session.entries.length : 0,
    meta: session.meta || null,
    architecture: 'html-data-driven (post-2.7.0 pivot)',
  }, null, 2), 'utf8');

  return {
    ok: true,
    compositionPath: indexPath,
    durationSec: tl.durationSec,
    hudCount: tl.clips.hud.length,
    flashCount: tl.clips.flash.length,
    relationCount: tl.clips.relation.length,
    cardCount: cards.length,
    totalDataItems,
    frameCount: 0,
    framesCopied: 0,
    meta: session.meta || null,
  };
}

/**
 * buildCards - 把 timeline.before / after 配对成"业务卡片"（每对一个 stage）。
 *
 * 配对规则：
 *   - 按 seqIndex 顺序遍历 events，找到 before 后向后扫描第一个相同 toolName 的 after
 *   - 卡片 tStart = before.tStart - 轻微提前（卡片在 before 时刻开始入场）
 *   - 卡片 tEnd = next before.tStart - CARD_GAP_BEFORE_NEXT，最后一个延续到 endMs
 *   - 模板从 registry 按 (skillId, after.kind) 路由
 *   - 渲染失败 / 没 payload 时回退 'global' 模板渲一张空 info 卡（保证 timeline 不空）
 */
function buildCards(tl, skillId){
  const cards = [];
  const events = mergeBeforeAfter(tl);
  if (events.length === 0) return cards;

  const totalDur = Math.max(0, tl.durationSec || 0);
  const firstStart = events[0] ? events[0].tStart : 0;

  for (let i = 0; i < events.length; i += 1) {
    const cur = events[i];
    const next = events[i + 1];
    const tStart = Math.max(0, cur.tStart - 0.05);
    const tEnd = next
      ? Math.max(tStart + 0.4, next.tStart - CARD_GAP_BEFORE_NEXT)
      : Math.max(tStart + 0.4, totalDur - 0.1);

    const kind = cur.kind || 'global';
    const tpl = getTemplate(skillId, kind);
    const ctx = {
      payload: cur.payload || null,
      anchorId: anchorIdOf(cur.anchor),
      hint: { kind, label: cur.label, target: cur.target || '' },
      label: cur.label || '',
      target: cur.target || '',
      tone: cur.tone || (cur.ok === false ? 'danger' : 'info'),
      eventIndex: i,
      sequence: { current: i, total: events.length },
    };
    let html = '';
    let renderer = tpl && tpl.renderer;
    try {
      if (renderer) html = renderer(ctx);
    } catch (e) {
      html = '';
    }
    if (!html) {
      // 兜底：用 global 渲染一张空 info 卡
      const fb = getTemplate(skillId, 'global');
      if (fb && typeof fb.renderer === 'function') {
        try { html = fb.renderer(ctx); } catch (_) { html = ''; }
      }
    }
    if (!html) {
      html = '<section class="reddit-stage" data-kind="' + escapeHtml(kind) + '">'
        + '<header class="reddit-stage-head"><h2 class="sub-title">' + escapeHtml(cur.label || kind) + '</h2></header>'
        + '<div class="empty-hint">no template / no payload</div>'
        + '</section>';
    }
    const cardId = 'card-stage-' + i;
    cards.push({
      id: cardId,
      tStart,
      tEnd,
      kind,
      itemCount: countItems(cur.payload),
      // wrap 模板片段，给入场动画用一个稳定 id
      html: '<div id="' + cardId + '" class="card-stage" data-kind="' + escapeHtml(kind) + '" data-anchor-id="' + escapeHtml(anchorIdOf(cur.anchor) || '') + '">\n' + html + '\n</div>',
    });
  }

  // 第一张卡片让 tStart 从 0 开始，给观众一个"立刻看到内容"的体感
  if (cards.length > 0 && cards[0].tStart > 0.3 && firstStart > 0.3) {
    cards[0].tStart = 0;
  }
  if (cards.length > 0) {
    cards[cards.length - 1].tEnd = Math.max(cards[cards.length - 1].tStart + 0.5, totalDur);
  }

  return cards;
}

/**
 * mergeBeforeAfter - 把 timeline 的 before/after 数组按 seqIndex 配对，每对取一个
 * "代表事件"：优先 after（包含 payload），缺失时 fallback before。
 */
function mergeBeforeAfter(tl){
  const before = (tl && tl.clips && tl.clips.before) || [];
  const after = (tl && tl.clips && tl.clips.after) || [];
  const beforeMap = new Map();
  for (const b of before) beforeMap.set(b.seqIndex, b);
  const afterByLabel = new Map();
  for (const a of after) {
    if (!afterByLabel.has(a.label)) afterByLabel.set(a.label, []);
    afterByLabel.get(a.label).push(a);
  }

  const events = [];
  // 主路径：以 after 为骨架（因为 payload 在 after 上）
  for (const a of after) {
    const b = findClosestBefore(before, a);
    events.push({
      tStart: b ? b.tStart : Math.max(0, a.tStart - 0.4),
      seqIndex: b ? b.seqIndex : a.seqIndex,
      kind: a.kind || (b && b.kind) || 'global',
      label: a.label || (b && b.label) || '',
      target: '',
      payload: a.payload,
      anchor: a.anchor || (b && b.anchor) || null,
      ok: a.ok,
      tone: a.ok === false ? 'danger' : 'info',
      toolName: a.toolName || (b && b.toolName) || '',
    });
  }
  // 兜底：如果某些 before 没有对应的 after（错误链路），也单独成一卡
  if (after.length === 0) {
    for (const b of before) {
      events.push({
        tStart: b.tStart,
        seqIndex: b.seqIndex,
        kind: b.kind || 'global',
        label: b.label || '',
        target: '',
        payload: null,
        anchor: b.anchor || null,
        ok: null,
        tone: 'pending',
        toolName: b.toolName || '',
      });
    }
  }
  events.sort((a, b) => a.tStart - b.tStart || a.seqIndex - b.seqIndex);
  return events;
}

function findClosestBefore(beforeList, after){
  if (!Array.isArray(beforeList) || beforeList.length === 0) return null;
  // 选 seqIndex < after.seqIndex 中最大的（即"最近的 before"）
  let pick = null;
  for (const b of beforeList) {
    if (b.seqIndex < after.seqIndex && b.label === after.label) {
      if (!pick || b.seqIndex > pick.seqIndex) pick = b;
    }
  }
  if (pick) return pick;
  for (const b of beforeList) {
    if (b.seqIndex < after.seqIndex) {
      if (!pick || b.seqIndex > pick.seqIndex) pick = b;
    }
  }
  return pick;
}

function countItems(payload){
  if (!payload) return 0;
  if (Array.isArray(payload.items)) return payload.items.length;
  if (typeof payload.id === 'string' && payload.id) return 1;
  if (Array.isArray(payload.fields)) return payload.fields.length;
  return 0;
}

function anchorIdOf(anchor){
  if (!anchor) return '';
  if (typeof anchor === 'string') return anchor;
  if (typeof anchor !== 'object') return '';
  if (typeof anchor.spec === 'string' && anchor.spec) return anchor.spec;
  if (typeof anchor.fullname === 'string' && anchor.fullname) return anchor.fullname;
  if (typeof anchor.id === 'string' && anchor.id) return anchor.id;
  if (typeof anchor.subreddit === 'string') return 'sub:' + anchor.subreddit;
  if (typeof anchor.user === 'string') return 'user:' + anchor.user;
  if (typeof anchor.url === 'string') return 'url:' + anchor.url;
  return '';
}

function buildHtml(info){
  const styleBlock = buildStyleBlock();
  const hudHtml = renderHudClips(info.hud);

  const cardsHtml = (info.cards || []).map(c => c.html).join('\n');

  const watermarkText = [
    'jse-replay',
    info.meta && info.meta.skillId ? '· ' + info.meta.skillId : '',
    info.meta && info.meta.sessionId ? '· ' + info.meta.sessionId.slice(0, 14) : '',
    'html-pivot',
  ].filter(Boolean).join(' ');

  const tlScript = buildTimelineScript({
    compositionId: info.compositionId,
    hud: info.hud,
    flash: info.flash,
    relation: info.relation,
    cards: info.cards || [],
    durationSec: info.durationSec,
  });

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>' + escapeHtml(info.title) + '</title>',
    styleBlock,
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>',
    '</head>',
    '<body>',
    '<main',
    '  id="stage"',
    '  data-composition-id="' + escapeHtml(info.compositionId) + '"',
    '  data-start="0"',
    '  data-width="1280"',
    '  data-height="720"',
    '  data-architecture="html-pivot"',
    '>',
    cardsHtml || '<section class="reddit-stage" data-kind="empty"><div class="empty-hint">no events</div></section>',
    '</main>',
    hudHtml,
    '<div class="jse-progress"><div class="bar"></div></div>',
    '<div class="jse-watermark">' + escapeHtml(watermarkText) + '</div>',
    tlScript,
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { translate };
