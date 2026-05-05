#!/usr/bin/env node
'use strict';

/**
 * 探当前 search_result 页：
 *  - 频道 Tab（#channel-container 子树）
 *  - 筛选面板触发与内容（包含 .filters-wrapper）
 *  - 详情弹窗结构（验证「同 tab + back」假设：是否 modal 而非新 route）
 *  - 历史字段：searchTabs / suggestKeywords / relatedSearchKeywords
 *
 * 用法：
 *   1. 浏览器内打开 https://www.xiaohongshu.com/search_result?keyword=美食
 *   2. node scripts/_dev/probe-search.js
 *   3. 如要探详情弹窗，先点开任意一条笔记后再跑一次（脚本会自动判断是否在弹窗态）
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
        var ns;
        try { ns = document.querySelectorAll(s); } catch (_) { ns = []; }
        out[s] = ns.length === 0 ? null : { count: ns.length, samples: Array.prototype.slice.call(ns).slice(0, 6).map(function(n){return (n.textContent||'').trim().slice(0, 40);}) };
      });
      return out;
    }
    function dumpChildren(root, max) {
      if (!root) return null;
      var children = Array.prototype.slice.call(root.children || []).slice(0, max || 20);
      return children.map(function (c) {
        return {
          tag: c.tagName.toLowerCase(),
          cls: (c.className && typeof c.className === 'string') ? c.className.slice(0, 80) : '',
          role: c.getAttribute('role') || null,
          text: (c.textContent || '').trim().slice(0, 30),
        };
      });
    }
    // 频道 Tab：参考 xhsSearch.js 走 #channel-container
    var channelContainer = document.querySelector('#channel-container');
    var channel = {
      hasChannelContainer: !!channelContainer,
      childrenSample: dumpChildren(channelContainer, 12),
      probableTabs: channelContainer
        ? Array.prototype.slice.call(channelContainer.querySelectorAll('div[role="button"], button, span, a'))
            .slice(0, 30)
            .map(function (n) { return (n.textContent || '').trim().slice(0, 20); })
            .filter(function (t) { return t && t.length < 8; })
        : null,
    };

    // 筛选面板：先看是否已开（有 .filters-wrapper），再列「筛选」触发候选
    var filtersWrapper = document.querySelector('.filters-wrapper');
    var filterTriggerCandidates = [];
    Array.prototype.slice.call(document.querySelectorAll('span,div,button'))
      .forEach(function (n) {
        var t = (n.textContent || '').trim();
        if (t === '筛选' && filterTriggerCandidates.length < 6) {
          filterTriggerCandidates.push({
            tag: n.tagName.toLowerCase(),
            cls: (n.className && typeof n.className === 'string') ? n.className.slice(0, 60) : '',
            childCount: n.children.length,
          });
        }
      });
    var filterRows = null;
    if (filtersWrapper) {
      filterRows = Array.prototype.slice.call(filtersWrapper.querySelectorAll('div'))
        .slice(0, 40)
        .map(function (d) {
          return { text: (d.textContent || '').trim().slice(0, 60), cls: (d.className || '').slice(0, 40) };
        })
        .filter(function (r) { return r.text.length > 0 && r.text.length < 80; });
    }
    var filter = {
      panelOpen: !!filtersWrapper,
      triggerCandidates: filterTriggerCandidates,
      filterRowsSample: filterRows,
    };

    // 详情弹窗：判断是否「同 tab + 模态」
    var noteContainer = document.querySelector('#noteContainer');
    var feedsContainer = document.querySelector('.feeds-container');
    var closeButtons = Array.prototype.slice.call(document.querySelectorAll('.close-circle .close, [class*="close-circle"], [class*="modal"] [class*="close"]'))
      .slice(0, 5)
      .map(function (n) { return { cls: (n.className || '').slice(0, 60), tag: n.tagName.toLowerCase() }; });
    var detail = {
      isOnSearchResult: /\\/search_result/.test(location.pathname),
      hasNoteContainer: !!noteContainer,
      hasFeedsContainer: !!feedsContainer,
      modalLikely: !!(noteContainer && feedsContainer),
      closeButtonCandidates: closeButtons,
      noteContainerOuterShape: noteContainer ? {
        tag: noteContainer.tagName.toLowerCase(),
        cls: (noteContainer.className || '').slice(0, 80),
        rectTop: noteContainer.getBoundingClientRect().top,
      } : null,
    };

    return JSON.stringify({
      url: location.href,
      channel: channel,
      filter: filter,
      detail: detail,
      legacy: {
        // 旧版 search-bridge 走的 selector，留作参考
        tabs: tryHit([
          '.search-channel-list li',
          '.channel-list .channel',
          '.tab-list .tab',
        ]),
        suggest: tryHit([
          '.search-tip li',
          '.suggest-list li',
          '.search-suggest-list li',
          '[class*="suggest"] li',
        ]),
        related: tryHit([
          '.related-search a',
          '.related-search-wrap a',
          '.recommend-tag',
          '[class*="related"] a',
        ]),
      },
    }, null, 2);
  })()`;

  const out = await browser.executeScript(tab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
