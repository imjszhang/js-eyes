'use strict';

// lib/visualHint.js
// ---------------------------------------------------------------------------
// 把 6 个 browser_* 工具调用翻译成 visualHint，供 wrapInjectCall 使用。
//
// hint shape:
//   {
//     kind:    'item' | 'list' | 'tree' | 'global' | 'navigation',
//     toolName: string,
//     label:    string,
//     anchor:   anchorSpec | null,   // string CSS / XPath / URL，或 object
//     target:   string,              // HUD 副标题
//     detail:   string,              // HUD 第三行
//     tone:     'pending' | 'info' | 'success' | 'danger',
//   }
//
// summary shape：
//   {
//     ok:        boolean,
//     items:     [],     // browser-ops 几乎没有 list，多数为空数组
//     relate:    [],
//     errorCode: string,
//     detail:    string,
//     target:    string,
//   }
// ---------------------------------------------------------------------------

const TOOL_TO_LABEL_PREFIX = {
  browser_read_page: '读取',
  browser_click: '点击',
  browser_fill_form: '填表',
  browser_wait_for: '等待',
  browser_scroll: '滚动',
  browser_screenshot: '拍照',
};

function safeHostname(url){
  if (typeof url !== 'string' || !url) return '';
  try { return new URL(url).hostname; } catch (_) { return url.slice(0, 60); }
}

function truncate(s, n){
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function clickAnchor(args){
  const a = args || {};
  const out = {};
  if (a.selector) out.selector = a.selector;
  if (a.xpath) out.xpath = a.xpath;
  if (a.text) out.text = a.text;
  if (typeof a.index === 'number') out.index = a.index;
  return Object.keys(out).length ? out : null;
}

function fillAnchor(args){
  const a = args || {};
  if (!a.selector) return null;
  return typeof a.index === 'number' ? { selector: a.selector, index: a.index } : { selector: a.selector };
}

function waitAnchor(args){
  const a = args || {};
  return a.selector ? { selector: a.selector } : null;
}

function scrollAnchor(args){
  const a = args || {};
  return a.selector ? { selector: a.selector } : null;
}

/**
 * 构造 hint。toolName 必须传，args 可选。
 */
function getVisualHint(toolName, args){
  const a = args || {};
  const labelPrefix = TOOL_TO_LABEL_PREFIX[toolName] || toolName;

  switch (toolName) {
    case 'browser_read_page': {
      const tag = a.url ? safeHostname(a.url) : (a.tabId ? `tab:${a.tabId}` : '');
      return {
        kind: 'item',
        toolName,
        label: tag ? `${labelPrefix} ${tag}` : labelPrefix,
        anchor: null,
        target: tag,
        detail: '',
        tone: 'pending',
      };
    }
    case 'browser_click': {
      const anchor = clickAnchor(a);
      const targetStr = a.text
        ? `text="${truncate(a.text, 32)}"`
        : (a.selector || a.xpath || '');
      return {
        kind: 'item',
        toolName,
        label: `${labelPrefix} ${truncate(targetStr, 60)}`,
        anchor,
        target: truncate(targetStr, 80),
        detail: '',
        tone: 'pending',
      };
    }
    case 'browser_fill_form': {
      const anchor = fillAnchor(a);
      return {
        kind: 'item',
        toolName,
        label: `${labelPrefix} ${truncate(a.selector || '', 40)}`,
        anchor,
        target: truncate(a.selector || '', 80),
        detail: a.value ? `← "${truncate(String(a.value), 32)}"` : '',
        tone: 'pending',
      };
    }
    case 'browser_wait_for': {
      const anchor = waitAnchor(a);
      return {
        kind: 'item',
        toolName,
        label: `${labelPrefix} ${truncate(a.selector || '', 40)}`,
        anchor,
        target: truncate(a.selector || '', 80),
        detail: a.timeout ? `≤${a.timeout}s` : '',
        tone: 'pending',
      };
    }
    case 'browser_scroll': {
      const anchor = scrollAnchor(a);
      const dest = a.selector
        ? truncate(a.selector, 40)
        : (a.target || (a.pixels != null ? `${a.pixels}px` : ''));
      return {
        kind: 'global',
        toolName,
        label: `${labelPrefix} → ${dest || 'bottom'}`,
        anchor,
        target: dest || 'bottom',
        detail: '',
        tone: 'pending',
      };
    }
    case 'browser_screenshot': {
      return {
        kind: 'global',
        toolName,
        label: `${labelPrefix} 视口`,
        anchor: null,
        target: a.tabId ? `tab:${a.tabId}` : '',
        detail: '',
        tone: 'pending',
      };
    }
    default:
      return {
        kind: 'global',
        toolName,
        label: toolName,
        anchor: null,
        target: '',
        detail: '',
        tone: 'pending',
      };
  }
}

/**
 * buildSummary - 把 api.js 的 result 翻译成 summary。
 * browser-ops 大多返回 { success: bool, ... }。
 */
function buildSummary(toolName, result, err){
  if (err) {
    return { ok: false, items: [], relate: [], errorCode: err.code || 'thrown', detail: err.message || '', target: '' };
  }
  if (!result || typeof result !== 'object') {
    return { ok: false, items: [], relate: [], errorCode: 'no_response', detail: '', target: '' };
  }

  switch (toolName) {
    case 'browser_read_page': {
      const ok = !!(result && (result.title || result.content));
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : 'empty_page',
        detail: ok ? `“${truncate(result.title || '', 36)}”` : '',
        target: result.url ? safeHostname(result.url) : '',
      };
    }
    case 'browser_click': {
      const ok = result.success === true;
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : (result.error || 'click_failed'),
        detail: ok ? (result.tag || '') : (result.error || ''),
        target: '',
      };
    }
    case 'browser_fill_form': {
      const ok = result.success === true;
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : (result.error || 'fill_failed'),
        detail: ok ? `${result.tag || ''} ← "${truncate(result.value || '', 24)}"` : (result.error || ''),
        target: '',
      };
    }
    case 'browser_wait_for': {
      const ok = result.found === true;
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : 'wait_timeout',
        detail: typeof result.waited === 'number' ? `+${result.waited}ms` : '',
        target: '',
      };
    }
    case 'browser_scroll': {
      const ok = result.success === true;
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : (result.error || 'scroll_failed'),
        detail: result.scrolledTo || '',
        target: '',
      };
    }
    case 'browser_screenshot': {
      const ok = result.success !== false;
      const vp = result.viewport;
      return {
        ok,
        items: [],
        relate: [],
        errorCode: ok ? '' : (result.error || 'screenshot_failed'),
        detail: vp ? `${vp.width}×${vp.height}` : '',
        target: '',
      };
    }
    default:
      return { ok: true, items: [], relate: [], errorCode: '', detail: '', target: '' };
  }
}

module.exports = {
  getVisualHint,
  buildSummary,
};
