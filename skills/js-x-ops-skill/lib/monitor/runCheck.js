'use strict';

/**
 * monitor runCheck - 单次 check 主循环
 *
 * 架构（PR-2 拆分后）：
 *
 *   runCheckCore({ config, browser, options })
 *     └─ fetchAccount → partitionNewTweets → state 读写
 *        仅做抓取 + 去重 + 持久化。不触发任何通知，不解析 channel。
 *        返回 { ok, accounts: [{ username, fresh:[{tweet,record}], seen, ... }], totals }
 *        供第三方（moltbook KolPatrol 等）以"库"形式复用 monitor 的抓-去重-状态机。
 *
 *   runCheck({ config, browser, options })
 *     └─ runCheckCore → 循环 dispatch(channels, tweet) → 写回 record.notifiedAt
 *        维持原有"抓 → dedup → notify → 落盘"一条龙 CLI / daemon 行为。
 *
 * 输入：config（已 load + validate）、runtime { browser, recording, logger }
 * 输出：
 *   - runCheckCore: { ok, startedAt, finishedAt, durationMs, accounts, totals }
 *     accounts: [{ username, ok, fetched, fresh, freshEntries, seen, error, meta }]
 *     注意 runCheckCore 返回的 accounts[i].freshEntries 是 [{ tweet, record }]，
 *     尚未被 notify，便于外部自行分发。
 *   - runCheck: 兼容原来的 { ok, startedAt, ..., accounts: [{..., notified, notifyFailed, channels}] }
 *
 * options 字段（两层共享）：
 *   singleUsername?  只跑指定账号
 *   dryNotify?       仅 runCheck 生效
 *   dryState?        不落盘 state（writeState 的别名，true 时 writeState=false）
 *   writeState?      默认 true；false 时 runCheckCore 不写 state 文件
 *   sendNotifications? 仅 runCheck 生效，false 时跳过 dispatch 并打 skipped 标记
 *   logger?          { info, warn, error }
 *   recording?       透传 recording 配置给 fetchAccount → getProfileTweets
 *   debugSteps?      数组，push 阶段事件（runCheckCore 会 push fetch/dedup 事件）
 *   stateHome?       string，覆盖 monitor home 基目录；优先级：options.stateHome > env JS_X_MONITOR_HOME > 默认
 */

const { fetchAccount } = require('./fetchAccount');
const { loadState, saveState } = require('./state');
const { partitionNewTweets, pruneExpired } = require('./dedup');
const { dispatch } = require('./notify');
const { effectiveAccountSettings } = require('./config');

function resolveChannelsByNames(channelNames, configChannels) {
  const byName = new Map((configChannels || []).map((c) => [c.name, c]));
  const resolved = [];
  const missing = [];
  for (const name of channelNames || []) {
    const ch = byName.get(name);
    if (ch) resolved.push(ch);
    else missing.push(name);
  }
  return { resolved, missing };
}

