'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const targets = require('../lib/toolTargets');

test('target builders normalize major zhihu URLs', () => {
  assert.equal(
    targets.answerUrl({ questionId: '1', answerId: '2' }),
    'https://www.zhihu.com/question/1/answer/2',
  );
  assert.equal(targets.articleUrl({ articleId: '123' }), 'https://zhuanlan.zhihu.com/p/123');
  assert.equal(targets.questionUrl({ questionId: '1' }), 'https://www.zhihu.com/question/1');
  assert.equal(targets.userUrl({ userSlug: 'alice' }), 'https://www.zhihu.com/people/alice');
});

test('search target preserves keyword and type query params', () => {
  const url = new URL(targets.searchUrl({ keyword: '大模型', type: 'content' }));
  assert.equal(url.origin + url.pathname, 'https://www.zhihu.com/search');
  assert.equal(url.searchParams.get('q'), '大模型');
  assert.equal(url.searchParams.get('type'), 'content');
});

test('target builders reject missing required values', () => {
  assert.throws(() => targets.userUrl({}), /userSlug/);
  assert.throws(() => targets.searchUrl({}), /keyword/);
});
