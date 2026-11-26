'use strict';

/**
 * Extension-owned page functions. Serialized via Function#toString for
 * chrome.scripting / CDP Runtime.evaluate / WebDriver BiDi script.evaluate.
 * Never accept caller-supplied JavaScript.
 */

var JS_EYES_NAMED_KEYS = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Space: ' ',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

function ensureRefStore() {
  var win = /** @type {any} */ (window);
  if (!win.__jsEyesRefStore || typeof win.__jsEyesRefStore !== 'object') {
    win.__jsEyesRefStore = { generation: 0, map: {} };
  }
  return win.__jsEyesRefStore;
}

function resolveRef(ref) {
  if (!ref) return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
  var store = ensureRefStore();
  var entry = store.map[String(ref)];
  if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) {
    return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
  }
  return { success: true, el: entry.el };
}

function registerRef(el, store) {
  var ref = 'e' + (Object.keys(store.map).length + 1);
  store.map[ref] = { el: el, generation: store.generation };
  return ref;
}

function hostFromHref(href) {
  if (!href) return '';
  try {
    return String(new URL(href, location.href).hostname || '');
  } catch (e) {
    return '';
  }
}

function visibleRect(el) {
  var rect = el.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

function accessibleName(el) {
  if (!el) return '';
  if (String(el.type || '').toLowerCase() === 'password') return '[password]';
  var labelled = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder'));
  if (labelled) return String(labelled).substring(0, 80);
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return String(el.name || el.id || el.type || '').substring(0, 80);
  }
  var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.substring(0, 80);
}

function roleOf(el) {
  var explicit = el.getAttribute && el.getAttribute('role');
  if (explicit) return explicit;
  var tag = String(el.tagName || '').toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    var type = String(el.type || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  if (el.isContentEditable) return 'textbox';
  return tag;
}

function selectOptions(el) {
  if (!el || el.tagName !== 'SELECT' || !el.options) return undefined;
  var out = [];
  var max = Math.min(el.options.length, 20);
  for (var i = 0; i < max; i++) {
    var opt = el.options[i];
    out.push({
      value: String(opt.value || '').substring(0, 200),
      label: String(opt.text || '').substring(0, 80),
      selected: !!opt.selected,
    });
  }
  return out;
}

function isInteractive(el) {
  var tag = String(el.tagName || '').toLowerCase();
  if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary') {
    return true;
  }
  if (el.isContentEditable) return true;
  var role = el.getAttribute && el.getAttribute('role');
  return role === 'button' || role === 'link' || role === 'textbox' || role === 'checkbox'
    || role === 'radio' || role === 'combobox' || role === 'menuitem' || role === 'tab' || role === 'switch';
}

