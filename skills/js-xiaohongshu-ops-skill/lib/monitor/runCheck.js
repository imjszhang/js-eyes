'use strict';

/**
 * monitor runCheck（xhs 版） - 单次 check 主循环
 *
 * 拆 runCheckCore（抓+去重+state）/ runCheck（套通知 dispatch），与 X v3.0.6 对位。
 * 同时支持 accounts（用户笔记列表）与 searches（关键词搜索）两类 target。
 */

const { fetchUserNotes } = require('./fetchUserNotes');
const { fetchSearch } = require('./fetchSearch');
const { loadState, saveState } = require('./state');
const { partitionNewNotes, pruneExpired } = require('./dedup');
const { dispatch } = require('./notify');
const { effectiveAccountSettings, effectiveSearchSettings } = require('./config');

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

function targetIdLabel(target) {
  if (target.type === 'account') return `user:${target.username || target.userId}`;
  if (target.type === 'search') return `search:${target.keyword}`;
  return JSON.stringify(target);
}

async function _runOneTarget({ target, settings, browser, options, logger, pushStep, homeOpts, dedupMethod, historyDays }) {
  const result = {
    target,
    label: targetIdLabel(target),
    ok: true, fetched: 0, fresh: 0, freshEntries: [], seen: 0,
    error: null, meta: null, state: null,
  };

  try {
    pushStep('fetch_start', { label: result.label });
    const fetched = target.type === 'account'
      ? await fetchUserNotes(browser, settings, { recording: options.recording, verbose: !!options.verbose })
      : await fetchSearch(browser, settings, { recording: options.recording, verbose: !!options.verbose });
    result.meta = fetched.meta;
    pushStep('fetch_done', { label: result.label, ok: fetched.ok, count: fetched.notes.length, meta: fetched.meta });
    if (!fetched.ok) {
      result.ok = false;
      result.error = fetched.error;
      return result;
    }
    result.fetched = fetched.notes.length;

    const state = loadState(target, homeOpts);
    const nowIso = new Date().toISOString();
    const { fresh, seen } = partitionNewNotes(fetched.notes, state, dedupMethod, nowIso);
    result.fresh = fresh.length;
    result.freshEntries = fresh;
    result.seen = seen.length;
    pushStep('dedup', { label: result.label, method: dedupMethod, knownCount: state.notes.length, freshCount: fresh.length, seenCount: seen.length });

    for (const { record } of fresh) state.notes.unshift(record);
    state.notes = pruneExpired(state.notes, historyDays);
    state.lastCheck = new Date().toISOString();
    state.lastError = null;
    state.target = target;
    result.state = state;

    if (options.writeState !== false && !options.dryState) {
      try { saveState(target, state, homeOpts); }
      catch (err) { logger.error(`[monitor] saveState ${result.label} 失败: ${err.message}`); }
    }
  } catch (err) {
    result.ok = false;
    result.error = { message: err.message, code: err.code || null };
    logger.error(`[monitor] checkCore ${result.label} 失败: ${err.message}`);
  }
  return result;
}

