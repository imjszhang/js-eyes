#!/usr/bin/env node
'use strict';

const { BrowserAutomation } = require('../../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../../lib/runtimeConfig');

(async () => {
  const runtime = resolveRuntimeConfig({});
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  await browser.connect();
  const tabs = (await browser.getTabs()).tabs || [];
  const tab = tabs.find((t) => /xiaohongshu\.com\/explore\//.test(t.url || ''));
  if (!tab) { console.error('需在笔记详情页'); process.exit(1); }
  console.error('探测 tab:', tab.id, tab.url);

  const code = `(async function () {
    var m = location.pathname.match(/\\/explore\\/([\\w-]+)/);
    var u = new URL(location.href);
    var noteId = m ? m[1] : null;
    var xsec = u.searchParams.get('xsec_token') || '';
    var apiUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'
      + '?note_id=' + encodeURIComponent(noteId)
      + '&cursor='
      + '&top_comment_id='
      + '&image_formats=jpg,webp,avif'
      + '&xsec_token=' + encodeURIComponent(xsec);
    try {
      var resp = await fetch(apiUrl, { credentials: 'include' });
      var status = resp.status;
      var json = null;
      try { json = await resp.json(); } catch(e) { json = { _parseErr: String(e) }; }
      var dataKeys = json && json.data ? Object.keys(json.data) : null;
      var commentsLen = json && json.data && Array.isArray(json.data.comments) ? json.data.comments.length : null;
      var sample = json && json.data && Array.isArray(json.data.comments) && json.data.comments[0]
        ? Object.keys(json.data.comments[0]) : null;
      return JSON.stringify({
        url: apiUrl,
        status: status,
        topKeys: json ? Object.keys(json).slice(0, 10) : null,
        success: json && json.success,
        code: json && json.code,
        msg: json && json.msg,
        dataKeys: dataKeys,
        commentsLen: commentsLen,
        firstCommentKeys: sample,
        rawBody: JSON.stringify(json).slice(0, 800),
      }, null, 2);
    } catch (e) {
      return JSON.stringify({ fetchError: String(e) }, null, 2);
    }
  })()`;

  const out = await browser.executeScript(tab.id, code);
  console.log(out);
  browser.disconnect();
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
