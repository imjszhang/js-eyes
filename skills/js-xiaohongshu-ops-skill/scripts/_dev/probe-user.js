#!/usr/bin/env node
'use strict';

/**
 * 探当前 user profile 页的 follows/fans/interactions selector + 用户笔记卡片 token 候选位置。
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
  const tab = tabs.find((t) => /xiaohongshu\.com\/user\/profile\//.test(t.url || ''));
  if (!tab) { console.error('需在用户主页 (/user/profile/<id>)'); process.exit(1); }
  console.error('探测 tab:', tab.id, tab.url);

  const code = `(function () {
    function tryHit(sels) {
      var out = {};
      sels.forEach(function (s) {
        var ns = document.querySelectorAll(s);
        out[s] = ns.length === 0 ? null : { count: ns.length, samples: Array.prototype.slice.call(ns).slice(0, 3).map(function(n){return { tag: n.tagName, text: (n.textContent||'').trim().slice(0, 30) };}) };
      });
      return out;
    }

    // 探用户笔记卡片的所有 <a>
    var firstNoteCard = document.querySelector('.feeds-container .note-item, section.note-item, .user-note-item');
    var cardAnchors = null;
    if (firstNoteCard) {
      cardAnchors = Array.prototype.slice.call(firstNoteCard.querySelectorAll('a'))
        .map(function (a) {
          var fiberKey = Object.keys(a).find(function(k){return k.indexOf('__reactFiber$')===0;});
          var propsKey = Object.keys(a).find(function(k){return k.indexOf('__reactProps$')===0;});
          var fiberHrefs = [];
          var fiberNote = null;
          try {
            var f = fiberKey ? a[fiberKey] : null;
            for (var d = 0; d < 8 && f; d++) {
              var p = f.memoizedProps;
              if (p && typeof p.href === 'string') fiberHrefs.push({ depth: d, href: p.href.slice(0, 100) });
              if (p && p.note && typeof p.note === 'object') {
                fiberNote = { depth: d, keys: Object.keys(p.note), id: p.note.id, xsec_token: p.note.xsec_token, link: p.note.link };
                break;
              }
              f = f.return;
            }
          } catch (e) {}
          return {
            cls: (a.className || '').slice(0, 50),
            attrHref: (a.getAttribute('href') || '').slice(0, 100),
            propsHref: propsKey && a[propsKey] && a[propsKey].href ? a[propsKey].href.slice(0, 100) : null,
            fiberHrefs: fiberHrefs,
            fiberNote: fiberNote,
          };
        });
    }

    return JSON.stringify({
      url: location.href,
      stats: tryHit([
        '.user-info .follows .count',
        '.user-info .fans .count',
        '.user-info',
        '.user-interactions',
        '.user-interactions .interactions',
        '.user-interactions span',
        '.user-stats',
        '.user-info-stats',
        '.user-statistics',
        '.user-page .info',
        '.info-bottom',
        '[data-stat]',
        '.user-info-status .count',
        '.user-info-status',
      ]),
      firstNoteCardCls: firstNoteCard ? (firstNoteCard.className || '').slice(0, 80) : null,
      cardAnchors: cardAnchors,
      hasInitialState: !!window.__INITIAL_STATE__,
    }, null, 2);
  })()`;

  const out = await browser.executeScript(tab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
