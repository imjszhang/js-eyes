'use strict';

// translator.js
// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot：把会话包目录 → hyperframes composition.html。
//
// v0.6.0 snapshot-only-prune：
//   - reddit chrome（topbar/leftnav）/ page-header / dom_* 合成动画 全部下线
//   - 主链路：snapshot 模式背景图序列；模板兑底：list / item 卡片（_generic 兜底）
//   - effects 仅保留 hud / flash 两个 opt-in overlay
//
// 主流程：
//   readVisualSession(sessionDir)
//     ↓
//   buildTimeline(entries) → { hud, flash, relation, before, after, frames }
//     ↓
//   for each (before, after) pair → 按 hint.kind 查 template registry → 渲 HTML 卡片
//     ↓
//   组装 composition.html：snapshot 双缓冲 stage + 卡片 + opt-in HUD/flash
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const { readVisualSession } = require('@js-eyes/visual-bridge-kit');

const { buildTimeline } = require('./timeline');
const { renderHudClips } = require('./hudClips');
const { buildStyleBlock } = require('./styleEmbed');
const { buildTimelineScript } = require('./timelineScript');
const { escapeHtml } = require('./escape');

// 注册默认模板：先 _generic（('*','*') 终极兜底 + tree/global/navigation/write 显式
// 兜底注册），再 reddit（list/item 专属覆盖）。顺序无关功能正确性（registry 按
// tier 优先级查找），但 _generic 先 require 让人一眼看出"任何 kind 都至少有兜底"。
require('../templates/_generic');
require('../templates/reddit');
const { getTemplate } = require('../templates/registry');

const DEFAULT_TITLE = 'JS-Eyes Visual Replay';

// 卡片在场默认时长（秒）：从 after 时刻起，下一组 before 之前都保持显示
const CARD_GAP_BEFORE_NEXT = 0.2;
const CARD_TAIL_AFTER_LAST = 1.6;

// v0.6.0：effects 只剩 hud / flash 两个 opt-in overlay；snapshot 模式默认全关
// （"录制 = 干净"），template 模式由 translate() 在决定好 mode 后自动拉满（零回归）。
const DEFAULT_EFFECTS = Object.freeze({ hud: false, flash: false });

// v0.6.0 之前 effects 支持 cursor/typing/click/ripple/spinner/scroll/shell；
// 这批旧 key 现在全部下线，translate() / CLI 各自校验后报错（不在这里硬抛）。
const KNOWN_EFFECTS = Object.freeze(['hud', 'flash']);

function normalizeEffects(input){
  if (!input) return Object.assign({}, DEFAULT_EFFECTS);
  if (input === 'all' || input === true) {
    return { hud: true, flash: true };
  }
  if (input === 'none' || input === false) {
    return Object.assign({}, DEFAULT_EFFECTS);
  }
  if (typeof input === 'string') {
    const out = Object.assign({}, DEFAULT_EFFECTS);
    input.split(/[\s,]+/).forEach((k) => {
      const key = k.trim().toLowerCase();
      if (!key) return;
      if (key === 'all') KNOWN_EFFECTS.forEach((kk) => { out[kk] = true; });
      else if (key === 'none') KNOWN_EFFECTS.forEach((kk) => { out[kk] = false; });
      else if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = true;
    });
    return out;
  }
  if (typeof input === 'object') {
    const out = Object.assign({}, DEFAULT_EFFECTS);
    for (const k of KNOWN_EFFECTS) {
      if (Object.prototype.hasOwnProperty.call(input, k)) out[k] = !!input[k];
    }
    return out;
  }
  return Object.assign({}, DEFAULT_EFFECTS);
}

/**
 * @param {string} sessionDir
 * @param {string} outDir
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.skillId] 显式覆盖 meta.skillId（影响模板路由）
 * @param {object|string} [opts.effects] 'auto' | 'none' | 'all' | 'hud,flash' | { hud, flash }
 * @param {'auto'|'always'|'never'} [opts.snapshot='auto'] snapshot 模式开关（auto = events 含 frame 即用）
 */
