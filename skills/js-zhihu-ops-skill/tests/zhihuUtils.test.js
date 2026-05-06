'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractZhihuAnswerContent,
  extractZhihuArticleContent,
} = require('../lib/zhihuUtils');

test('legacy answer extractor keeps compatible fields', () => {
  const html = `
    <html><head>
      <meta itemprop="name" content="问题标题">
      <meta itemprop="upvoteCount" content="12">
      <meta itemprop="commentCount" content="3">
    </head><body>
      <div class="ContentItem AnswerItem" data-zop='{"authorName":"作者A"}'>
        <div class="RichContent-inner"><span class="RichText" itemprop="text"><p>回答正文</p></span></div>
      </div>
    </body></html>`;
  const result = extractZhihuAnswerContent(html, 'https://www.zhihu.com/question/1/answer/2');
  assert.equal(result.title, '问题标题');
  assert.equal(result.author_name, '作者A');
  assert.match(result.content, /回答正文/);
  assert.equal(result.upvote_count, '12');
  assert.equal(result.comment_count, '3');
});

test('legacy article extractor keeps compatible fields', () => {
  const html = `
    <html><head><meta property="og:title" content="文章标题 - 知乎"></head><body>
      <div class="AuthorInfo"><meta itemprop="name" content="作者B"></div>
      <div class="ContentItem-time">发布于 2026-01-01</div>
      <div class="Post-RichTextContainer">文章正文</div>
      <button class="VoteButton--up">已赞同 7</button>
      <button class="BottomActions-CommentBtn">2 条评论</button>
    </body></html>`;
  const result = extractZhihuArticleContent(html, 'https://zhuanlan.zhihu.com/p/123');
  assert.equal(result.title, '文章标题');
  assert.equal(result.author_name, '作者B');
  assert.match(result.content, /文章正文/);
});
