#!/usr/bin/env node
'use strict';

/**
 * scripts/monitor/check.js
 *
 * cron 入口（薄壳）：等价于 `node index.js monitor check`，方便外部调度器直接 exec 这个文件。
 *
 * 用法：
 *   node scripts/monitor/check.js [username] [--dry-notify] [--server ws://...]
 *
 * 退出码与 `monitor check` 保持一致（0 成功，非 0 出错）。
 */

const { runMonitor } = require('../../lib/monitor/dispatcher');

(async () => {
  const args = ['check', ...process.argv.slice(2)];
  const code = await runMonitor(args);
  process.exit(code || 0);
})().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
