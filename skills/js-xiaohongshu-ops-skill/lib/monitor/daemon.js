'use strict';

/**
 * monitor daemon（xhs 版） - 本地调度循环
 *
 * 与 X 同形态：写 pid 文件 + 重入保护，循环 await runCheck，捕获 SIGINT/SIGTERM 优雅退出。
 */

const fs = require('fs');
const { BrowserAutomation } = require('../js-eyes-client');
const { resolveRuntimeConfig } = require('../runtimeConfig');
const { loadConfig, ensureBaseDirs } = require('./config');
const { resolvePaths } = require('./paths');
const { runCheck } = require('./runCheck');
const { appendLog } = require('./logs');

const MIN_INTERVAL_SEC = 60;
const MAX_CONSECUTIVE_FAILURES = 5;

function readExistingPid() {
  const { pidFile } = resolvePaths();
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    if (!pid || pid <= 0) return null;
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch { return null; }
}

function writePidFile(pid) {
  ensureBaseDirs();
  const { pidFile } = resolvePaths();
  fs.writeFileSync(pidFile, String(pid));
  return pidFile;
}

function removePidFile() {
  const { pidFile } = resolvePaths();
  try { fs.unlinkSync(pidFile); } catch {}
}

async function startDaemon(options = {}) {
  const existingPid = readExistingPid();
  if (existingPid) {
    const err = new Error(`monitor daemon 已在运行 (pid=${existingPid}); 残留 pid 可手动删除 ${resolvePaths().pidFile}`);
    err.code = 'E_DAEMON_ALREADY_RUNNING';
    err.pid = existingPid;
    throw err;
  }

  const config = loadConfig();
  const baseIntervalSec = Number(options.intervalSec || config.scheduling?.intervalSec || 3600);
  const intervalSec = Math.max(MIN_INTERVAL_SEC, baseIntervalSec);
  if (intervalSec !== baseIntervalSec) {
    process.stderr.write(`[monitor:daemon] interval 被拉到最小值 ${MIN_INTERVAL_SEC}s（原值 ${baseIntervalSec}s）\n`);
  }
  const pid = process.pid;
  const pidFile = writePidFile(pid);

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: options.wsEndpoint || process.env.JS_EYES_WS_URL,
    recording: options.recordingMode ? { mode: options.recordingMode } : {},
  });

  appendLog({ event: 'daemon_started', pid, intervalSec, pidFile });
  process.stderr.write(`[monitor:daemon] started pid=${pid} interval=${intervalSec}s pidFile=${pidFile}\n`);

  let stopping = false;
  let consecutiveFailures = 0;
  let sleepTimer = null;
  let wakeResolve = null;

  const wake = (reason) => {
    if (wakeResolve) {
      const r = wakeResolve;
      wakeResolve = null;
      if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
      r({ reason });
    }
  };

  const requestStop = (signal) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`[monitor:daemon] received ${signal}，当前 check 完成后退出\n`);
    appendLog({ event: 'daemon_stop_requested', signal });
    wake('signal');
  };

  process.on('SIGINT', () => requestStop('SIGINT'));
  process.on('SIGTERM', () => requestStop('SIGTERM'));

  try {
    while (!stopping) {
      const browser = new BrowserAutomation(runtimeConfig.serverUrl, {
        logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
      });
      let result = null;
      try {
        result = await runCheck({
          config: loadConfig(),
          browser,
          options: {
            dryNotify: !!options.dryNotify,
            recording: runtimeConfig.recording,
            logger: {
              info: () => {},
              warn: (...a) => console.error('[monitor]', ...a),
              error: (...a) => console.error('[monitor]', ...a),
            },
          },
        });
        appendLog({
          event: 'check_finished',
          durationMs: result.durationMs,
          totals: result.totals,
          ok: result.ok,
          targets: result.targets.map((t) => ({ label: t.label, ok: t.ok, fresh: t.fresh, notified: t.notified, notifyFailed: t.notifyFailed })),
        });
        if (result.ok) consecutiveFailures = 0;
        else consecutiveFailures++;
      } catch (err) {
        consecutiveFailures++;
        process.stderr.write(`[monitor:daemon] check 抛错: ${err.message}\n`);
        appendLog({ event: 'check_error', error: err.message });
      } finally {
        try { browser.disconnect(); } catch {}
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        process.stderr.write(`[monitor:daemon] 连续失败 ${consecutiveFailures} 次 >= ${MAX_CONSECUTIVE_FAILURES}，退出\n`);
        appendLog({ event: 'daemon_bail_out', consecutiveFailures });
        break;
      }
      if (options.once || stopping) break;
      await new Promise((resolve) => {
        wakeResolve = resolve;
        sleepTimer = setTimeout(() => {
          const r = wakeResolve;
          wakeResolve = null;
          if (r) r({ reason: 'timeout' });
        }, intervalSec * 1000);
      });
    }
  } finally {
    removePidFile();
    appendLog({ event: 'daemon_stopped', pid });
    process.stderr.write(`[monitor:daemon] stopped pid=${pid}\n`);
  }
}

function stopDaemon() {
  const pid = readExistingPid();
  if (!pid) {
    const { pidFile } = resolvePaths();
    return { ok: false, error: 'no_running_daemon', pidFile };
  }
  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true, pid };
  } catch (err) {
    return { ok: false, error: err.message, pid };
  }
}

module.exports = {
  startDaemon, stopDaemon,
  readExistingPid, writePidFile, removePidFile,
  MIN_INTERVAL_SEC, MAX_CONSECUTIVE_FAILURES,
};
