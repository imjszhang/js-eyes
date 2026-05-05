#!/usr/bin/env node
'use strict';

/**
 * 探当前笔记详情页（必须停在 /explore/<id>?xsec_token=...）。
 * 输出：noteContainer 关键子树 outline + 候选 selector 命中情况。
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
  const tab = tabs.find((t) => /xiaohongshu\.com\/(?:explore|discovery\/item)\//.test(t.url || ''));
  if (!tab) {
    console.error('当前没有打开笔记详情页（/explore/<id>）');
    process.exit(1);
  }
  console.error('探测 tab:', tab.id, tab.url);

  const code = `(function () {
    function outline(el, depth) {
      depth = depth || 0;
      if (!el || depth > 3) return null;
      var info = {
        tag: el.tagName,
        id: el.id || null,
        cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : null,
        textHead: (el.textContent || '').slice(0, 40),
        childCount: el.children.length,
      };
      if (depth < 2 && el.children.length > 0 && el.children.length <= 12) {
        info.children = Array.prototype.slice.call(el.children).map(function(c){return outline(c, depth+1);});
      }
      return info;
    }

    function tryHit(sels) {
      var out = {};
      sels.forEach(function (s) {
        var el = document.querySelector(s);
        out[s] = el ? { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40) } : null;
      });
      return out;
    }

    var container = document.querySelector('#noteContainer');
    var imgs = Array.prototype.slice.call(document.querySelectorAll('#noteContainer img, .swiper img, .media-container img'))
      .slice(0, 6).map(function(i){
        return { src: (i.src || '').slice(0, 120), w: i.naturalWidth, h: i.naturalHeight };
      });

    return JSON.stringify({
      url: location.href,
      hasContainer: !!container,
      containerOutline: container ? outline(container, 0) : null,
      hits: tryHit([
        '#noteContainer .engage-bar',
        '#noteContainer .like-wrapper .count',
        '#noteContainer .like-wrapper',
        '#noteContainer .interact-container',
        '#noteContainer .interact-info',
        '#noteContainer .like-active',
        '#noteContainer .interactions',
        '#noteContainer .author-wrapper .username',
        '#noteContainer .author-wrapper',
        '.note-scroller .like-wrapper .count',
        '.engage-bar-style',
        '.bottom-container .like-wrapper',
        '.bottom-container .like-active .count',
        '.bottom-container .like-active',
        '#detail-desc',
        '.note-content .desc',
      ]),
      images: imgs,
      authorAnchors: Array.prototype.slice.call(document.querySelectorAll('a[href*="/user/profile/"]'))
        .slice(0, 3).map(function(a){return { href: a.getAttribute('href'), text: (a.textContent||'').trim().slice(0, 30) };}),
    }, null, 2);
  })()`;

  const out = await browser.executeScript(tab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
