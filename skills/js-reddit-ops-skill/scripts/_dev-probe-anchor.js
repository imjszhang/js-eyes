'use strict';

// 一次性 probe，定位"录像里 0 条 flash"的根因。
// 直接在登录态 reddit tab 里跑：
//   1) detectFE 当前 frontend（shreddit / old）
//   2) 各候选 selector 在当前 r/<sub>/hot 列表页的命中数 + 抽样 outerHTML
//   3) 如果 bridge 已注入（有 t3_ 列表 items），逐个跑 resolveAnchor + 拿 element + getBoundingClientRect + isInViewport
//   4) shadow root piercing：document 顶层选不到的 selector 在 shadowRoot 里能不能选到
//   5) __jse_visual.getConfig() / 是否暴露 setSiteAnchorResolver / __jse_visual.flashElement / mode / detailLevel
//   6) 把结果写到 /tmp/jse-probe-anchor-<ts>.md，stdout 也给个 summary 表格
//
// 用完即删 / 不进 skill.contract，仅本仓库开发者用。

const fs = require('fs');
const path = require('path');
const { Session } = require('../lib/session');

function parseArgs(argv){
  const opts = { sub: 'MachineLearning', sort: 'hot', limit: 10, navigateOnly: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sub' && argv[i + 1]) { opts.sub = argv[++i]; continue; }
    if (a.startsWith('--sub=')) { opts.sub = a.slice('--sub='.length); continue; }
    if (a === '--sort' && argv[i + 1]) { opts.sort = argv[++i]; continue; }
    if (a === '--limit' && argv[i + 1]) { opts.limit = parseInt(argv[++i], 10); continue; }
    if (a === '-v' || a === '--verbose') { opts.verbose = true; continue; }
  }
  return opts;
}

