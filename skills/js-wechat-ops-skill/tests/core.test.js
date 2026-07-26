'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractWechatContent, scrapeWechatArticle } = require('../lib/wechatUtils');
const definition = require('../skill.definition');

test('extractWechatContent preserves rich text and metadata', () => {
  const url = 'https://mp.weixin.qq.com/s/example';
  const html = `
    <meta name="description" content="摘要">
    <meta name="author" content="作者">
    <meta property="og:image" content="https://img.example/cover.jpg">
    <h1 class="rich_media_title">标题</h1>
    <div class="rich_media_content"><h2>章节</h2><p>正文<strong>重点</strong></p></div>`;
  const result = extractWechatContent(html, url, ['https://img.example/body.jpg']);
  assert.equal(result.title, '标题');
  assert.equal(result.author, '作者');
  assert.match(result.content, /## 章节/);
  assert.match(result.content, /\\*\\*重点\\*\\*/);
  assert.deepEqual(result.image_urls, ['https://img.example/body.jpg']);
});

test('scraper rejects non-WeChat URLs before browser access', async () => {
  await assert.rejects(
    scrapeWechatArticle({}, 'https://example.com/article'),
    /URL 不属于微信公众号文章/,
  );
  assert.equal(definition.TOOL_DEFINITIONS[0].name, 'wechat_get_article');
});