function translate(sessionDir, outDir, opts){
  const o = opts || {};
  const session = readVisualSession(sessionDir);
  if (!session.meta && (!session.entries || session.entries.length === 0)) {
    throw new Error('translate: empty or missing session bundle at ' + sessionDir);
  }

  const tl = buildTimeline(session.entries);
  const skillId = o.skillId || (session.meta && session.meta.skillId) || '';
  const buildResult = buildCards(tl, skillId);
  const cards = buildResult.cards;

  const title = o.title || DEFAULT_TITLE;
  const compositionId = (session.meta && session.meta.sessionId) || ('replay-' + Date.now().toString(36));

  // snapshot 决策（先看 events 有 frame，再受 --snapshot flag 调整）
  const frames = (tl.clips && Array.isArray(tl.clips.frames)) ? tl.clips.frames : [];
  const snapshotPolicy = o.snapshot || 'auto';
  let snapshotMode = 'template';
  if (snapshotPolicy === 'always') snapshotMode = 'snapshot';
  else if (snapshotPolicy === 'never') snapshotMode = 'template';
  else snapshotMode = frames.length > 0 ? 'snapshot' : 'template';

  // effects=auto（mode-aware default）：snapshot → none（"录屏=干净"），
  // template → hud + flash（保留两条最显眼 overlay，零回归）。
  let effects;
  if (o.effects === undefined || o.effects === 'auto') {
    if (snapshotMode === 'template') {
      effects = normalizeEffects({ hud: true, flash: true });
    } else {
      effects = normalizeEffects('none');
    }
  } else {
    effects = normalizeEffects(o.effects);
  }

  fs.mkdirSync(outDir, { recursive: true });

  // snapshot 模式拷贝 frames/ 到 composition/frames/
  let framesCopied = 0;
  if (snapshotMode === 'snapshot') {
    framesCopied = copyFramesDir(path.join(sessionDir, 'frames'), path.join(outDir, 'frames'));
  }

  const html = buildHtml({
    title,
    compositionId,
    durationSec: tl.durationSec,
    hud: tl.clips.hud,
    flash: tl.clips.flash,
    relation: tl.clips.relation,
    frames,
    snapshotMode,
    effects,
    cards,
    skillId,
    meta: session.meta,
  });

  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');

  const totalDataItems = cards.reduce((acc, c) => acc + (Number.isFinite(c.itemCount) ? c.itemCount : 0), 0);
  const missingTemplates = aggregateMissing(buildResult.templateUsage);

  const summaryPath = path.join(outDir, 'replay-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    compositionId,
    durationSec: tl.durationSec,
    hudCount: tl.clips.hud.length,
    flashCount: tl.clips.flash.length,
    relationCount: tl.clips.relation.length,
    cardCount: cards.length,
    totalDataItems,
    frameCount: frames.length,
    framesCopied,
    snapshotMode,
    effects,
    eventEntries: session.entries ? session.entries.length : 0,
    meta: session.meta || null,
    architecture: 'snapshot-only-prune (v0.6.0)',
    templateUsage: buildResult.templateUsage,
    missingTemplates,
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
    frameCount: frames.length,
    framesCopied,
    snapshotMode,
    effects,
    meta: session.meta || null,
    missingTemplates,
  };
}

function copyFramesDir(srcDir, destDir){
  let count = 0;
  let entries = [];
  try { entries = fs.readdirSync(srcDir); } catch (_) { return 0; }
  if (!entries.length) return 0;
  try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
  for (const name of entries) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const src = path.join(srcDir, name);
    const dst = path.join(destDir, name);
    try {
      fs.copyFileSync(src, dst);
      count += 1;
    } catch (_) {}
  }
  return count;
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
  const templateUsage = []; // [{skillId, kind, tier}]
  const events = mergeBeforeAfter(tl);
  if (events.length === 0) return { cards, templateUsage };

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
      hint: { kind, label: cur.label, target: cur.target || '', skillId, anchor: cur.anchor || null, toolName: cur.toolName || '' },
      label: cur.label || '',
      target: cur.target || '',
      toolName: cur.toolName || '',
      tone: cur.tone || (cur.ok === false ? 'danger' : 'info'),
      eventIndex: i,
      sequence: { current: i, total: events.length },
      meta: { skillId },
    };
    let html = '';
    let usedTier = tpl ? tpl.matchTier : 'none';
    let renderer = tpl && tpl.renderer;
    try {
      if (renderer) html = renderer(ctx);
    } catch (e) {
      html = '';
    }
    if (!html) {
      // 一级兜底：尝试 (sid, 'global')
      const fb = getTemplate(skillId, 'global');
      if (fb && typeof fb.renderer === 'function') {
        try { html = fb.renderer(ctx); usedTier = fb.matchTier + '+global-fallback'; } catch (_) { html = ''; }
      }
    }
    if (!html) {
      html = '<section class="reddit-stage" data-kind="' + escapeHtml(kind) + '">'
        + '<header class="reddit-stage-head"><h2 class="sub-title">' + escapeHtml(cur.label || kind) + '</h2></header>'
        + '<div class="empty-hint">no template / no payload</div>'
        + '</section>';
      usedTier = 'hard-fallback';
    }
    templateUsage.push({ skillId: skillId || '*', kind, tier: usedTier });

    const cardId = 'card-stage-' + i;
    cards.push({
      id: cardId,
      tStart,
      tEnd,
      kind,
      toolName: cur.toolName || '',
      itemCount: countItems(cur.payload),
      // wrap 模板片段，给入场动画用一个稳定 id
      html: [
        '<div id="' + cardId + '" class="card-stage"',
        '  data-kind="' + escapeHtml(kind) + '"',
        '  data-anchor-id="' + escapeHtml(anchorIdOf(cur.anchor) || '') + '">',
        html,
        '</div>',
      ].join('\n'),
    });
  }

  // 第一张卡片让 tStart 从 0 开始，给观众一个"立刻看到内容"的体感
  if (cards.length > 0 && cards[0].tStart > 0.3 && firstStart > 0.3) {
    cards[0].tStart = 0;
  }
  if (cards.length > 0) {
    cards[cards.length - 1].tEnd = Math.max(cards[cards.length - 1].tStart + 0.5, totalDur);
  }

  return { cards, templateUsage };
}

