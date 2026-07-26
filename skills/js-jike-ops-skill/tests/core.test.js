'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJikeContent } = require('../lib/jikeUtils');
const definition = require('../skill.definition');

test('extractJikeContent returns stable post fields from a minimal page', () => {
  const url = 'https://web.okjike.com/originalPost/post-1';
  const html = `
    <main class="mantine-Container-root">
      <article data-clickable-feedback="false">
        <header><a href="/u/alice">Alice</a><span>2026/7/26</span></header>
        <div>这是一段足够长的即刻帖子正文，用于验证结构化内容抽取结果。</div>
        <a href="/topic/ai">AI</a>
        <img alt="图片" src="https://cdn.example/post.jpg">
      </article>
    </main>`;
  const result = extractJikeContent(html, url);
  assert.equal(result.author_name, 'Alice');
  assert.equal(result.author_id, 'alice');
  assert.match(result.content, /即刻帖子正文/);
  assert.equal(result.topic_name, 'AI');
  assert.deepEqual(result.image_urls, ['https://cdn.example/post.jpg']);
  assert.equal(result.source_url, url);
});

test('definition exposes one read-only tool', () => {
  assert.equal(definition.TOOL_DEFINITIONS.length, 1);
  assert.equal(definition.TOOL_DEFINITIONS[0].name, 'jike_get_post');
  assert.equal(definition.TOOL_DEFINITIONS[0].risk, 'read');
});