function describeElement(el, store) {
  var rect = visibleRect(el);
  var item = {
    ref: registerRef(el, store),
    tag: String(el.tagName || '').toLowerCase(),
    role: roleOf(el),
    name: accessibleName(el),
    disabled: !!(el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')),
  };
  if (el.checked != null) item.checked = !!el.checked;
  var hrefHost = hostFromHref(el.href || (el.getAttribute && el.getAttribute('href')));
  if (hrefHost) item.hrefHost = hrefHost;
  if (rect) {
    item.bbox = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
  var options = selectOptions(el);
  if (options) item.options = options;
  return item;
}

function walkDocument(doc, elements, store, limit, onlyInteractive) {
  if (!doc || !doc.querySelectorAll) return;
  var nodes = doc.querySelectorAll('a,button,input,select,textarea,summary,[role],[contenteditable="true"]');
  for (var i = 0; i < nodes.length && elements.length < limit; i++) {
    var el = nodes[i];
    if (onlyInteractive && !isInteractive(el)) continue;
    if (!visibleRect(el) && onlyInteractive) continue;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') continue;
    var item = describeElement(el, store);
    item.nth = elements.length;
    elements.push(item);
  }
}

function collectPageState(maxElements, interactiveOnly) {
  var limit = Number(maxElements);
  if (!Number.isFinite(limit) || limit < 1) limit = 300;
  if (limit > 500) limit = 500;
  var onlyInteractive = interactiveOnly !== false;
  var store = ensureRefStore();
  store.generation += 1;
  store.map = {};
  var elements = [];
  walkDocument(document, elements, store, limit, onlyInteractive);
  var frames = document.querySelectorAll('iframe');
  for (var i = 0; i < frames.length && elements.length < limit; i++) {
    var frame = frames[i];
    var childDoc = null;
    try { childDoc = frame.contentDocument; } catch (e) { childDoc = null; }
    if (!childDoc) {
      var leaf = describeElement(frame, store);
      leaf.kind = 'iframe';
      leaf.srcHost = hostFromHref(frame.src);
      leaf.nth = elements.length;
      elements.push(leaf);
      continue;
    }
    walkDocument(childDoc, elements, store, limit, onlyInteractive);
  }
  return {
    url: String(location.href || ''),
    title: String(document.title || ''),
    generation: store.generation,
    elements: elements,
  };
}

function findBySelector(sel, textMatch, idx) {
  var el;
  if (textMatch) {
    var all = document.querySelectorAll(sel || '*');
    var matches = [];
    for (var i = 0; i < all.length; i++) {
      if ((all[i].innerText || '').trim().indexOf(textMatch) !== -1) matches.push(all[i]);
    }
    el = matches[idx] || null;
  } else if (sel && (sel.startsWith('//') || sel.startsWith('(//'))) {
    var xr = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    el = xr.snapshotItem(idx);
  } else if (sel) {
    el = document.querySelectorAll(sel)[idx] || null;
  }
  return el;
}

function clickInPage(sel, textMatch, idx, ref) {
  var el;
  if (ref) {
    var resolved = resolveRef(ref);
    if (!resolved.success) return resolved;
    el = resolved.el;
  } else {
    el = findBySelector(sel, textMatch, idx);
  }
  if (!el) {
    return { success: false, error: '未找到匹配元素: ' + sel + (textMatch ? ' (text=' + textMatch + ')' : '') };
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.click();
  return { success: true, tag: el.tagName, text: (el.innerText || '').substring(0, 100) };
}

function fillInPage(sel, val, clear, idx, ref) {
  function summarizeFilledValue(el, filled) {
    if (el && String(el.type || '').toLowerCase() === 'password') {
      return '[redacted]';
    }
    var text = String(filled == null ? '' : filled);
    return text.length > 100 ? text.substring(0, 100) : text;
  }
  var el;
  if (ref) {
    var resolved = resolveRef(ref);
    if (!resolved.success) return resolved;
    el = resolved.el;
  } else {
    el = document.querySelectorAll(sel)[idx];
  }
  if (!el) return { success: false, error: '未找到表单元素: ' + sel };
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();
  if (el.tagName === 'SELECT') {
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, tag: 'SELECT', value: summarizeFilledValue(el, el.value) };
  }
  if (el.isContentEditable) {
    if (clear) el.innerHTML = '';
    el.innerHTML += val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true, tag: el.tagName, contentEditable: true };
  }
  if (clear) el.value = '';
  var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    && Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    && Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  if (nativeSetter) {
    nativeSetter.call(el, clear ? val : el.value + val);
  } else {
    el.value = clear ? val : el.value + val;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, tag: el.tagName, value: summarizeFilledValue(el, el.value) };
}

function scrollInPage(scrollTarget, sel, px, ref) {
  if (ref) {
    var resolved = resolveRef(ref);
    if (!resolved.success) return resolved;
    resolved.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, scrolledTo: 'ref', ref: ref };
  }
  if (sel) {
    var el = document.querySelector(sel);
    if (!el) return { success: false, error: '未找到元素: ' + sel };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, scrolledTo: 'element', selector: sel };
  }
  if (scrollTarget === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return { success: true, scrolledTo: 'top' };
  }
  if (scrollTarget === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    return { success: true, scrolledTo: 'bottom', scrollHeight: document.body.scrollHeight };
  }
  if (px) {
    window.scrollBy({ top: px, behavior: 'smooth' });
    return { success: true, scrolledTo: 'relative', pixels: px };
  }
  return { success: true, scrolledTo: scrollTarget || 'bottom' };
}

