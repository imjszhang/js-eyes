'use strict';

/**
 * lib/bridgeAdapter.js
 *
 * 把 4 个 READ bridge（search/profile/post/home）的输出适配成
 * 与 lib/api.js 里 runSearchTweets / runGetProfileTweets / runGetPost / runGetHomeFeed
 * 字段级一致的结构，方便 lib/api.js 把内部实现切到 bridge 时外部签名零变化。
 *
 * 4 个 viaBridge 函数都接受调用方现成的 BrowserAutomation 实例（不重复 connect/close），
 * 内部各自构造 Session（仅借 bot 不接管），结束时只清 Session 自身状态。
 *
 * 失败时抛 Error，code 字段方便上层用 FALLBACK_REASON 分类。
 */

const { Session } = require('./session');

// 这些 helper 仍在 scripts 里——adapter 直接 require，避免重复实现。
// PR 3 在做"scripts 砍掉 READ 主流程"时会保留这些纯函数 thin wrapper。
let _searchHelpers, _profileHelpers, _homeHelpers;
function getSearchHelpers(){ return _searchHelpers || (_searchHelpers = require('../scripts/x-search')); }
function getProfileHelpers(){ return _profileHelpers || (_profileHelpers = require('../scripts/x-profile')); }
function getHomeHelpers(){ return _homeHelpers || (_homeHelpers = require('../scripts/x-home')); }

const FALLBACK_REASON = {
  DISABLED_BY_ENV: 'bridge_disabled_by_env',
  RETURN_NOT_OK: 'bridge_returned_error',
  INJECT_FAILED: 'bridge_inject_failed',
  CORRUPT: 'bridge_corrupt',
  NO_TAB: 'bridge_no_target_tab',
  BAD_ARG: 'bridge_bad_arg',
  CALL_FAILED: 'bridge_call_failed',
};

function classifyBridgeError(err) {
  if (!err) return FALLBACK_REASON.CALL_FAILED;
  switch (err.code) {
    case 'BRIDGE_RETURN_NOT_OK': return FALLBACK_REASON.RETURN_NOT_OK;
    case 'E_BRIDGE_INSTALL': return FALLBACK_REASON.INJECT_FAILED;
    case 'E_BRIDGE_CORRUPT': return FALLBACK_REASON.CORRUPT;
    case 'E_NO_TAB': return FALLBACK_REASON.NO_TAB;
    case 'E_BAD_ARG': return FALLBACK_REASON.BAD_ARG;
    default: return FALLBACK_REASON.CALL_FAILED;
  }
}

/**
 * _withSession - 公共 boilerplate：构造 Session（借 caller 的 bot），
 *                resolveTarget + ensureBridge + 调用 bridge method，最后只清 Session 自身。
 *
 * @param {object} browser - BrowserAutomation 实例（已 new，不必已 connect）
 * @param {object} opts
 * @param {string} opts.page - profile 名（search/profile/post/home）
 * @param {string} opts.targetUrl - 期望落脚的 URL（用于 reuse-or-navigate）
 * @param {boolean} [opts.verbose]
 * @param {boolean} [opts.createIfMissing=true]
 * @param {string}  [opts.method] - bridge 方法名
 * @param {Array}   [opts.args] - bridge 方法参数
 * @param {number}  [opts.timeoutMs=90000]
 */