async function runCheckCore({ config, browser, options = {} }) {
  const startedAt = new Date();
  const logger = makeLogger(options.logger);
  const pushStep = makeStep(options.debugSteps);
  const homeOpts = stateHomeOpts(options);
  const dedupMethod = config.deduplication?.method || 'id_and_hash';
  const historyDays = config.deduplication?.historyDays || 30;

  const onlyType = options.singleType || null;
  const singleId = options.singleTargetId || null;

  const accounts = (config.accounts || []).filter((a) => {
    if (a.enabled === false) return false;
    if (onlyType && onlyType !== 'account') return false;
    if (singleId && String(a.username || a.userId).toLowerCase() !== String(singleId).toLowerCase()) return false;
    return true;
  });
  const searches = (config.searches || []).filter((s) => {
    if (s.enabled === false) return false;
    if (onlyType && onlyType !== 'search') return false;
    if (singleId && s.keyword !== singleId) return false;
    return true;
  });

  const perTarget = [];
  let totalFetched = 0;
  let totalFresh = 0;

  for (const account of accounts) {
    const settings = effectiveAccountSettings(account, config);
    const target = { type: 'account', username: settings.username, userId: settings.userId };
    const r = await _runOneTarget({ target, settings, browser, options, logger, pushStep, homeOpts, dedupMethod, historyDays });
    totalFetched += r.fetched; totalFresh += r.fresh;
    perTarget.push(r);
  }
  for (const search of searches) {
    const settings = effectiveSearchSettings(search, config);
    const target = {
      type: 'search', keyword: settings.keyword,
      channelType: settings.channelType, sortBy: settings.sortBy,
      contentType: settings.contentType, timeRange: settings.timeRange, searchScope: settings.searchScope,
    };
    const r = await _runOneTarget({ target, settings, browser, options, logger, pushStep, homeOpts, dedupMethod, historyDays });
    totalFetched += r.fetched; totalFresh += r.fresh;
    perTarget.push(r);
  }

  pushStep('check_core_end', { totalFetched, totalFresh });
  const finishedAt = new Date();
  return {
    ok: perTarget.every((t) => t.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totals: { targets: perTarget.length, fetched: totalFetched, fresh: totalFresh },
    targets: perTarget,
  };
}

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
  const merged = [];

  for (const t of coreResult.targets) {
    const out = {
      target: t.target, label: t.label, ok: t.ok,
      fetched: t.fetched, fresh: t.fresh,
      notified: 0, notifyFailed: 0,
      error: t.error, channels: [], meta: t.meta,
    };
    if (!t.ok || !t.state) { merged.push(out); continue; }

    let settings;
    if (t.target.type === 'account') {
      const account = (config.accounts || []).find(
        (a) => String(a.username || a.userId).toLowerCase() === String(t.target.username || t.target.userId).toLowerCase(),
      ) || { username: t.target.username || t.target.userId };
      settings = effectiveAccountSettings(account, config);
    } else {
      const s = (config.searches || []).find((x) => x.keyword === t.target.keyword) || { keyword: t.target.keyword };
      settings = effectiveSearchSettings(s, config);
    }

    const { resolved: channels, missing } = resolveChannelsByNames(settings.channelNames, config.channels);
    if (missing.length > 0) logger.warn(`[monitor] ${t.label}: 未知 channel: ${missing.join(',')}`);

    const perEntry = [];
    for (const { note, record } of t.freshEntries) {
      let results = [];
      if (options.sendNotifications === false) {
        results = channels.map((ch) => ({ name: ch.name, type: ch.type, ok: true, skipped: true }));
      } else {
        results = await dispatch(channels, note, {
          summaryLength: settings.summaryLength,
          dryNotify: !!options.dryNotify,
        });
      }
      pushStep('notify', { label: t.label, noteId: note.noteId, results });
      const allOk = results.every((r) => r.ok);
      record.notifiedAt = new Date().toISOString();
      record.notifyOk = allOk;
      if (allOk) { out.notified++; totalNotified++; }
      else { out.notifyFailed++; totalNotifyFailed++; }
      perEntry.push({ noteId: note.noteId, results });
    }
    out.channels = perEntry;

    if (options.writeState !== false && !options.dryState) {
      try { saveState(t.target, t.state, homeOpts); }
      catch (err) { logger.error(`[monitor] saveState ${t.label} 失败: ${err.message}`); }
    }
    merged.push(out);
  }

  // v3.1 PR-B2：检测到 hard 档反爬命中 → 自动停 daemon + 紧急通知。
  let hardStop = null;
  for (const t of merged) {
    const ac = t.meta && t.meta.antiCrawlState;
    if (ac && ac.kind === 'hard') {
      hardStop = { label: t.label, reason: ac.lastReason || 'hard_anti_crawl', state: ac };
      break;
    }
  }
  if (hardStop && options.autoStopOnHard !== false) {
    pushStep('hard_anti_crawl_detected', hardStop);
    logger.error(`[monitor] hard anti-crawl detected on ${hardStop.label}: ${hardStop.reason} → stopping daemon`);
    // 强制紧急通知（即使 dryNotify 也发）
    try {
      const emergencyChannels = (config.channels || []).filter((c) => c.type === 'console' || !!c.url);
      if (emergencyChannels.length > 0) {
        await dispatch(emergencyChannels, {
          noteId: 'monitor-hard-stop',
          title: '[xhs monitor] 紧急停机',
          desc: `hard anti-crawl on ${hardStop.label}: ${hardStop.reason}`,
          url: '',
          author: 'monitor',
        }, { summaryLength: 200, dryNotify: false });
      }
    } catch (err) {
      logger.error(`[monitor] emergency notify 失败: ${err.message}`);
    }
    try {
      const { stopDaemon } = require('./daemon');
      stopDaemon();
    } catch (err) {
      logger.error(`[monitor] stopDaemon 失败: ${err.message}`);
    }
  }

  pushStep('check_end', {
    totalFetched: coreResult.totals.fetched,
    totalFresh: coreResult.totals.fresh,
    totalNotified, totalNotifyFailed,
    hardStop: hardStop || null,
  });
  const finishedAt = new Date();
  return {
    ok: merged.every((t) => t.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totals: {
      targets: coreResult.totals.targets,
      fetched: coreResult.totals.fetched,
      fresh: coreResult.totals.fresh,
      notified: totalNotified,
      notifyFailed: totalNotifyFailed,
    },
    hardStop: hardStop || null,
    targets: merged,
  };
}

module.exports = { runCheck, runCheckCore, resolveChannelsByNames };