function makeLogger(logger) {
  return logger || { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
}

function makeStep(debugSteps) {
  if (!Array.isArray(debugSteps)) return () => {};
  return (stage, payload) => {
    debugSteps.push(Object.assign({ stage, ts: new Date().toISOString() }, payload || {}));
  };
}

function stateHomeOpts(options) {
  if (options && options.stateHome) return { home: options.stateHome };
  return undefined;
}

/**
 * 抓取 + 去重 + state 读写。不触发通知，不解析 channel。
 *
 * 返回的 accounts[i].freshEntries 是 [{ tweet, record }]，
 * 外部可以遍历 freshEntries，对每一条 tweet 自行做业务处理，
 * 之后如果还要把"已通知/已处理"状态持久化到 record，就需要额外在
 * 返回的 state 上追加并 saveState（但 runCheckCore 已经在内部 saveState
 * 过一次 pruneExpired + lastCheck；如果需要二次持久化，传 writeState=false
 * 再由外部自行 saveState）。
 *
 * @param {Object} params
 * @param {Object} params.config   内存中的 config 对象（需先通过 validateConfig 校验）
 * @param {import('../js-eyes-client').BrowserAutomation} params.browser
 * @param {Object} [params.options]
 * @returns {Promise<Object>}
 */
async function runCheckCore({ config, browser, options = {} }) {
  const startedAt = new Date();
  const logger = makeLogger(options.logger);
  const pushStep = makeStep(options.debugSteps);
  const homeOpts = stateHomeOpts(options);

  pushStep('check_start', { singleUsername: options.singleUsername || null });

  const accounts = (config.accounts || []).filter((a) => {
    if (options.singleUsername) {
      return String(a.username).toLowerCase() === String(options.singleUsername).toLowerCase();
    }
    return a.enabled !== false;
  });

  const perAccount = [];
  let totalFetched = 0;
  let totalFresh = 0;

  for (const account of accounts) {
    const settings = effectiveAccountSettings(account, config);
    const acctResult = {
      username: settings.username,
      ok: true,
      fetched: 0,
      fresh: 0,
      freshEntries: [],
      seen: 0,
      error: null,
      meta: null,
      state: null,
    };

    try {
      pushStep('fetch_start', { username: settings.username });
      const fetchResult = await fetchAccount(browser, settings, {
        logger: options.logger,
        recording: options.recording,
      });
      acctResult.meta = fetchResult.meta;
      pushStep('fetch_done', {
        username: settings.username,
        ok: fetchResult.ok,
        rawCount: fetchResult.rawCount,
        filteredCount: fetchResult.tweets.length,
        meta: fetchResult.meta,
      });
      if (!fetchResult.ok) {
        acctResult.ok = false;
        acctResult.error = fetchResult.error;
        perAccount.push(acctResult);
        continue;
      }
      acctResult.fetched = fetchResult.tweets.length;
      totalFetched += fetchResult.tweets.length;

      const state = loadState(settings.username, homeOpts);
      const method = config.deduplication?.method || 'id_and_hash';
      const nowIso = new Date().toISOString();
      const { fresh, seen } = partitionNewTweets(fetchResult.tweets, state, method, nowIso);
      acctResult.fresh = fresh.length;
      acctResult.freshEntries = fresh;
      acctResult.seen = seen.length;
      totalFresh += fresh.length;
      pushStep('dedup', {
        username: settings.username,
        method,
        knownCount: state.tweets.length,
        freshCount: fresh.length,
        seenCount: seen.length,
      });

      for (const { record } of fresh) {
        state.tweets.unshift(record);
      }
      state.tweets = pruneExpired(state.tweets, config.deduplication?.historyDays || 30);
      state.lastCheck = new Date().toISOString();
      state.lastError = null;
      acctResult.state = state;

      if (options.writeState !== false && !options.dryState) {
        try {
          saveState(settings.username, state, homeOpts);
        } catch (err) {
          logger.error(`[monitor] saveState @${settings.username} 失败: ${err.message}`);
        }
      }
    } catch (err) {
      acctResult.ok = false;
      acctResult.error = { message: err.message, code: err.code || null };
      logger.error(`[monitor] checkCore @${settings.username} 失败: ${err.message}`);
    }

    perAccount.push(acctResult);
  }

  pushStep('check_core_end', { totalFetched, totalFresh });

  const finishedAt = new Date();
  return {
    ok: perAccount.every((a) => a.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totals: {
      accounts: accounts.length,
      fetched: totalFetched,
      fresh: totalFresh,
    },
    accounts: perAccount,
  };
}

/**
 * 完整 runCheck：抓 + 去重 + notify + 落盘。行为与 PR-2 前保持一致。
 *
 * 实现策略：先以 writeState=false 跑 runCheckCore 拿到 freshEntries 和
 * 最终 state；再按 channels dispatch、写回 record.notifiedAt / notifyOk；
 * 最后由本函数统一 saveState，避免两次写文件。
 */
async function runCheck({ config, browser, options = {} }) {
  const startedAt = new Date();
  const logger = makeLogger(options.logger);
  const pushStep = makeStep(options.debugSteps);
  const homeOpts = stateHomeOpts(options);

  const coreResult = await runCheckCore({
    config,
    browser,
    options: Object.assign({}, options, { writeState: false }),
  });

  let totalNotified = 0;
  let totalNotifyFailed = 0;
  const perAccount = [];

  for (const acct of coreResult.accounts) {
    const mergedAcct = {
      username: acct.username,
      ok: acct.ok,
      fetched: acct.fetched,
      fresh: acct.fresh,
      notified: 0,
      notifyFailed: 0,
      error: acct.error,
      channels: [],
      meta: acct.meta,
    };

    if (!acct.ok || !acct.state) {
      perAccount.push(mergedAcct);
      continue;
    }

    const account = (config.accounts || []).find(
      (a) => String(a.username).toLowerCase() === String(acct.username).toLowerCase()
    );
    const settings = effectiveAccountSettings(account || { username: acct.username }, config);
    const { resolved: channels, missing } = resolveChannelsByNames(
      settings.channelNames,
      config.channels
    );
    if (missing.length > 0) {
      logger.warn(`[monitor] @${settings.username}: 未知 channel: ${missing.join(',')}`);
    }

    const notifyResultsForAccount = [];
    for (const { tweet, record } of acct.freshEntries) {
      let results = [];
      if (options.sendNotifications === false) {
        results = channels.map((ch) => ({ name: ch.name, type: ch.type, ok: true, skipped: true }));
      } else {
        results = await dispatch(channels, tweet, {
          summaryLength: settings.summaryLength,
          dryNotify: !!options.dryNotify,
        });
      }
      pushStep('notify', { username: settings.username, tweetId: tweet.tweetId, results });
      const allOk = results.every((r) => r.ok);
      record.notifiedAt = new Date().toISOString();
      record.notifyOk = allOk;
      if (allOk) {
        mergedAcct.notified++;
        totalNotified++;
      } else {
        mergedAcct.notifyFailed++;
        totalNotifyFailed++;
      }
      notifyResultsForAccount.push({ tweetId: tweet.tweetId, results });
    }
    mergedAcct.channels = notifyResultsForAccount;

    if (options.writeState !== false && !options.dryState) {
      try {
        saveState(settings.username, acct.state, homeOpts);
      } catch (err) {
        logger.error(`[monitor] saveState @${settings.username} 失败: ${err.message}`);
      }
    }

    perAccount.push(mergedAcct);
  }

  pushStep('check_end', {
    totalFetched: coreResult.totals.fetched,
    totalFresh: coreResult.totals.fresh,
    totalNotified,
    totalNotifyFailed,
  });

  const finishedAt = new Date();
  return {
    ok: perAccount.every((a) => a.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totals: {
      accounts: coreResult.totals.accounts,
      fetched: coreResult.totals.fetched,
      fresh: coreResult.totals.fresh,
      notified: totalNotified,
      notifyFailed: totalNotifyFailed,
    },
    accounts: perAccount,
  };
}

module.exports = { runCheck, runCheckCore, resolveChannelsByNames };