function waitForInPage(sel, timeoutMs, needVisible, condition, match, ref) {
  var mode = condition || 'selector';
  return new Promise(function (resolve) {
    function check() {
      if (mode === 'load') return document.readyState === 'complete';
      if (mode === 'url') return String(location.href || '').indexOf(match || '') !== -1;
      if (mode === 'title') return String(document.title || '').indexOf(match || '') !== -1;
      if (mode === 'ref') {
        var resolved = resolveRef(ref);
        if (!resolved.success) return false;
        if (needVisible) {
          var refRect = resolved.el.getBoundingClientRect();
          return refRect.width > 0 && refRect.height > 0;
        }
        return true;
      }
      var el = document.querySelector(sel);
      if (!el) return false;
      if (needVisible) {
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      return true;
    }
    if (check()) {
      resolve({ success: true, found: true, waited: 0, settledBy: mode });
      return;
    }
    var start = Date.now();
    var observer = new MutationObserver(function () {
      if (check()) {
        observer.disconnect();
        resolve({ success: true, found: true, waited: Date.now() - start, settledBy: mode });
      }
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    var poll = setInterval(function () {
      if (check()) {
        clearInterval(poll);
        observer.disconnect();
        resolve({ success: true, found: true, waited: Date.now() - start, settledBy: mode });
      }
    }, 200);
    setTimeout(function () {
      clearInterval(poll);
      observer.disconnect();
      resolve({
        success: false,
        found: false,
        waited: timeoutMs,
        settledBy: mode,
        error: '等待超时: ' + (mode === 'selector' ? sel : mode),
      });
    }, timeoutMs);
  });
}

function parseKeyChord(spec) {
  var raw = String(spec || '').trim();
  if (!raw) return { error: 'keys is required' };
  var parts = raw.split('+');
  var mods = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  var key = '';
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part === 'Control' || part === 'Ctrl') mods.ctrlKey = true;
    else if (part === 'Meta' || part === 'Command') mods.metaKey = true;
    else if (part === 'Alt') mods.altKey = true;
    else if (part === 'Shift') mods.shiftKey = true;
    else if (key) return { error: 'unsupported keys' };
    else key = part;
  }
  if (!key) return { error: 'unsupported keys' };
  if (JS_EYES_NAMED_KEYS[key]) {
    return { key: JS_EYES_NAMED_KEYS[key], mods: mods };
  }
  if (/^[a-zA-Z0-9]$/.test(key) && (mods.ctrlKey || mods.metaKey || mods.altKey)) {
    return { key: key, mods: mods };
  }
  return { error: 'unsupported keys' };
}

function sendKeysInPage(keys, ref) {
  var parsed = parseKeyChord(keys);
  if (parsed.error) return { success: false, error: parsed.error };
  var target = document.activeElement || document.body;
  if (ref) {
    var resolved = resolveRef(ref);
    if (!resolved.success) return resolved;
    target = resolved.el;
    var focusable = /** @type {any} */ (target);
    if (focusable && typeof focusable.focus === 'function') focusable.focus();
  }
  var opts = {
    key: parsed.key,
    bubbles: true,
    cancelable: true,
    ctrlKey: parsed.mods.ctrlKey,
    metaKey: parsed.mods.metaKey,
    altKey: parsed.mods.altKey,
    shiftKey: parsed.mods.shiftKey,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
  return { success: true, keys: keys };
}

function selectOptionInPage(sel, value, label, idx, ref) {
  var el;
  if (ref) {
    var resolved = resolveRef(ref);
    if (!resolved.success) return resolved;
    el = resolved.el;
  } else {
    el = document.querySelectorAll(sel)[idx || 0];
  }
  if (!el) return { success: false, error: '未找到表单元素: ' + sel };
  if (el.tagName !== 'SELECT') {
    return { success: false, error: 'element is not a native select', code: 'NOT_SELECT' };
  }
  var matched = false;
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    if (value != null && value !== '' && opt.value === value) {
      el.selectedIndex = i;
      matched = true;
      break;
    }
    if (label != null && label !== '' && String(opt.text || '').trim() === String(label).trim()) {
      el.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched) return { success: false, error: 'option not found' };
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, tag: 'SELECT', value: el.value };
}

function navigateHistoryInPage(direction) {
  if (direction === 'forward') window.history.forward();
  else window.history.back();
  return { success: true, direction: direction === 'forward' ? 'forward' : 'back' };
}

function injectCssInPage(css) {
  var style = document.createElement('style');
  style.setAttribute('data-js-eyes', 'inject-css');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  return { success: true };
}

function getOuterHtmlInPage() {
  return document.documentElement ? document.documentElement.outerHTML : '';
}

function getPageInfoInPage() {
  return {
    url: String(location.href || ''),
    title: String(document.title || ''),
    readyState: String(document.readyState || ''),
    referrer: String(document.referrer || ''),
  };
}

function resolvePointInPage(spec) {
  var opts = spec || {};
  function lookupRef(ref) {
    var win = /** @type {any} */ (window);
    var store = win.__jsEyesRefStore;
    if (!store || typeof store !== 'object' || !store.map) return null;
    var entry = store.map[String(ref)];
    if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) return null;
    return entry.el;
  }
  if (opts.ref) {
    var refEl = lookupRef(opts.ref);
    if (!refEl) return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
    if (typeof refEl.scrollIntoView === 'function') refEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    var refRect = refEl.getBoundingClientRect();
    return { success: true, x: Math.round(refRect.left + refRect.width / 2), y: Math.round(refRect.top + refRect.height / 2) };
  }
  if (opts.selector) {
    var el = document.querySelector(opts.selector);
    if (!el) return { success: false, error: '未找到元素: ' + opts.selector };
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'instant', block: 'center' });
    var rect = el.getBoundingClientRect();
    return { success: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }
  var x = Number.isFinite(opts.x) ? Number(opts.x) : Math.round((window.innerWidth || 800) / 2);
  var y = Number.isFinite(opts.y) ? Number(opts.y) : Math.round((window.innerHeight || 600) / 2);
  return { success: true, x: x, y: y };
}