async function _runBridgeCall(browser, opts) {
  const session = new Session({
    opts: {
      page: opts.page,
      bot: browser,
      targetUrl: opts.targetUrl || null,
      verbose: !!opts.verbose,
      createIfMissing: opts.createIfMissing !== false,
      navigateOnReuse: opts.navigateOnReuse !== false,
      reuseAnyXTab: opts.reuseAnyXTab !== false,
      createUrl: opts.createUrl || opts.targetUrl || 'https://x.com/',
    },
  });
  let bridgeMeta = null;
  let target = null;
  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();
    const resp = await session.callApi(opts.method, opts.args || [], {
      timeoutMs: opts.timeoutMs || 90000,
    });
    if (!resp || resp.ok !== true) {
      const err = new Error(
        `bridge ${opts.method} 失败: ${(resp && (resp.error || resp.message)) || 'unknown'}`,
      );
      err.code = 'BRIDGE_RETURN_NOT_OK';
      err.detail = resp;
      throw err;
    }
    return { data: resp.data || {}, target, bridge: bridgeMeta };
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// searchViaBridge
// ---------------------------------------------------------------------------

/**
 * searchViaBridge - 调用 bridges/search-bridge.js::search，
 *                   输出与 lib/api.js::runSearchTweets 字段级一致。
 */
async function searchViaBridge(browser, keyword, options = {}) {
  const opts = {
    maxPages: 1, sort: 'top',
    minLikes: 0, minRetweets: 0, minReplies: 0,
    lang: null, from: null, to: null, since: null, until: null,
    excludeReplies: false, excludeRetweets: false, hasLinks: false,
    ...options,
  };
  const S = getSearchHelpers();
  const searchUrl = S.buildSearchUrl(keyword, opts);

  const args = [{
    keyword,
    sort: opts.sort,
    maxPages: opts.maxPages,
    from: opts.from, to: opts.to,
    since: opts.since, until: opts.until,
    lang: opts.lang,
    minLikes: opts.minLikes, minRetweets: opts.minRetweets, minReplies: opts.minReplies,
    excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
    hasLinks: opts.hasLinks,
  }];

  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'search',
    targetUrl: searchUrl,
    method: 'search',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 120000,
  });

  let results = Array.isArray(data.tweets) ? data.tweets : [];
  if (opts.minLikes > 0 || opts.minRetweets > 0 || opts.minReplies > 0) {
    results = results.filter((t) =>
      (t.stats?.likes || 0) >= opts.minLikes &&
      (t.stats?.retweets || 0) >= opts.minRetweets &&
      (t.stats?.replies || 0) >= opts.minReplies,
    );
  }

  return {
    searchKeyword: keyword,
    searchUrl,
    searchOptions: {
      sort: opts.sort, maxPages: opts.maxPages,
      minLikes: opts.minLikes, minRetweets: opts.minRetweets, minReplies: opts.minReplies,
      lang: opts.lang, from: opts.from, to: opts.to,
      since: opts.since, until: opts.until,
      excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
      hasLinks: opts.hasLinks,
    },
    timestamp: new Date().toISOString(),
    totalResults: results.length,
    results,
    _bridge: {
      target,
      bridge,
      meta: data.meta || null,
      pages: data.pages || [],
      fullQuery: data.fullQuery || null,
    },
  };
}

// ---------------------------------------------------------------------------
// profileViaBridge
// ---------------------------------------------------------------------------

/**
 * profileViaBridge - 调用 bridges/profile-bridge.js::getProfile，
 *                    输出与 lib/api.js::runGetProfileTweets 字段级一致。
 */
async function profileViaBridge(browser, username, options = {}) {
  const opts = {
    maxPages: 50, maxTweets: 0,
    since: null, until: null,
    includeReplies: false, includeRetweets: false,
    minLikes: 0, minRetweets: 0,
    ...options,
  };
  const cleanUsername = String(username || '').replace(/^@/, '').trim();
  if (!cleanUsername) throw new Error('profileViaBridge: username is required');
  const profileUrl = `https://x.com/${cleanUsername}` + (opts.includeReplies ? '/with_replies' : '');

  const args = [{
    username: cleanUsername,
    maxPages: opts.maxPages,
    includeReplies: opts.includeReplies,
  }];

  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'profile',
    targetUrl: profileUrl,
    method: 'getProfile',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 120000,
  });

  const P = getProfileHelpers();
  const rawTweets = Array.isArray(data.tweets) ? data.tweets : [];
  const { filtered } = P.filterTweets(rawTweets, opts);

  let results = filtered;
  if (opts.minLikes > 0 || opts.minRetweets > 0) {
    results = results.filter((t) =>
      (t.stats?.likes || 0) >= opts.minLikes &&
      (t.stats?.retweets || 0) >= opts.minRetweets,
    );
  }
  if (opts.maxTweets > 0 && results.length > opts.maxTweets) {
    results = results.slice(0, opts.maxTweets);
  }

  return {
    username: cleanUsername,
    profile: data.profile || null,
    scrapeOptions: {
      maxPages: opts.maxPages, maxTweets: opts.maxTweets,
      since: opts.since, until: opts.until,
      includeReplies: opts.includeReplies, includeRetweets: opts.includeRetweets,
      minLikes: opts.minLikes, minRetweets: opts.minRetweets,
    },
    timestamp: new Date().toISOString(),
    totalResults: results.length,
    results,
    _bridge: {
      target,
      bridge,
      meta: data.meta || null,
      pages: data.pages || [],
    },
  };
}

// ---------------------------------------------------------------------------
// postViaBridge
// ---------------------------------------------------------------------------

function _extractTweetId(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (/^\d{6,}$/.test(s)) return s;
  const m = /\/status\/(\d+)/.exec(s);
  return m ? m[1] : null;
}

/**
 * postViaBridge - 调用 bridges/post-bridge.js::getPost，逐个 tweetId 串行调用，
 *                 输出与 lib/api.js::runGetPost 字段级一致。
 */
