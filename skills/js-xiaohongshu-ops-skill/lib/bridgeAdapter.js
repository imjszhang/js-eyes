'use strict';

/**
 * lib/bridgeAdapter.js
 *
 * 把 bridge 单次 `session.callApi(method)` 输出适配成与 lib/api.js 字段一致的结构。
 * 与 X 同名文件对位；未来 lib/api.js 在启用 bridge 时统一通过 lib/runTool.js，
 * 本文件仍导出 `*ViaBridge` 供外部直接复用或测试，并以 `classifyBridgeError`
 * + `FALLBACK_REASON` 服务 api.js 的兜底分类。
 */

const { Session } = require('./session');

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

async function _runBridgeCall(browser, opts) {
  const session = new Session({
    opts: {
      page: opts.page,
      bot: browser,
      targetUrl: opts.targetUrl || null,
      verbose: !!opts.verbose,
      createIfMissing: opts.createIfMissing !== false,
      navigateOnReuse: opts.navigateOnReuse !== false,
      reuseAnyXhsTab: opts.reuseAnyXhsTab !== false,
      createUrl: opts.createUrl || opts.targetUrl || 'https://www.xiaohongshu.com/',
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

async function noteViaBridge(browser, urlOrId, options = {}) {
  const opts = { withComments: false, maxCommentPages: 0, ...options };
  const args = [{
    url: typeof urlOrId === 'string' ? urlOrId : null,
    noteId: opts.noteId || null,
    withComments: !!opts.withComments,
    maxCommentPages: Number(opts.maxCommentPages || 0),
  }];
  const targetUrl = typeof urlOrId === 'string' ? urlOrId : null;
  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'note',
    targetUrl,
    method: 'getNote',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 90000,
  });
  return { data, target, bridge };
}

async function commentsViaBridge(browser, urlOrId, options = {}) {
  const opts = { maxCommentPages: 1, ...options };
  const args = [{
    url: typeof urlOrId === 'string' ? urlOrId : null,
    noteId: opts.noteId || null,
    maxCommentPages: Number(opts.maxCommentPages || 1),
  }];
  const targetUrl = typeof urlOrId === 'string' ? urlOrId : null;
  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'note',
    targetUrl,
    method: 'getComments',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 90000,
  });
  return { data, target, bridge };
}

async function searchViaBridge(browser, keyword, options = {}) {
  const opts = { limit: 10, ...options };
  const args = [{
    keyword,
    limit: opts.limit,
    channelType: opts.channelType || '全部',
    sortBy: opts.sortBy || undefined,
    contentType: opts.contentType || undefined,
    timeRange: opts.timeRange || undefined,
    searchScope: opts.searchScope || undefined,
    extractDetails: !!opts.extractDetails,
  }];
  const { buildSearchUrl } = require('./xhsUtils');
  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'search',
    targetUrl: buildSearchUrl({ keyword }),
    method: 'search',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 180000,
  });
  return { data, target, bridge };
}

async function userViaBridge(browser, userId, options = {}) {
  const opts = { ...options };
  const args = [{ userId }];
  const { buildUserUrl } = require('./xhsUtils');
  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'user',
    targetUrl: buildUserUrl(userId),
    method: 'getUser',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 90000,
  });
  return { data, target, bridge };
}

async function userNotesViaBridge(browser, userId, options = {}) {
  const opts = { maxPages: 3, ...options };
  const args = [{ userId, maxPages: opts.maxPages }];
  const { buildUserUrl } = require('./xhsUtils');
  const { data, target, bridge } = await _runBridgeCall(browser, {
    page: 'user',
    targetUrl: buildUserUrl(userId),
    method: 'getUserNotes',
    args,
    verbose: opts.verbose,
    timeoutMs: opts.bridgeTimeoutMs || 180000,
  });
  return { data, target, bridge };
}

module.exports = {
  noteViaBridge,
  commentsViaBridge,
  searchViaBridge,
  userViaBridge,
  userNotesViaBridge,
  classifyBridgeError,
  FALLBACK_REASON,
};