function resolveDragPointsInPage(spec) {
  var opts = spec || {};
  function lookupRef(ref) {
    var win = /** @type {any} */ (window);
    var store = win.__jsEyesRefStore;
    if (!store || typeof store !== 'object' || !store.map) return null;
    var entry = store.map[String(ref)];
    if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) return null;
    return entry.el;
  }
  function resolveEndpoint(ref, selector, x, y, label) {
    if (ref) {
      var refEl = lookupRef(ref);
      if (!refEl) return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
      if (typeof refEl.scrollIntoView === 'function') refEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      var rr = refEl.getBoundingClientRect();
      return { success: true, x: Math.round(rr.left + rr.width / 2), y: Math.round(rr.top + rr.height / 2) };
    }
    if (selector) {
      var el = document.querySelector(selector);
      if (!el) return { success: false, error: '未找到' + label + '元素: ' + selector };
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'instant', block: 'center' });
      var r = el.getBoundingClientRect();
      return { success: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { success: true, x: Number(x), y: Number(y) };
    }
    return null;
  }
  var from = resolveEndpoint(opts.fromRef, opts.fromSelector, opts.fromX, opts.fromY, '起点');
  if (from && from.success === false) return from;
  if (!from) return { success: false, error: '必须提供起点坐标(fromX/fromY)或元素(fromSelector/fromRef)' };
  var to = resolveEndpoint(opts.toRef, opts.toSelector, opts.toX, opts.toY, '终点');
  if (to && to.success === false) return to;
  if (!to) {
    var hasDelta = Number.isFinite(opts.deltaX) || Number.isFinite(opts.deltaY);
    if (!hasDelta) {
      return { success: false, error: '必须提供终点坐标(toX/toY)、元素(toSelector/toRef)或偏移量(deltaX/deltaY)' };
    }
    to = {
      success: true,
      x: from.x + (Number.isFinite(opts.deltaX) ? Number(opts.deltaX) : 0),
      y: from.y + (Number.isFinite(opts.deltaY) ? Number(opts.deltaY) : 0),
    };
  }
  return { success: true, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
}

