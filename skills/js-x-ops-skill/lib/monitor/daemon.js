'use strict';

/**
 * monitor daemon - 本地调度循环
 *
 * 职责：
 *   1. 启动前从 config.scheduling.intervalSec（或 --interval 覆盖）取循环间隔
 *   2. 写 pid 文件；如已有 pid 且进程存活则拒绝启动（重入保护）
 *   3. 循环：await runCheck → sleep 到下个整点 → 重复
 *   4. 捕获 SIGINT/SIGTERM，当前 check 做完再退出；退出时删 pid 文件
 *   5. 未捕获异常：打印到 stderr + 落日志，不崩溃进程（除非连续失败达到阈值）
 *
 * 不做的事：
 *   - 不并行跑多账号（fetch X 有限流，串行更稳）
 *   - 不做守护 fork/nohup（用户自己决定 nohup/systemd/launchd）
 *   - 不做状态监听 API（status 命令读 pid 文件就够了）
 */

const fs = require('fs');
const { BrowserAutomation } = require('../js-eyes-client');
const { resolveRuntimeConfig } = require('../runtimeConfig');
const { loadConfig, ensureBaseDirs } = require('./config');
const { resolvePaths } = require('./paths');
const { runCheck } = require('./runCheck');
const { appendLog } = require('./logs');

const MIN_INTERVAL_SEC = 30;           // 避免失手把 X 打挂
const MAX_CONSECUTIVE_FAILURES = 5;    // 连续失败阈值，超过则退出

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
  try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
}

/**
 * @param {Object} options
 * @param {number} [options.intervalSec]   循环间隔（秒），覆盖 config.scheduling.intervalSec
 * @param {boolean} [options.dryNotify]
 * @param {string}  [options.wsEndpoint]
 * @param {string}  [options.recordingMode]
 * @param {boolean} [options.once]         只跑一次就退出（用于联调）
 */
async function startDaemon(options = {}) {
  const existingPid = readExistingPid();
  if (existingPid) {
    const err = new Error(`monitor daemon 已在运行 (pid=${existingPid})；如果是残留 pid 可手动删除 ${resolvePaths().pidFile}`);
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
          config: loadConfig(),                  // 每次循环重新 load，热生效配置变更
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
          accounts: result.accounts.map((a) => ({ username: a.username, ok: a.ok, fresh: a.fresh, notified: a.notified, notifyFailed: a.notifyFailed })),
        });
        if (result.ok) consecutiveFailures = 0;
        else consecutiveFailures++;
      } catch (err) {
        consecutiveFailures++;
        process.stderr.write(`[monitor:daemon] check 抛错: ${err.message}\n`);
        appendLog({ event: 'check_error', error: err.message });
      } finally {
        try { browser.disconnect(); } catch { /* ignore */ }
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        process.stderr.write(`[monitor:daemon] 连续失败 ${consecutiveFailures} 次 >= ${MAX_CONSECUTIVE_FAILURES}，退出\n`);
        appendLog({ event: 'daemon_bail_out', consecutiveFailures });
        break;
      }

      if (options.once || stopping) break;

      // 睡到下一次
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

/**
 * 发 SIGTERM 给已有 daemon；不存在就返回 ok=false。
 */
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
  startDaemon,
  stopDaemon,
  readExistingPid,
  writePidFile,
  removePidFile,
  MIN_INTERVAL_SEC,
  MAX_CONSECUTIVE_FAILURES,
};
