'use strict';

/**
 * X 帖子 / Article URL 分类与规范化（Node + 测试共用；browser bridge 内联副本见 post-bridge.js）。
 */

const X_HOST_RE = /(?:^|\.)(?:x\.com|twitter\.com)$/i;
const TCO_HOST_RE = /^t\.co$/i;

function normalizeUrlString(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\//.test(raw) || /^[\w.-]+\?/.test(raw)) return `https://${raw}`;
  return raw;
}

function tryParseUrl(input) {
  const normalized = normalizeUrlString(input);
  if (!normalized || !/^https?:\/\//i.test(normalized)) return null;
  try {
    return new URL(normalized);
  } catch (_) {
    return null;
  }
}

/** @returns {string|null} */
function extractTweetId(input) {
  const raw = String(input || '').trim();
  if (/^\d{6,}$/.test(raw)) return raw;
  const u = tryParseUrl(raw);
  if (u) {
    const m = /\/status\/(\d+)/.exec(`${u.pathname}${u.search}`);
    if (m) return m[1];
    const articleSeed = /^\/(?!i\/)[^/]+\/article\/(\d+)/.exec(u.pathname);
    if (articleSeed) return articleSeed[1];
  }
  const m = /\/status\/(\d+)/.exec(raw);
  return m ? m[1] : null;
}

/** @returns {string|null} */
function extractArticleId(input) {
  const raw = String(input || '').trim();
  const u = tryParseUrl(raw);
  if (u) {
    const m = /\/i\/article\/(\d+)/.exec(u.pathname);
    if (m) return m[1];
  }
  const m = /\/i\/article\/(\d+)/.exec(raw);
  return m ? m[1] : null;
}

/**
 * @typedef {'tweet'|'article'|'short'|'unknown'} XPostContentKind
 * @typedef {{ kind: XPostContentKind, tweetId?: string, articleId?: string, url?: string, raw: string }} XPostClassification
 */

/**
 * @param {string} input
 * @returns {XPostClassification}
 */
function classifyXPostInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'unknown', raw };

  if (/^\d{6,}$/.test(raw)) {
    return { kind: 'tweet', tweetId: raw, raw };
  }

  const u = tryParseUrl(raw);
  if (u) {
    if (TCO_HOST_RE.test(u.hostname)) {
      return { kind: 'short', url: u.href, raw };
    }
    if (X_HOST_RE.test(u.hostname)) {
      const articleId = extractArticleId(u.href);
      if (articleId) {
        return {
          kind: 'article',
          articleId,
          url: `https://x.com/i/article/${articleId}`,
          raw,
        };
      }
      const canonicalArticle = /^\/(?!i\/)[^/]+\/article\/(\d+)/.exec(u.pathname);
      if (canonicalArticle) {
        return { kind: 'tweet', tweetId: canonicalArticle[1], url: u.href, raw };
      }
      const tweetId = extractTweetId(u.href);
      if (tweetId) {
        return { kind: 'tweet', tweetId, url: u.href, raw };
      }
    }
  }

  const articleId = extractArticleId(raw);
  if (articleId) {
    return {
      kind: 'article',
      articleId,
      url: `https://x.com/i/article/${articleId}`,
      raw,
    };
  }

  const tweetId = extractTweetId(raw);
  if (tweetId) {
    return { kind: 'tweet', tweetId, raw };
  }

  return { kind: 'unknown', raw };
}

/**
 * runTool / bridge 导航用 URL
 * @param {XPostClassification} cls
 * @param {string} [rawInput]
 * @returns {string|null}
 */
function canonicalNavigateUrl(cls, rawInput) {
  if (!cls || cls.kind === 'unknown') return null;
  if (cls.url) return cls.url;
  if (cls.kind === 'short') {
    const u = tryParseUrl(rawInput || cls.raw);
    return u ? u.href : null;
  }
  if (cls.kind === 'article' && cls.articleId) {
    return `https://x.com/i/article/${cls.articleId}`;
  }
  if (cls.kind === 'tweet' && cls.tweetId) {
    return `https://x.com/i/status/${cls.tweetId}`;
  }
  return null;
}

/**
 * @param {XPostClassification} cls
 * @param {object} [options]
 * @returns {object}
 */
function buildPostBridgeArgs(cls, options = {}) {
  const args = {
    withThread: !!options.withThread,
    withReplies: !!(options.withReplies && options.withReplies > 0),
    ...(Number.isFinite(Number(options.budgetMs)) && Number(options.budgetMs) > 0
      ? { budgetMs: Number(options.budgetMs) } : {}),
  };

  if (!cls || cls.kind === 'unknown') return args;

  if (cls.kind === 'article') {
    return Object.assign(args, {
      contentKind: 'article',
      articleId: cls.articleId,
      url: cls.url || canonicalNavigateUrl(cls),
    });
  }

  if (cls.kind === 'short') {
    return Object.assign(args, {
      contentKind: 'short',
      url: cls.url || canonicalNavigateUrl(cls, cls.raw),
    });
  }

  return Object.assign(args, {
    contentKind: 'tweet',
    tweetId: cls.tweetId,
    url: cls.url || null,
  });
}

function isResolvablePostInput(input) {
  return classifyXPostInput(input).kind !== 'unknown';
}

function postResultKey(cls) {
  if (!cls) return 'tweetId';
  if (cls.kind === 'article') return 'articleId';
  return 'tweetId';
}

module.exports = {
  X_HOST_RE,
  TCO_HOST_RE,
  normalizeUrlString,
  extractTweetId,
  extractArticleId,
  classifyXPostInput,
  canonicalNavigateUrl,
  buildPostBridgeArgs,
  isResolvablePostInput,
  postResultKey,
};