function dragInPage(spec) {
  var opts = spec || {};
  function lookupRef(ref) {
    var win = /** @type {any} */ (window);
    var store = win.__jsEyesRefStore;
    if (!store || typeof store !== 'object' || !store.map) return null;
    var entry = store.map[String(ref)];
    if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) return null;
    return entry.el;
  }
  function resolveEndpoint(ref, selector, x, y, label) {
    if (ref) {
      var refEl = lookupRef(ref);
      if (!refEl) return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
      if (typeof refEl.scrollIntoView === 'function') refEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      var rr = refEl.getBoundingClientRect();
      return { success: true, x: Math.round(rr.left + rr.width / 2), y: Math.round(rr.top + rr.height / 2) };
    }
    if (selector) {
      var el = document.querySelector(selector);
      if (!el) return { success: false, error: '未找到' + label + '元素: ' + selector };
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'instant', block: 'center' });
      var r = el.getBoundingClientRect();
      return { success: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { success: true, x: Number(x), y: Number(y) };
    }
    return null;
  }
  var from = resolveEndpoint(opts.fromRef, opts.fromSelector, opts.fromX, opts.fromY, '起点');
  if (from && from.success === false) return Promise.resolve(from);
  if (!from) return Promise.resolve({ success: false, error: '必须提供起点坐标(fromX/fromY)或元素(fromSelector/fromRef)' });
  var to = resolveEndpoint(opts.toRef, opts.toSelector, opts.toX, opts.toY, '终点');
  if (to && to.success === false) return Promise.resolve(to);
  if (!to) {
    var hasDelta = Number.isFinite(opts.deltaX) || Number.isFinite(opts.deltaY);
    if (!hasDelta) {
      return Promise.resolve({ success: false, error: '必须提供终点坐标(toX/toY)、元素(toSelector/toRef)或偏移量(deltaX/deltaY)' });
    }
    to = {
      success: true,
      x: from.x + (Number.isFinite(opts.deltaX) ? Number(opts.deltaX) : 0),
      y: from.y + (Number.isFinite(opts.deltaY) ? Number(opts.deltaY) : 0),
    };
  }
  var buttonName = opts.button === 'right' ? 'right' : (opts.button === 'middle' ? 'middle' : 'left');
  var buttonCode = buttonName === 'right' ? 2 : (buttonName === 'middle' ? 1 : 0);
  var buttonsMask = buttonName === 'right' ? 2 : (buttonName === 'middle' ? 4 : 1);
  var steps = Math.max(1, Math.min(120, Math.round(Number(opts.steps) || 12)));
  var durationMs = Math.max(0, Math.min(15000, Math.round(opts.durationMs == null ? 300 : Number(opts.durationMs) || 0)));
  var stepDelay = steps > 0 ? Math.floor(durationMs / steps) : 0;

  function pointTarget(x, y) {
    return (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null)
      || document.body || document.documentElement;
  }
  function emitPointer(el, type, x, y, buttons) {
    if (!el || typeof el.dispatchEvent !== 'function') return;
    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: buttonCode,
      buttons: buttons,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    if (typeof PointerEvent === 'function' && type.indexOf('pointer') === 0) {
      el.dispatchEvent(new PointerEvent(type, init));
    } else if (typeof MouseEvent === 'function') {
      el.dispatchEvent(new MouseEvent(type, init));
    } else if (typeof Event === 'function') {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
  }

  var startEl = pointTarget(from.x, from.y);
  emitPointer(startEl, 'pointermove', from.x, from.y, 0);
  emitPointer(startEl, 'mousemove', from.x, from.y, 0);
  emitPointer(startEl, 'pointerdown', from.x, from.y, buttonsMask);
  emitPointer(startEl, 'mousedown', from.x, from.y, buttonsMask);

  return new Promise(function (resolve) {
    var step = 0;
    function tick() {
      step += 1;
      var ratio = step / steps;
      var cx = from.x + (to.x - from.x) * ratio;
      var cy = from.y + (to.y - from.y) * ratio;
      var currentEl = pointTarget(cx, cy);
      emitPointer(currentEl, 'pointermove', cx, cy, buttonsMask);
      emitPointer(currentEl, 'mousemove', cx, cy, buttonsMask);
      if (currentEl !== startEl) {
        emitPointer(startEl, 'pointermove', cx, cy, buttonsMask);
        emitPointer(startEl, 'mousemove', cx, cy, buttonsMask);
      }
      if (step < steps) {
        if (stepDelay > 0) setTimeout(tick, stepDelay);
        else tick();
        return;
      }
      var endEl = pointTarget(to.x, to.y);
      emitPointer(endEl, 'pointerup', to.x, to.y, 0);
      emitPointer(endEl, 'mouseup', to.x, to.y, 0);
      if (endEl !== startEl) {
        emitPointer(startEl, 'pointerup', to.x, to.y, 0);
        emitPointer(startEl, 'mouseup', to.x, to.y, 0);
      }
      resolve({
        success: true,
        mode: 'dom',
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        button: buttonName,
        steps: steps,
        durationMs: durationMs,
      });
    }
    if (stepDelay > 0) setTimeout(tick, stepDelay);
    else tick();
  });
}

