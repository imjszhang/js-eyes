'use strict';

// timeline.js
// ---------------------------------------------------------------------------
// 把会话包 events.jsonl 摊平到一条主时间轴。
// 时间轴零点 = 第一条事件 ts；所有事件转成相对秒。
// 输出：
//   { startMs, endMs, durationSec, clips: { hud, flash, relation, before, after } }
//
// post-2.7.0 architecture pivot：
//   - 不再有 frames track（PNG 截图链路从主链路下线）
//   - flash clip 不再带 rect（DOM 测量产物），改为携带 anchor.spec 等语义 id
//     由 timelineScript 在播放时给对应 HTML data-anchor-id 节点加 .flash-active
//   - relation clip 同上：from/to 各自带 spec，在 HTML 模板里通过 data-anchor-id
//     找到 from/to 卡片
//
// hud clip 的 mounted 窗口不允许在同 track 上重叠；本函数会把相邻 hud 的 duration
// 收紧到下一条 hud 的 start。flash 同理（同 track）。
// ---------------------------------------------------------------------------

const HUD_MIN_SEC = 0.001;
const HUD_TAIL_SEC = 1.6;
const HUD_NUDGE_SEC = 0.001;
const FLASH_MAX_SEC = 0.6;
const RELATION_DURATION_SEC = 0.7;

/**
 * @param {Array<object>} entries - readVisualSession(dir).entries
 * @returns {{ startMs, endMs, durationSec, clips }}
 */
function buildTimeline(entries){
  const events = flattenEvents(entries);
  if (events.length === 0) {
    return {
      startMs: 0,
      endMs: 0,
      durationSec: 0,
      clips: { hud: [], flash: [], relation: [], before: [], after: [], dom: emptyDomClips() },
    };
  }
  const startMs = events[0].ts;
  const lastEvent = events[events.length - 1];
  const endMs = lastEvent.ts + Math.round(HUD_TAIL_SEC * 1000);

  const hud = [];
  const flash = [];
  const relation = [];
  const before = [];
  const after = [];
  const dom = emptyDomClips();
  // dom_type 单字事件聚合成 typing run（同 selector 连续打字）
  let typingRun = null;
  function flushTypingRun(){
    if (!typingRun) return;
    typingRun.duration = Math.max(0.05, (typingRun._lastTs - typingRun._startTs) / 1000);
    dom.typing.push(typingRun);
    typingRun = null;
  }

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const tStart = (e.ts - startMs) / 1000;
    if (e.type === 'hud') {
      const next = findNextEventOfType(events, i, 'hud');
      const rawEnd = next ? (next.ts - startMs) / 1000 : tStart + HUD_TAIL_SEC;
      const tEnd = next ? Math.max(tStart + HUD_NUDGE_SEC, rawEnd - HUD_NUDGE_SEC) : rawEnd;
      const duration = Math.max(HUD_MIN_SEC, tEnd - tStart);
      hud.push({
        id: 'hud-' + i,
        seqIndex: i,
        tStart,
        duration,
        tone: e.tone || 'info',
        action: e.action || '',
        target: e.target || '',
        detail: e.detail || '',
        toolName: e.toolName || '',
        ok: e.ok,
      });
    } else if (e.type === 'flash') {
      const nextFlash = findNextEventOfType(events, i, 'flash');
      const ceilSec = nextFlash ? (nextFlash.ts - startMs) / 1000 - HUD_NUDGE_SEC : Infinity;
      const duration = Math.max(HUD_MIN_SEC, Math.min(FLASH_MAX_SEC, ceilSec - tStart));
      flash.push({
        id: 'flash-' + i,
        seqIndex: i,
        tStart,
        duration,
        tone: e.tone || 'info',
        label: e.label || '',
        anchor: e.anchor || null,
        anchorId: extractAnchorId(e.anchor),
      });
    } else if (e.type === 'relation') {
      const rel = e.relate || {};
      relation.push({
        id: 'rel-' + i,
        seqIndex: i,
        tStart,
        duration: RELATION_DURATION_SEC,
        tone: e.tone || 'info',
        label: e.label || '',
        from: rel.from || null,
        to: rel.to || null,
        fromAnchorId: extractAnchorId(rel.from && rel.from.spec),
        toAnchorId: extractAnchorId(rel.to && rel.to.spec),
      });
    } else if (e.type === 'before') {
      before.push({
        id: 'be-' + i,
        seqIndex: i,
        tStart,
        label: e.label || '',
        kind: e.kind || 'global',
        anchor: e.anchor || null,
        toolName: e.toolName || '',
      });
    } else if (e.type === 'after') {
      after.push({
        id: 'af-' + i,
        seqIndex: i,
        tStart,
        label: e.label || '',
        ok: e.ok,
        count: e.count,
        kind: e.kind || 'global',
        anchor: e.anchor || null,
        payload: e.payload || null,
        toolName: e.toolName || '',
      });
    } else if (e.type === 'dom_navigate') {
      flushTypingRun();
      dom.navigate.push({
        id: 'dnav-' + i,
        seqIndex: i,
        tStart,
        from: e.from || '',
        to: e.to || '',
      });
    } else if (e.type === 'dom_locate') {
      flushTypingRun();
      dom.locate.push({
        id: 'dloc-' + i,
        seqIndex: i,
        tStart,
        selector: e.selector || '',
        rect: e.rect || null,
        miss: !!e.miss,
      });
    } else if (e.type === 'dom_hover') {
      flushTypingRun();
      dom.hover.push({
        id: 'dhov-' + i,
        seqIndex: i,
        tStart,
        duration: Math.max(0.05, Number(e.duration) / 1000 || 0.12),
        selector: e.selector || '',
        rect: e.rect || null,
      });
    } else if (e.type === 'dom_click') {
      flushTypingRun();
      dom.click.push({
        id: 'dclk-' + i,
        seqIndex: i,
        tStart,
        selector: e.selector || '',
        rect: e.rect || null,
      });
    } else if (e.type === 'dom_type') {
      const sel = e.selector || '';
      if (typingRun && typingRun.selector === sel && (e.ts - typingRun._lastTs) < 1500) {
        typingRun._lastTs = e.ts;
        typingRun.text = String(e.text != null ? e.text : (typingRun.text || ''));
        typingRun.length = Number(e.cursor) || (typingRun.text ? typingRun.text.length : (typingRun.length + 1));
        if (e.rect && !typingRun.rect) typingRun.rect = e.rect;
      } else {
        flushTypingRun();
        typingRun = {
          id: 'dtyp-' + i,
          seqIndex: i,
          tStart,
          duration: 0,
          selector: sel,
          text: String(e.text != null ? e.text : e.char || ''),
          length: Number(e.cursor) || 1,
          rect: e.rect || null,
          _startTs: e.ts,
          _lastTs: e.ts,
        };
      }
    } else if (e.type === 'dom_typed') {
      // bridge 报"打字完成"——刷新当前 run 并附最终 text/length
      if (typingRun) {
        typingRun._lastTs = e.ts;
        typingRun.text = String(e.text != null ? e.text : typingRun.text || '');
        typingRun.length = Number(e.length) || (typingRun.text ? typingRun.text.length : typingRun.length);
      }
      flushTypingRun();
    } else if (e.type === 'dom_scroll') {
      flushTypingRun();
      dom.scroll.push({
        id: 'dscr-' + i,
        seqIndex: i,
        tStart,
        duration: Math.max(0.1, Number(e.duration) / 1000 || 0.32),
        selector: e.selector || '',
        fromY: Number(e.fromY) || 0,
        toY: Number(e.toY) || 0,
      });
    } else if (e.type === 'dom_wait') {
      flushTypingRun();
      dom.wait.push({
        id: 'dwait-' + i,
        seqIndex: i,
        tStart,
        duration: Math.max(0.1, Number(e.duration) / 1000 || 0.4),
        selector: e.selector || '',
        count: Number(e.count) || 0,
        rect: e.rect || null,
        timeout: !!e.timeout,
      });
    } else if (e.type === 'dom_extract') {
      flushTypingRun();
      dom.extract.push({
        id: 'dext-' + i,
        seqIndex: i,
        tStart,
        selector: e.selector || '',
        count: Number(e.count) || 0,
        sample: Array.isArray(e.sample) ? e.sample.slice(0, 3) : [],
      });
    }
  }

  flushTypingRun();

  return {
    startMs,
    endMs,
    durationSec: (endMs - startMs) / 1000,
    clips: { hud, flash, relation, before, after, dom },
  };
}

