#!/usr/bin/env node
'use strict';

/**
 * scripts/_dev/visual-demo.js
 *
 * 顺序跑一组 reddit 工具调用，方便录屏 / 肉眼验证页面内视觉反馈层。
 *
 * 跑之前请先：
 *   1) 启动 js-eyes server（`js-eyes server start --foreground`）
 *   2) 在受控浏览器中打开 https://www.reddit.com/r/AskReddit
 *   3) 安装 reddit-ops 依赖：`cd skills/js-reddit-ops-skill && npm install`
 *
 * 用法：
 *   node scripts/_dev/visual-demo.js                        # 默认 r/AskReddit + nodejs
 *   node scripts/_dev/visual-demo.js --sub science --query react
 *   node scripts/_dev/visual-demo.js --no-visual-flash      # 仅 HUD（v0.6.0 取代 --visual-mode hud）
 *   node scripts/_dev/visual-demo.js --visual-trace runs/visual-demo.jsonl
 *
 * 注意：
 *   - 脚本会按 doctor → list-subreddit → search → my-feed 的顺序跑。
 *   - 每步之间 sleep 2.5s，便于人眼观察页面 flash + HUD。
 *   - 不会做任何 vote / submit / comment 等写操作。
 */

const { spawn } = require('child_process');
const path = require('path');

function parseDemoArgs(argv){
  const opts = {
    sub: 'AskReddit',
    query: 'nodejs',
    pageSort: 'hot',
    limit: 8,
    pause: 2500,
    pass: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sub') opts.sub = argv[++i];
    else if (a === '--query') opts.query = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--pause') opts.pause = Number(argv[++i]);
    else if (a === '--page-sort') opts.pageSort = argv[++i];
    else opts.pass.push(a);
  }
  return opts;
}

function sleep(ms){ return new Promise((r) => setTimeout(r, ms)); }

function runOnce(args){
  return new Promise((resolve, reject) => {
    const cli = path.join(__dirname, '..', '..', 'index.js');
    const child = spawn('node', [cli, ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`exit ${code}: ${args.join(' ')}`));
    });
  });
}

async function main(){
  const opts = parseDemoArgs(process.argv.slice(2));
  const pass = opts.pass;
  const steps = [
    {
      label: '步骤 1/4: doctor — 通路 + 登录态 + bridge 注入演出',
      args: ['doctor', ...pass],
    },
    {
      label: `步骤 2/4: list-subreddit r/${opts.sub} ${opts.pageSort} --limit ${opts.limit} — 列表呼吸感`,
      args: ['list-subreddit', opts.sub, '--sort', opts.pageSort, '--limit', String(opts.limit), '--pretty', ...pass],
    },
    {
      label: `步骤 3/4: search "${opts.query}" — 搜索 + 列表 stagger flash`,
      args: ['search', opts.query, '--sort', 'top', '--time-range', 'week', '--limit', String(opts.limit), '--pretty', ...pass],
    },
    {
      label: '步骤 4/4: my-feed --feed popular — 主 feed 演出',
      args: ['my-feed', '--feed', 'popular', '--sort', 'hot', '--limit', String(opts.limit), '--pretty', ...pass],
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    process.stderr.write(`\n========================================\n${steps[i].label}\n========================================\n`);
    try {
      await runOnce(steps[i].args);
    } catch (e) {
      process.stderr.write(`\n[visual-demo] step failed: ${e.message}\n`);
    }
    if (i < steps.length - 1 && opts.pause > 0) {
      process.stderr.write(`\n[visual-demo] sleeping ${opts.pause}ms 让屏幕上的 HUD 自然消失…\n`);
      await sleep(opts.pause);
    }
  }
  process.stderr.write('\n[visual-demo] 完成。在浏览器里能看到每步的 HUD + flash 效果。\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[visual-demo] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