function wheelInPage(spec) {
  var opts = spec || {};
  function lookupRef(ref) {
    var win = /** @type {any} */ (window);
    var store = win.__jsEyesRefStore;
    if (!store || typeof store !== 'object' || !store.map) return null;
    var entry = store.map[String(ref)];
    if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) return null;
    return entry.el;
  }
  var x;
  var y;
  if (opts.ref) {
    var refEl = lookupRef(opts.ref);
    if (!refEl) return Promise.resolve({ success: false, error: 'REF_STALE', code: 'REF_STALE' });
    if (typeof refEl.scrollIntoView === 'function') refEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    var rr = refEl.getBoundingClientRect();
    x = Math.round(rr.left + rr.width / 2);
    y = Math.round(rr.top + rr.height / 2);
  } else if (opts.selector) {
    var selEl = document.querySelector(opts.selector);
    if (!selEl) return Promise.resolve({ success: false, error: '未找到元素: ' + opts.selector });
    if (typeof selEl.scrollIntoView === 'function') selEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    var sr = selEl.getBoundingClientRect();
    x = Math.round(sr.left + sr.width / 2);
    y = Math.round(sr.top + sr.height / 2);
  } else {
    x = Number.isFinite(opts.x) ? Number(opts.x) : Math.round((window.innerWidth || 800) / 2);
    y = Number.isFinite(opts.y) ? Number(opts.y) : Math.round((window.innerHeight || 600) / 2);
  }
  var deltaX = Number.isFinite(opts.deltaX) ? Number(opts.deltaX) : 0;
  var deltaY = Number.isFinite(opts.deltaY) ? Number(opts.deltaY) : 0;
  var steps = Math.max(1, Math.min(120, Math.round(Number(opts.steps) || 1)));
  var defaultDur = steps > 1 ? 300 : 0;
  var durationMs = Math.max(0, Math.min(15000, Math.round(opts.durationMs == null ? defaultDur : Number(opts.durationMs) || 0)));
  var stepDelay = steps > 1 ? Math.floor(durationMs / steps) : 0;
  var stepDx = deltaX / steps;
  var stepDy = deltaY / steps;

  function findScrollable(el) {
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        var style = typeof getComputedStyle === 'function' ? getComputedStyle(cur) : null;
        var canY = style && (style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight;
        var canX = style && (style.overflowX === 'auto' || style.overflowX === 'scroll') && cur.scrollWidth > cur.clientWidth;
        if ((deltaY && canY) || (deltaX && canX)) return cur;
      } catch (e) { /* ignore */ }
      cur = cur.parentElement;
    }
    return null;
  }

  var target = (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null)
    || document.body || document.documentElement;
  var scrollable = findScrollable(target);

  return new Promise(function (resolve) {
    var step = 0;
    function tick() {
      step += 1;
      var prevented = false;
      if (target && typeof target.dispatchEvent === 'function') {
        var ev;
        if (typeof WheelEvent === 'function') {
          ev = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            deltaX: stepDx,
            deltaY: stepDy,
            deltaMode: 0,
            ctrlKey: !!opts.ctrlKey,
            shiftKey: !!opts.shiftKey,
            altKey: !!opts.altKey,
            metaKey: !!opts.metaKey,
          });
        } else {
          ev = new Event('wheel', { bubbles: true, cancelable: true });
        }
        prevented = !target.dispatchEvent(ev);
      }
      if (!prevented && !opts.ctrlKey) {
        if (scrollable && typeof scrollable.scrollBy === 'function') {
          scrollable.scrollBy(stepDx, stepDy);
        } else if (typeof window.scrollBy === 'function') {
          window.scrollBy(stepDx, stepDy);
        }
      }
      if (step < steps) {
        if (stepDelay > 0) setTimeout(tick, stepDelay);
        else tick();
        return;
      }
      resolve({
        success: true,
        mode: 'dom',
        x: x,
        y: y,
        deltaX: deltaX,
        deltaY: deltaY,
        steps: steps,
        durationMs: durationMs,
      });
    }
    tick();
  });
}

