'use strict';

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    const err = new Error(`${name} 必须是非空字符串`);
    err.code = 'E_BAD_ARG';
    throw err;
  }
  return value.trim();
}

function normalizeUrl(input, fallbackBase = 'https://www.zhihu.com') {
  const raw = assertString(input, 'url');
  try {
    return new URL(raw).toString();
  } catch (_) {
    return new URL(raw, fallbackBase).toString();
  }
}

function answerUrl({ url, questionId, answerId } = {}) {
  if (url) return normalizeUrl(url, 'https://www.zhihu.com');
  const q = assertString(questionId, 'questionId');
  const a = assertString(answerId, 'answerId');
  return `https://www.zhihu.com/question/${encodeURIComponent(q)}/answer/${encodeURIComponent(a)}`;
}

function articleUrl({ url, articleId } = {}) {
  if (url) return normalizeUrl(url, 'https://zhuanlan.zhihu.com');
  const id = assertString(articleId, 'articleId');
  return `https://zhuanlan.zhihu.com/p/${encodeURIComponent(id)}`;
}

function questionUrl({ url, questionId } = {}) {
  if (url) return normalizeUrl(url, 'https://www.zhihu.com');
  const id = assertString(questionId, 'questionId');
  return `https://www.zhihu.com/question/${encodeURIComponent(id)}`;
}

function searchUrl({ keyword, type } = {}) {
  const q = assertString(keyword, 'keyword');
  const u = new URL('https://www.zhihu.com/search');
  u.searchParams.set('q', q);
  if (type) u.searchParams.set('type', String(type));
  return u.toString();
}

function userUrl({ url, userSlug, userId } = {}) {
  if (url) return normalizeUrl(url, 'https://www.zhihu.com');
  const slug = assertString(userSlug || userId, 'userSlug');
  return `https://www.zhihu.com/people/${encodeURIComponent(slug)}`;
}

function homeUrl() {
  return 'https://www.zhihu.com/';
}

module.exports = {
  answerUrl,
  articleUrl,
  questionUrl,
  searchUrl,
  userUrl,
  homeUrl,
  normalizeUrl,
};
