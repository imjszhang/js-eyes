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
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageInteractCore;
}
if (typeof globalThis !== 'undefined') {
  globalThis.JSEyesPageInteractCore = pageInteractCore;
}