async function main(){
  const opts = parseArgs(process.argv.slice(2));
  const sub = opts.sub;
  const sort = opts.sort;
  const targetUrl = 'https://www.reddit.com/r/' + sub + '/' + sort + '/';

  const s = new Session({ opts: { page: 'subreddit', verbose: opts.verbose } });
  await s.connect();
  await s.resolveTarget();

  // step A: 确保当前 tab 在 r/<sub>/<sort>。先看 URL，不对就 location.assign 跳，再 awaitBridgeAfterNav。
  const fromUrl = await s.callRaw('location.href', { timeoutMs: 5000 });
  let navInfo = { fromUrl, navigated: false, ready: true };
  const targetRe = new RegExp('^https?:\\/\\/(?:www\\.)?reddit\\.com\\/r\\/' + sub + '(?:\\/|$)', 'i');
  if (!targetRe.test(String(fromUrl || ''))) {
    // 注：location.assign 触发后这次 callRaw 大概率会 reject（tab 在 navigate），所以吞掉异常
    try {
      await s.callRaw('location.assign(' + JSON.stringify(targetUrl) + '); null;', { timeoutMs: 4000 });
    } catch (_) {}
    const navResult = await s.awaitBridgeAfterNav({ fromUrl, timeoutMs: 20000, intervalMs: 600, initialDelayMs: 800 });
    navInfo = { fromUrl, navigated: true, ready: !!navResult.ready, attempts: navResult.attempts, currentUrl: navResult.currentUrl, error: navResult.error || null };
    // 给 lazy load 多 800ms 落定
    try { await s.callRaw('new Promise((r) => setTimeout(r, 800))', { timeoutMs: 4000 }); } catch (_) {}
  }

  // step B: 跑探针主体（不依赖 bridge，纯 DOM）
  const probe = `(async () => {
    const out = {
      url: location.href,
      ts: new Date().toISOString(),
      detectFE: 'unknown',
      jseVisual: null,
      bridgeLoaded: false,
      selectors: [],
      sampleItemIds: [],
      perItemResolve: [],
      shadowProbe: [],
      iframeCount: 0,
      err: null,
    };

    // 1. detectFE
    try {
      if (typeof window.shreddit !== 'undefined' || document.querySelector('shreddit-app, shreddit-post, shreddit-comment')) {
        out.detectFE = 'shreddit';
      } else if (document.querySelector('#siteTable, body.listing-page, #header-bottom-left')) {
        out.detectFE = 'old';
      } else if (/(^|\\.)old\\.reddit\\.com/i.test(location.hostname)) {
        out.detectFE = 'old';
      } else if (/reddit\\.com$/i.test(location.hostname)) {
        out.detectFE = 'shreddit';
      }
    } catch (e) { out.err = String(e && e.message || e); }

    // 2. visual-bridge-kit 是否注入了 __jse_visual
    try {
      if (window.__jse_visual && typeof window.__jse_visual === 'object') {
        const v = window.__jse_visual;
        out.jseVisual = {
          hasGetConfig: typeof v.getConfig === 'function',
          hasFlashElement: typeof v.flashElement === 'function',
          hasSetSiteAnchorResolver: typeof v.setSiteAnchorResolver === 'function',
          hasResolveAnchor: typeof v.resolveAnchor === 'function',
          hasStaggerFlashItems: typeof v.staggerFlashItems === 'function',
        };
        try { out.jseVisual.config = v.getConfig ? v.getConfig() : null; } catch (e) { out.jseVisual.configErr = String(e); }
      }
    } catch (e) { out.jseVisual = { _err: String(e) }; }
    out.bridgeLoaded = !!(window.__jse_reddit_subreddit__ || window.__jse_reddit_home__ || window.__jse_reddit_listing__);

    // 3. 候选 selector 命中数 + 前 3 个抽样
    function isInViewport(rect){
      if (!rect) return false;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const visW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      return visW > 4 && visH > 4;
    }
    const SELECTORS = [
      'shreddit-app',
      'shreddit-feed',
      'shreddit-post',
      'shreddit-comment',
      'shreddit-subreddit-icon',
      'article[data-test-id]',
      'article[id]',
      'article',
      '[id^="t3_"]',
      '[data-fullname]',
      'a[data-click-id="body"]',
      'a[data-ks-id]',
      'a[href*="/comments/"]',
      'a[href^="/r/' + ${JSON.stringify(sub)} + '/"]',
      'div.thing.link',
      'faceplate-tracker[data-faceplate-tracking-context*="post"]',
    ];
    for (const sel of SELECTORS) {
      try {
        const list = Array.from(document.querySelectorAll(sel));
        const sample = list.slice(0, 3).map((el, i) => {
          let rect = null;
          try { rect = el.getBoundingClientRect(); } catch (_) {}
          return {
            idx: i,
            tag: el.tagName ? el.tagName.toLowerCase() : null,
            id: el.id || null,
            // 截 outerHTML 前 200 字符，去掉换行
            outer: ((el.outerHTML || '') + '').replace(/\\s+/g, ' ').slice(0, 220),
            rect: rect ? { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), inVP: isInViewport(rect) } : null,
          };
        });
        out.selectors.push({ sel, count: list.length, sample });
      } catch (e) {
        out.selectors.push({ sel, error: String(e && e.message || e) });
      }
    }

    // 4. 抽样真实 item id：从 shreddit-post[id^="t3_"] / article[id^="t3_"] / [id^="t3_"] 拿前 N
    const ids = new Set();
    for (const sel of ['shreddit-post[id]', 'article[id^="t3_"]', '[id^="t3_"]', '[data-fullname^="t3_"]']) {
      try {
        Array.from(document.querySelectorAll(sel)).slice(0, 8).forEach((el) => {
          const id = el.id || el.getAttribute('data-fullname') || '';
          if (/^t3_\\w+$/.test(id)) ids.add(id);
        });
      } catch (_) {}
    }
    out.sampleItemIds = Array.from(ids).slice(0, 6);

    // 5. 对每个 sampleItemId 跑当前 _visual-reddit.js 的 3 个候选 selector，看哪一个命中
    function cssEscape(s){
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        try { return CSS.escape(s); } catch (_) {}
      }
      return String(s).replace(/[^\\w-]/g, (ch) => '\\\\' + ch);
    }
    function idFromFullname(fn){
      const m = /^t[1-5]_(\\w+)$/.exec(fn);
      return m ? m[1] : fn;
    }
    for (const fn of out.sampleItemIds) {
      const cands = [
        ['shreddit-post[id="' + cssEscape(fn) + '"]',         '_visual-reddit#1 (shreddit-post[id])'],
        ['article[data-test-id*="' + cssEscape(fn) + '"]',     '_visual-reddit#2 (article[data-test-id])'],
        ['a[data-click-id="body"][href*="/' + idFromFullname(fn) + '/"]', '_visual-reddit#3 (a[data-click-id])'],
        ['#' + cssEscape(fn),                                  'extra (#id)'],
        ['[data-fullname="' + cssEscape(fn) + '"]',            'extra (data-fullname)'],
        ['[id="' + cssEscape(fn) + '"]',                       'extra ([id=])'],
        ['article[id="' + cssEscape(fn) + '"]',                'extra (article[id])'],
      ];
      const trial = { fn, hits: [] };
      for (const [sel, label] of cands) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            let rect = null;
            try { rect = el.getBoundingClientRect(); } catch (_) {}
            trial.hits.push({ label, sel, ok: true, tag: el.tagName.toLowerCase(), rect: rect ? { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), inVP: isInViewport(rect) } : null });
          } else {
            trial.hits.push({ label, sel, ok: false });
          }
        } catch (e) {
          trial.hits.push({ label, sel, ok: false, err: String(e && e.message || e) });
        }
      }
      out.perItemResolve.push(trial);
    }

    // 6. resolveSubreddit 在 r/<sub> 页面的命中
    try {
      const sub = ${JSON.stringify(sub)};
      const lc = sub.toLowerCase();
      const subSels = [
        'shreddit-subreddit-icon[name="' + cssEscape(lc) + '"]',
        'a[href^="/r/' + cssEscape(sub) + '/"]',
        'a[href^="/r/' + cssEscape(lc) + '/"]',
        'a[href="/r/' + cssEscape(sub) + '"]',
      ];
      out.subredditAnchors = subSels.map((sel) => ({ sel, count: document.querySelectorAll(sel).length }));
    } catch (_) {}

    // 7. shadow piercing 探测：常见 reddit shadow root 持有者
    try {
      const hosts = ['shreddit-app', 'shreddit-feed', 'reddit-feed', 'shreddit-async-loader', 'faceplate-app'];
      for (const tag of hosts) {
        const els = Array.from(document.querySelectorAll(tag));
        for (const el of els.slice(0, 2)) {
          const probe = {
            host: tag,
            hasShadow: !!el.shadowRoot,
            innerSlot: null,
            inShadow: 0,
          };
          if (el.shadowRoot) {
            try {
              probe.inShadow = el.shadowRoot.querySelectorAll('shreddit-post, article').length;
            } catch (_) {}
          }
          out.shadowProbe.push(probe);
        }
      }
    } catch (e) { out.shadowProbeErr = String(e); }

    out.iframeCount = document.querySelectorAll('iframe').length;
    return JSON.stringify(out);
  })()`;

  const raw = await s.callRaw(probe, { timeoutMs: 30000 });
  let parsed = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch (_) {} }

  // 写 markdown 报告
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join('/tmp', 'jse-probe-anchor-' + ts + '.md');
  const md = renderMarkdown(parsed, navInfo, { sub, sort });
  fs.writeFileSync(reportPath, md);

  process.stdout.write(md + '\n');
  process.stdout.write('\n[probe] full report written to: ' + reportPath + '\n');

  if (s.bot && typeof s.bot.disconnect === 'function') {
    try { await s.bot.disconnect(); } catch (_) {}
  }
}