function selectTextInPage(spec) {
  var opts = spec || {};
  var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!sel) return { success: false, error: 'Selection API unavailable' };
  if (opts.clear === true) {
    sel.removeAllRanges();
    return { success: true, cleared: true, text: '' };
  }
  function lookupRef(ref) {
    var win = /** @type {any} */ (window);
    var store = win.__jsEyesRefStore;
    if (!store || typeof store !== 'object' || !store.map) return null;
    var entry = store.map[String(ref)];
    if (!entry || entry.generation !== store.generation || !entry.el || !entry.el.isConnected) return null;
    return entry.el;
  }
  var root = document.body || document.documentElement;
  if (opts.ref) {
    var refEl = lookupRef(opts.ref);
    if (!refEl) return { success: false, error: 'REF_STALE', code: 'REF_STALE' };
    root = refEl;
  } else if (opts.selector) {
    var selEl = document.querySelector(opts.selector);
    if (!selEl) return { success: false, error: '未找到元素: ' + opts.selector };
    root = selEl;
  }
  if (!root) return { success: false, error: '页面内容不可用' };
  var shouldScroll = opts.scrollIntoView !== false;
  var needle = opts.text != null ? String(opts.text) : '';
  if (!needle) {
    if (!opts.selector && !opts.ref) {
      return { success: false, error: '必须提供 text、selector、ref 或 clear: true' };
    }
    if (shouldScroll && typeof root.scrollIntoView === 'function') {
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var fullRange = document.createRange();
    fullRange.selectNodeContents(root);
    sel.removeAllRanges();
    sel.addRange(fullRange);
    var fullRect = fullRange.getBoundingClientRect ? fullRange.getBoundingClientRect() : null;
    return {
      success: true,
      text: String(sel.toString() || '').substring(0, 1000),
      matchCount: 1,
      occurrence: 0,
      rect: fullRect ? {
        x: Math.round(fullRect.x),
        y: Math.round(fullRect.y),
        width: Math.round(fullRect.width),
        height: Math.round(fullRect.height),
      } : null,
    };
  }

  var segments = [];
  var combined = '';
  function collectTextNodes(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var val = String(node.nodeValue || '');
      if (val.length > 0) {
        segments.push({ node: node, start: combined.length, end: combined.length + val.length });
        combined += val;
      }
      return;
    }
    if (node.nodeType === 1) {
      var tag = String(node.tagName || '').toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
      var children = node.childNodes || [];
      for (var i = 0; i < children.length; i++) collectTextNodes(children[i]);
    }
  }
  collectTextNodes(root);

  var matches = [];
  var searchPos = 0;
  while (searchPos <= combined.length - needle.length) {
    var hit = combined.indexOf(needle, searchPos);
    if (hit === -1) break;
    matches.push(hit);
    searchPos = hit + Math.max(1, needle.length);
  }
  if (matches.length === 0) {
    var lowerCombined = combined.toLowerCase();
    var lowerNeedle = needle.toLowerCase();
    searchPos = 0;
    while (searchPos <= lowerCombined.length - lowerNeedle.length) {
      var ciHit = lowerCombined.indexOf(lowerNeedle, searchPos);
      if (ciHit === -1) break;
      matches.push(ciHit);
      searchPos = ciHit + Math.max(1, lowerNeedle.length);
    }
  }
  if (matches.length === 0) {
    return { success: false, error: '未找到匹配文本: ' + needle.substring(0, 80), matchCount: 0 };
  }
  var occ = Math.max(0, Math.round(Number(opts.occurrence) || 0));
  if (occ >= matches.length) {
    return { success: false, error: '匹配序号超出范围', matchCount: matches.length, occurrence: occ };
  }
  var matchStart = matches[occ];
  var matchEnd = matchStart + needle.length;
  var startSeg = null;
  var endSeg = null;
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    if (!startSeg && matchStart >= seg.start && matchStart < seg.end) startSeg = seg;
    if (matchEnd > seg.start && matchEnd <= seg.end) {
      endSeg = seg;
      break;
    }
  }
  if (!startSeg || !endSeg) {
    return { success: false, error: '无法定位文本节点范围' };
  }
  if (shouldScroll && startSeg.node.parentElement && typeof startSeg.node.parentElement.scrollIntoView === 'function') {
    startSeg.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  var range = document.createRange();
  range.setStart(startSeg.node, matchStart - startSeg.start);
  range.setEnd(endSeg.node, matchEnd - endSeg.start);
  sel.removeAllRanges();
  sel.addRange(range);
  var rect = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
  return {
    success: true,
    text: String(sel.toString() || combined.slice(matchStart, matchEnd)).substring(0, 1000),
    matchCount: matches.length,
    occurrence: occ,
    rect: rect ? {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    } : null,
  };
}

