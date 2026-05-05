#!/usr/bin/env node
'use strict';

/**
 * 探当前 search_result 页：searchTabs / suggestKeywords / relatedSearchKeywords 真实节点。
 */

const { BrowserAutomation } = require('../../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../../lib/runtimeConfig');

(async () => {
  const runtime = resolveRuntimeConfig({});
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  await browser.connect();
  const tabs = (await browser.getTabs()).tabs || [];
  const tab = tabs.find((t) => /xiaohongshu\.com\/search_result/.test(t.url || ''));
  if (!tab) { console.error('需在搜索结果页 (/search_result?keyword=...)'); process.exit(1); }
  console.error('探测 tab:', tab.id, tab.url);

  const code = `(function () {
    function tryHit(sels) {
      var out = {};
      sels.forEach(function (s) {
        var ns = document.querySelectorAll(s);
        out[s] = ns.length === 0 ? null : { count: ns.length, samples: Array.prototype.slice.call(ns).slice(0, 6).map(function(n){return (n.textContent||'').trim().slice(0, 30);}) };
      });
      return out;
    }
    return JSON.stringify({
      url: location.href,
      // 搜索 tab 切换器（"图文/视频/直播/笔记..."）
      tabs: tryHit([
        '.search-channel-list li',
        '.channel-list .channel',
        '.tab-list .tab',
        '.feeds-tab-bar a',
        '.search-tab-list a',
        '.search-channel-tab',
        '#globalSearchTab a',
        '[class*="searchTab"] a',
        '.feeds-page .tab',
      ]),
      // 联想词
      suggest: tryHit([
        '.search-tip li',
        '.suggest-list li',
        '.search-input-box .suggestion',
        '.search-suggest-list li',
        '[class*="suggest"] li',
      ]),
      // 相关搜索
      related: tryHit([
        '.related-search a',
        '.related-search-wrap a',
        '.recommend-tag',
        '.recommend-tags a',
        '[class*="related"] a',
        '.relevant-search a',
        '.guess-search a',
      ]),
    }, null, 2);
  })()`;

  const out = await browser.executeScript(tab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
