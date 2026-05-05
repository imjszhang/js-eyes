'use strict';

/**
 * monitor fetchUserNotes - 复用 lib/runTool.js 跑 xhs_get_user_notes 拉单个用户的笔记列表。
 *
 * 返回：{ ok, notes: [...], userId, meta }
 */

const { runTool } = require('../runTool');
const { buildUserUrl } = require('../xhsUtils');

async function fetchUserNotes(browser, settings, options = {}) {
  const userId = settings.userId || settings.username;
  try {
    const resp = await runTool(browser, {
      toolName: 'xhs_monitor_user_notes',
      pageKey: 'user',
      method: 'getUserNotes',
      cmdDef: { methodBase: 'getUserNotes', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      args: { userId, maxPages: settings.maxPagesPerCheck || 1 },
      targetUrl: buildUserUrl(userId),
      options: {
        wsEndpoint: options.wsEndpoint || undefined,
        recording: options.recording,
        verbose: !!options.verbose,
        navigateOnReuse: true,
        reuseAnyXhsTab: true,
        timeoutMs: 180000,
      },
    });
    const notes = (resp && resp.result && Array.isArray(resp.result.notes)) ? resp.result.notes : [];
    return {
      ok: !!resp.ok,
      userId,
      notes,
      meta: { runId: resp.run?.id || null, durationMs: resp.run?.durationMs || null, antiCrawlState: resp.antiCrawlState || null },
      error: resp.ok ? null : (resp.error || null),
    };
  } catch (err) {
    return { ok: false, userId, notes: [], meta: null, error: { message: err.message, code: err.code || null } };
  }
}

module.exports = { fetchUserNotes };