function zoomInPage(zoomFactor) {
  var docEl = document.documentElement;
  if (!docEl || !docEl.style) return { success: false, error: 'documentElement unavailable' };
  if (zoomFactor == null) {
    var current = parseFloat(String(docEl.style.zoom || '1'));
    return { success: true, zoomFactor: Number.isFinite(current) && current > 0 ? current : 1, mode: 'css' };
  }
  var factor = Number(zoomFactor) === 0 ? 1 : Number(zoomFactor);
  if (!Number.isFinite(factor) || factor < 0.25 || factor > 5) {
    return { success: false, error: 'zoomFactor must be between 0.25 and 5 (or 0 to reset)' };
  }
  docEl.style.zoom = factor === 1 ? '' : String(factor);
  return { success: true, zoomFactor: factor, mode: 'css' };
}

const pageInteractCore = {
  clickInPage,
  fillInPage,
  scrollInPage,
  waitForInPage,
  collectPageState,
  sendKeysInPage,
  selectOptionInPage,
  navigateHistoryInPage,
  parseKeyChord,
  resolveRef,
  injectCssInPage,
  getOuterHtmlInPage,
  getPageInfoInPage,
  resolvePointInPage,
  resolveDragPointsInPage,
  dragInPage,
  wheelInPage,
  selectTextInPage,
  zoomInPage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageInteractCore;
}
if (typeof globalThis !== 'undefined') {
  globalThis.JSEyesPageInteractCore = pageInteractCore;
}
