'use strict';

/**
 * Extension-owned page functions. Serialized via Function#toString for
 * chrome.scripting / CDP Runtime.evaluate / WebDriver BiDi script.evaluate.
 * Never accept caller-supplied JavaScript.
 */

function clickInPage(sel, textMatch, idx) {
  var el;
  if (textMatch) {
    var all = document.querySelectorAll(sel || '*');
    var matches = [];
    for (var i = 0; i < all.length; i++) {
      if ((all[i].innerText || '').trim().indexOf(textMatch) !== -1) matches.push(all[i]);
    }
    el = matches[idx] || null;
  } else if (sel.startsWith('//') || sel.startsWith('(//')) {
    var xr = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    el = xr.snapshotItem(idx);
  } else {
    el = document.querySelectorAll(sel)[idx] || null;
  }
  if (!el) {
    return { success: false, error: '未找到匹配元素: ' + sel + (textMatch ? ' (text=' + textMatch + ')' : '') };
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.click();
  return { success: true, tag: el.tagName, text: (el.innerText || '').substring(0, 100) };
}

function fillInPage(sel, val, clear, idx) {
  function summarizeFilledValue(el, filled) {
    if (el && String(el.type || '').toLowerCase() === 'password') {
      return '[redacted]';
    }
    var text = String(filled == null ? '' : filled);
    return text.length > 100 ? text.substring(0, 100) : text;
  }
  var el = document.querySelectorAll(sel)[idx];
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

function scrollInPage(scrollTarget, sel, px) {
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

function waitForInPage(sel, timeoutMs, needVisible) {
  return new Promise(function (resolve) {
    function check() {
      var el = document.querySelector(sel);
      if (!el) return false;
      if (needVisible) {
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      return true;
    }
    if (check()) {
      resolve({ success: true, found: true, waited: 0 });
      return;
    }
    var start = Date.now();
    var observer = new MutationObserver(function () {
      if (check()) {
        observer.disconnect();
        resolve({ success: true, found: true, waited: Date.now() - start });
      }
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    setTimeout(function () {
      observer.disconnect();
      resolve({ success: false, found: false, waited: timeoutMs, error: '等待超时: ' + sel });
    }, timeoutMs);
  });
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