async function postViaBridge(browser, tweetInputs, options = {}) {
  const opts = { withThread: false, withReplies: 0, ...options };
  const inputs = Array.isArray(tweetInputs) ? tweetInputs : [tweetInputs];
  const tweetIds = inputs.map((inp) => {
    const id = _extractTweetId(inp);
    if (!id) throw new Error(`无法解析推文 ID: "${inp}"`);
    return id;
  });

  const session = new Session({
    opts: {
      page: 'post',
      bot: browser,
      targetUrl: tweetIds[0] ? `https://x.com/i/status/${tweetIds[0]}` : null,
      verbose: !!opts.verbose,
      createIfMissing: true,
      navigateOnReuse: true,
      reuseAnyXTab: true,
      createUrl: 'https://x.com/',
    },
  });
  let bridgeMeta = null;
  let target = null;
  const allResults = [];

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    for (let i = 0; i < tweetIds.length; i++) {
      const tweetId = tweetIds[i];
      const bridgeArgs = [{
        tweetId,
        withThread: !!opts.withThread,
        withReplies: !!(opts.withReplies && opts.withReplies > 0),
      }];

      try {
        const resp = await session.callApi('getPost', bridgeArgs, {
          timeoutMs: opts.bridgeTimeoutMs || 120000,
        });
        if (!resp || resp.ok !== true) {
          allResults.push({
            tweetId,
            success: false,
            error: (resp && (resp.error || resp.message)) || 'bridge_returned_not_ok',
          });
          continue;
        }
        const data = resp.data || {};
        if (!data.tweet) {
          allResults.push({ tweetId, success: false, error: 'no_focal_tweet' });
          continue;
        }
        const postData = { tweetId, success: true, ...data.tweet };
        if (Array.isArray(data.thread) && data.thread.length > 0 && opts.withThread) {
          postData.threadTweets = data.thread;
        }
        if (Array.isArray(data.replies) && data.replies.length > 0 && opts.withReplies > 0) {
          postData.replies = data.replies.slice(0, opts.withReplies);
        }
        allResults.push(postData);
      } catch (err) {
        allResults.push({
          tweetId,
          success: false,
          error: err.message || String(err),
        });
      }
      if (i < tweetIds.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await session.close();
  }

  return {
    scrapeType: 'x_post',
    scrapeOptions: { withThread: !!opts.withThread, withReplies: opts.withReplies || 0 },
    timestamp: new Date().toISOString(),
    totalRequested: tweetIds.length,
    totalSuccess: allResults.filter((r) => r.success).length,
    totalFailed: allResults.filter((r) => !r.success).length,
    results: allResults,
    _bridge: {
      target,
      bridge: bridgeMeta,
    },
  };
}

// ---------------------------------------------------------------------------
// homeViaBridge
// ---------------------------------------------------------------------------

/**
 * homeViaBridge - 调用 bridges/home-bridge.js::getHome，
 *                 输出与 lib/api.js::runGetHomeFeed 字段级一致。
 */
async function homeViaBridge(browser, options = {}) {
  const opts = {
    feed: 'foryou', maxPages: 5, maxTweets: 0,
    minLikes: 0, minRetweets: 0,
    excludeReplies: false, excludeRetweets: false,
    ...options,
  };

  const args = [{
    feed: opts.feed,
    maxPages: opts.maxPages,
  }];

  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'home',
    targetUrl: 'https://x.com/home',
    method: 'getHome',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 120000,
  });

  const H = getHomeHelpers();
  const rawTweets = Array.isArray(data.tweets) ? data.tweets : [];
  let results = H.filterTweets(rawTweets, opts);

  if (opts.minLikes > 0 || opts.minRetweets > 0) {
    results = results.filter((t) =>
      (t.stats?.likes || 0) >= opts.minLikes &&
      (t.stats?.retweets || 0) >= opts.minRetweets,
    );
  }
  if (opts.maxTweets > 0 && results.length > opts.maxTweets) {
    results = results.slice(0, opts.maxTweets);
  }

  return {
    feed: data.feed || opts.feed,
    scrapeOptions: {
      feed: opts.feed, maxPages: opts.maxPages, maxTweets: opts.maxTweets,
      minLikes: opts.minLikes, minRetweets: opts.minRetweets,
      excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
    },
    timestamp: new Date().toISOString(),
    totalResults: results.length,
    results,
    _bridge: {
      target,
      bridge,
      meta: data.meta || null,
      pages: data.pages || [],
    },
  };
}

module.exports = {
  searchViaBridge,
  profileViaBridge,
  postViaBridge,
  homeViaBridge,
  classifyBridgeError,
  FALLBACK_REASON,
};
