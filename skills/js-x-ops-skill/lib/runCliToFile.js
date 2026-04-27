'use strict';

/**
 * runCliToFile - 跑 `node cli/index.js <args...>`，把 stdout 直写到目标文件。
 *
 * 为什么不用 child.stdout.pipe(fs.createWriteStream)？
 *   Node 的 child_process.spawn() 在 stdout = 'pipe' 模式下，宿主侧 readable
 *   stream 的 highWaterMark 默认 64 KiB；当下游 writable 消费速度慢、上游写入
 *   爆发性大于 64KB 时，Node 会先把缓冲塞满再 pause 上游。某些 reddit 大列
 *   表（top --time-range year --limit 50）一次性输出可达 200~400 KB，配合
 *   `pipe()` 的内部排程会偶发性出现尾部丢字（实测固定截断在 65536 字节）。
 *
 * 解法：跳过 pipe，让子进程的 stdout 直接写到一个 fd 上。
 *   stdio: ['ignore', fd, 'pipe']
 *   - stdin  忽略
 *   - stdout 直接写到 fd（不经 Node readable）
 *   - stderr 仍走 pipe，便于父进程捕获错误
 *
 * 适用场景：批量 `node index.js search/list-subreddit/post/...` 的产物归档。
 *
 * 同时注意：本函数只解决 stdout 截断问题；调用 reddit JSON API 时 `--limit`
 * 仍受 reddit 服务器端上限约束（默认 100，本 skill 默认 50）。
 *
 * @example
 *   const { runCliToFile } = require('./runCliToFile');
 *   const r = await runCliToFile({
 *     skillDir: __dirname.replace(/\/lib$/, ''),
 *     args: ['search', 'karpathy autoresearch', '--limit', '50'],
 *     outFile: '/tmp/out.json',
 *   });
 *   console.log(r.code, r.elapsedMs, r.outBytes);
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * @param {Object} args
 * @param {string} args.skillDir   skill 根目录（含 cli/index.js）
 * @param {string[]} args.args     传给 index.js 的参数（不含 'index.js' 本身）
 * @param {string} args.outFile    stdout 目标文件（会被覆盖）
 * @param {string} [args.entry]    入口脚本，默认 'index.js'（亦可指定 'cli/index.js'）
 * @param {NodeJS.ProcessEnv} [args.env]  环境变量（默认继承）
 * @param {number} [args.timeoutMs]   超时（默认 0，不超时）
 * @returns {Promise<{ code:number|null, signal:NodeJS.Signals|null, stderr:string, elapsedMs:number, outBytes:number }>}
 */
function runCliToFile({ skillDir, args, outFile, entry = 'index.js', env, timeoutMs = 0 }) {
  if (!skillDir || typeof skillDir !== 'string') {
    return Promise.reject(new Error('runCliToFile: skillDir 必填'));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new Error('runCliToFile: args 必须是数组'));
  }
  if (!outFile || typeof outFile !== 'string') {
    return Promise.reject(new Error('runCliToFile: outFile 必填'));
  }

  return new Promise((resolve, reject) => {
    let fd;
    try {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fd = fs.openSync(outFile, 'w');
    } catch (err) {
      reject(new Error(`runCliToFile: 打开 ${outFile} 失败: ${err.message}`));
      return;
    }

    const start = Date.now();
    const child = spawn('node', [entry, ...args], {
      cwd: skillDir,
      stdio: ['ignore', fd, 'pipe'],
      env: env || process.env,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch (_) {}
      }, timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      try { fs.closeSync(fd); } catch (_) {}
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      try { fs.closeSync(fd); } catch (_) {}
      let outBytes = 0;
      try { outBytes = fs.statSync(outFile).size; } catch (_) {}
      resolve({
        code,
        signal,
        stderr,
        elapsedMs: Date.now() - start,
        outBytes,
      });
    });
  });
}

module.exports = { runCliToFile };
