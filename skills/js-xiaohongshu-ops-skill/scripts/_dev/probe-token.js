#!/usr/bin/env node
'use strict';

/**
 * 探当前 search_result / user profile 页面里，xsec_token 到底放在哪里。
 * 用法：node scripts/_dev/probe-token.js
 *      （需要浏览器已停在搜索结果或用户主页）
 */

const { BrowserAutomation } = require('../../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../../lib/runtimeConfig');

(async () => {
  const runtime = resolveRuntimeConfig({});
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  await browser.connect();
  const resp = await browser.getTabs();
  const tabs = resp.tabs || [];
  const xhsTab = tabs.find((t) => /xiaohongshu\.com/.test(t.url || ''));
  if (!xhsTab) {
    console.error('未找到小红书 tab');
    process.exit(1);
  }
  console.error('探测 tab:', xhsTab.id, xhsTab.url);

  const code = `(function () {
    function inspectEl(el) {
      if (!el) return null;
      var fiberKey = Object.keys(el).find(function(k){return k.indexOf('__reactFiber$')===0;});
      var propsKey = Object.keys(el).find(function(k){return k.indexOf('__reactProps$')===0;});
      var props = propsKey ? el[propsKey] : null;
      var fiber = fiberKey ? el[fiberKey] : null;

      var fiberPropsHrefs = [];
      var fiberNote = null;
      try {
        var f = fiber;
        for (var d = 0; d < 10 && f; d++) {
          var p = f.memoizedProps;
          if (p) {
            if (typeof p.href === 'string') fiberPropsHrefs.push({ depth: d, href: p.href });
            if (p.note && typeof p.note === 'object') fiberNote = { depth: d, keys: Object.keys(p.note), id: p.note.id, xsec_token: p.note.xsec_token, xsec_source: p.note.xsec_source, link: p.note.link };
            if (p.noteCard) fiberPropsHrefs.push({ depth: d, noteCard: Object.keys(p.noteCard) });
          }
          f = f.return;
        }
      } catch (e) {}

      return {
        tag: el.tagName,
        attrHref: el.getAttribute && el.getAttribute('href'),
        propsHref: props && props.href,
        propsKeys: props ? Object.keys(props) : null,
        fiberPropsHrefs: fiberPropsHrefs,
        fiberNote: fiberNote,
        textContent: (el.textContent || '').slice(0, 50),
      };
    }

    var sample = document.querySelectorAll('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
    var first3 = [];
    for (var i = 0; i < Math.min(3, sample.length); i++) {
      first3.push(inspectEl(sample[i]));
    }

    var initialState = null;
    try {
      if (window.__INITIAL_STATE__) {
        initialState = JSON.stringify(window.__INITIAL_STATE__).slice(0, 500);
      }
    } catch (e) {}

    return JSON.stringify({
      url: location.href,
      sampleCount: sample.length,
      first3: first3,
      hasInitialState: !!window.__INITIAL_STATE__,
      initialStateSnippet: initialState,
    }, null, 2);
  })()`;

  const out = await browser.executeScript(xhsTab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