function emptyDomClips(){
  return {
    navigate: [],
    locate: [],
    hover: [],
    click: [],
    typing: [],
    scroll: [],
    wait: [],
    extract: [],
  };
}

/**
 * extractAnchorId - 从 anchor 字段提取一个稳定的 id 字符串，用于 HTML 模板里
 * data-anchor-id 绑定。anchor 可能是：
 *   - string：直接用（如 't3_xxx'）
 *   - { spec: '...' }
 *   - { fullname: '...' }
 *   - { subreddit: 'foo' } → 'sub:foo'
 *   - { user: 'foo' }      → 'user:foo'
 *   - { url: '...' }       → 'url:hash'
 */
function extractAnchorId(anchor){
  if (!anchor) return '';
  if (typeof anchor === 'string') return anchor;
  if (typeof anchor !== 'object') return '';
  if (typeof anchor.spec === 'string' && anchor.spec) return anchor.spec;
  if (typeof anchor.fullname === 'string' && anchor.fullname) return anchor.fullname;
  if (typeof anchor.id === 'string' && anchor.id) return anchor.id;
  if (typeof anchor.subreddit === 'string' && anchor.subreddit) return 'sub:' + anchor.subreddit;
  if (typeof anchor.user === 'string' && anchor.user) return 'user:' + anchor.user;
  if (typeof anchor.url === 'string' && anchor.url) return 'url:' + anchor.url;
  return '';
}

function flattenEvents(entries){
  const out = [];
  for (const entry of entries || []) {
    if (!entry || !Array.isArray(entry.events)) continue;
    for (const ev of entry.events) {
      if (!ev || typeof ev.ts !== 'number') continue;
      out.push(Object.assign({}, ev, {
        toolName: entry.toolName || '',
        entryRunId: entry.runId || '',
        ok: entry.ok,
      }));
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function findNextEventOfType(events, fromIndex, type){
  for (let j = fromIndex + 1; j < events.length; j += 1) {
    if (events[j].type === type) return events[j];
  }
  return null;
}

module.exports = { buildTimeline, extractAnchorId };