function renderMarkdown(p, nav, ctx){
  if (!p || typeof p !== 'object') return '# probe failed\n\n```\n' + JSON.stringify(p) + '\n```\n';
  const lines = [];
  lines.push('# anchor probe — r/' + ctx.sub + '/' + ctx.sort);
  lines.push('');
  lines.push('- ts: ' + p.ts);
  lines.push('- url: ' + p.url);
  lines.push('- detectFE: **' + p.detectFE + '**');
  lines.push('- bridgeLoaded: ' + p.bridgeLoaded);
  lines.push('- iframeCount: ' + p.iframeCount);
  lines.push('- nav: ' + JSON.stringify(nav));
  lines.push('');
  if (p.jseVisual) {
    lines.push('## __jse_visual');
    lines.push('```json');
    lines.push(JSON.stringify(p.jseVisual, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## selector 命中表（顶层 document）');
  lines.push('');
  lines.push('| selector | count | sample[0] tag | sample[0] inVP |');
  lines.push('|---|--:|---|---|');
  for (const r of (p.selectors || [])) {
    const s0 = (r.sample && r.sample[0]) || {};
    lines.push('| `' + r.sel + '` | ' + (r.count != null ? r.count : '?') + ' | ' + (s0.tag || '-') + ' | ' + (s0.rect ? (s0.rect.inVP ? 'yes' : 'no') + ' (' + s0.rect.w + 'x' + s0.rect.h + ')' : '-') + ' |');
  }
  lines.push('');

  lines.push('## sampleItemIds（用于 _visual-reddit#resolvePost 单点测试）');
  lines.push('- ' + (p.sampleItemIds || []).join(', '));
  lines.push('');

  if (Array.isArray(p.perItemResolve) && p.perItemResolve.length) {
    lines.push('## 每个 t3_xxx 在三档 _visual-reddit#resolvePost 候选下的命中');
    lines.push('');
    lines.push('| fn | shreddit-post[id] | article[data-test-id] | a[data-click-id] | #id | data-fullname | [id=] | article[id=] |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const t of p.perItemResolve) {
      const cells = (t.hits || []).map((h) => h.ok ? (h.rect && h.rect.inVP ? 'OK✓' : (h.rect ? 'hit (offVP)' : 'hit')) : 'miss');
      lines.push('| `' + t.fn + '` | ' + cells.join(' | ') + ' |');
    }
    lines.push('');
  }

  if (Array.isArray(p.subredditAnchors)) {
    lines.push('## resolveSubreddit 候选');
    lines.push('');
    for (const r of p.subredditAnchors) {
      lines.push('- `' + r.sel + '` → ' + r.count);
    }
    lines.push('');
  }

  if (Array.isArray(p.shadowProbe) && p.shadowProbe.length) {
    lines.push('## shadow root 探测');
    lines.push('');
    for (const r of p.shadowProbe) {
      lines.push('- host=`' + r.host + '` hasShadow=' + r.hasShadow + ' innerPosts=' + r.inShadow);
    }
    lines.push('');
  }

  // 顶层 selector 抽样 outerHTML
  lines.push('## sample outerHTML');
  for (const r of (p.selectors || [])) {
    if (!r.count) continue;
    if (!Array.isArray(r.sample) || !r.sample.length) continue;
    lines.push('### `' + r.sel + '` (count=' + r.count + ')');
    for (const s of r.sample) {
      lines.push('```');
      lines.push(s.outer);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## 根因判读建议');
  lines.push('');
  lines.push('- 如果 `shreddit-post` count=0、但 `article[id^="t3_"]` 或 `[data-fullname^="t3_"]` 有命中 → 走 PR3 修复策略 A（更新 selector 链）');
  lines.push('- 如果 `shreddit-post` count>0 且每个 t3_ 都 OK✓ 但录像 0 flash → 检查 jseVisual.config.flash（v0.6.0 由 mode 拆出）/ staggerFlashItems 调用链路');
  lines.push('- 如果所有 selector 都 miss、但 shadowProbe.innerPosts > 0 → 走策略 E（shadow piercing）');
  lines.push('- 如果有命中但 inVP=no（offVP）很多 → 走策略 B（scrollIntoView retry）');
  return lines.join('\n');
}

main().catch((e) => { console.error('[probe] failed:', e && e.stack || e); process.exit(1); });