/**
 * aggregateMissing - 把 templateUsage 折叠成 (skillId, kind) → 计数 + tier，
 * 仅保留那些走了 generic / hard-fallback 等"未专属注册"档位的条目。
 */
function aggregateMissing(usage){
  const map = new Map();
  for (const u of (usage || [])) {
    if (u.tier !== 'generic' && u.tier !== 'hard-fallback' && u.tier !== 'legacy-global' && u.tier !== 'skill-wildcard') continue;
    const k = (u.skillId || '*') + '::' + (u.kind || 'global');
    if (!map.has(k)) map.set(k, { skillId: u.skillId || '*', kind: u.kind || 'global', count: 0, tier: u.tier });
    map.get(k).count += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
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
  const effects = info.effects || {};
  // hud DOM 不渲染等于 0 视觉残留（容易被 GSAP set/from 命中也无所谓，无节点）
  const hudHtml = effects.hud ? renderHudClips(info.hud) : '';

  const cardsHtml = (info.cards || []).map(c => c.html).join('\n');
  const snapshotMode = info.snapshotMode === 'snapshot' ? 'snapshot' : 'template';
  const frames = Array.isArray(info.frames) ? info.frames : [];

  const watermarkText = [
    'jse-replay',
    info.meta && info.meta.skillId ? '· ' + info.meta.skillId : '',
    info.meta && info.meta.sessionId ? '· ' + info.meta.sessionId.slice(0, 14) : '',
    'v0.6 ' + snapshotMode,
  ].filter(Boolean).join(' ');

  const tlScript = buildTimelineScript({
    compositionId: info.compositionId,
    hud: info.hud,
    flash: info.flash,
    relation: info.relation,
    frames,
    snapshotMode,
    effects,
    cards: info.cards || [],
    durationSec: info.durationSec,
  });

  const framesPresent = snapshotMode === 'snapshot' && frames.length > 0;

  const stageInner = cardsHtml || '<section class="reddit-stage" data-kind="empty"><div class="empty-hint">no events</div></section>';
  const stageMode = framesPresent ? 'snapshot' : 'template';
  const stageBlock = [
    '<main',
    '  id="stage"',
    '  data-composition-id="' + escapeHtml(info.compositionId) + '"',
    '  data-architecture="snapshot-only-prune-v0.6"',
    '  data-mode="' + stageMode + '"',
    '>',
    framesPresent
      ? '<div class="jse-frame-img-cur"></div>\n<div class="jse-frame-img-next"></div>'
      : '',
    stageInner,
    '</main>',
  ].join('\n');

  const bodyAttrs = [
    'data-snapshot="' + snapshotMode + '"',
    'data-frames="' + (framesPresent ? 'present' : 'absent') + '"',
  ].join(' ');

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
    '<body ' + bodyAttrs + '>',
    stageBlock,
    hudHtml,
    '<div class="jse-progress"><div class="bar"></div></div>',
    '<div class="jse-watermark">' + escapeHtml(watermarkText) + '</div>',
    tlScript,
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { translate };
