'use strict';

// _dev-probe-dom.js — v3.7.0 dom-first 健康度探针
// ---------------------------------------------------------------------------
// 跑某个 reddit 页面预设的关键 selector 链，看每个目标元素是否还活，输出 OK/FAIL
// 报告。当 reddit shreddit 改前端时第一时间发现 selector 漂移，避免 dom_* 路径
// 因选择器烂而静默 fallback api。
//
// 用法：
//   node skills/js-reddit-ops-skill/scripts/_dev-probe-dom.js --page subreddit
//   node skills/js-reddit-ops-skill/scripts/_dev-probe-dom.js --page search
//   node skills/js-reddit-ops-skill/scripts/_dev-probe-dom.js --all
//
// 不进 skill.contract，仅本仓库开发者用。
// ---------------------------------------------------------------------------

const { Session } = require('../lib/session');

const PROBE_PAGES = {
  home: {
    profile: 'home',
    targets: [
      { name: 'shreddit-feed', sel: ['shreddit-feed', 'shreddit-flat-list', 'shreddit-app shreddit-feed'] },
      { name: 'feed posts', sel: ['shreddit-post', 'article[data-post-id]', '[id^="t3_"]'] },
      { name: 'topbar search', sel: ['#main-search-input input', 'faceplate-search-input input', 'input[name="q"]'] },
      { name: 'logged-in user dropdown', sel: ['#expand-user-drawer-button', 'faceplate-tracker[noun="user_drawer"]', 'shreddit-async-loader[bundlename="header_user_dropdown"]'] },
    ],
  },
  subreddit: {
    profile: 'subreddit',
    targets: [
      { name: 'subreddit header', sel: ['shreddit-subreddit-header', '[id$="-subreddit-header"]'] },
      { name: 'feed posts', sel: ['shreddit-post', 'article[data-post-id]', '[id^="t3_"]'] },
      { name: 'sort tab (hot)', sel: ['a[href*="/hot/"]', 'a[href*="/hot"]', 'nav[aria-label="Sort"] a'] },
      { name: 'sort tab (top)', sel: ['a[href*="/top/"]', 'a[href*="/top"]'] },
      { name: 'right sidebar', sel: ['shreddit-subreddit-about-card', 'shreddit-async-loader[bundlename="community_widget"]', 'aside'] },
    ],
  },
  search: {
    profile: 'search',
    targets: [
      { name: 'search results post', sel: ['shreddit-post', 'article[data-post-id]'] },
      { name: 'search results subreddit', sel: ['shreddit-subreddit', 'shreddit-search-subreddit-card'] },
      { name: 'search results profile', sel: ['shreddit-profile', 'shreddit-search-profile-card'] },
      { name: 'sort tabs', sel: ['nav[aria-label="Search"] a', 'a[role="tab"]'] },
      { name: 'topbar search input', sel: ['#main-search-input input', 'faceplate-search-input input', 'input[name="q"]'] },
    ],
  },
  post: {
    profile: 'post',
    targets: [
      { name: 'post body', sel: ['shreddit-post', 'article[data-post-id]'] },
      { name: 'comment tree', sel: ['shreddit-comment-tree', '[id*="comment-tree"]'] },
      { name: 'top-level comment', sel: ['shreddit-comment[depth="0"]', 'shreddit-comment'] },
    ],
  },
  user: {
    profile: 'user',
    targets: [
      { name: 'user header', sel: ['#user-drawer-content', 'shreddit-profile', '[id$="-user-banner"]'] },
      { name: 'user posts/comments', sel: ['shreddit-post', 'shreddit-comment', 'article[data-post-id]'] },
    ],
  },
  inbox: {
    profile: 'inbox',
    targets: [
      { name: 'inbox messages container', sel: ['#main-content shreddit-tab-list', 'shreddit-tab-content', 'main'] },
      { name: 'inbox message item', sel: ['shreddit-async-loader[bundlename="inbox_message"]', 'a[href^="/message/"]', '[data-testid="inbox-list-item"]'] },
    ],
  },
};

const PROBE_FN_SRC = `function(args){
  args = args || {};
  const targets = args.targets || [];
  const out = { url: location.href, ua: navigator.userAgent.slice(0, 80), results: [] };
  for (const t of targets) {
    const sels = Array.isArray(t.sel) ? t.sel : [t.sel];
    let hit = null;
    for (let i = 0; i < sels.length; i++) {
      let nodes = null;
      try { nodes = document.querySelectorAll(sels[i]); } catch (_) { nodes = null; }
      if (nodes && nodes.length) {
        const first = nodes[0];
        let rect = null;
        try {
          const r = first.getBoundingClientRect();
          rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        } catch (_) {}
        hit = { selector: sels[i], fallbackIndex: i, count: nodes.length, rect };
        break;
      }
    }
    out.results.push({ name: t.name, sels, ok: !!hit, hit });
  }
  return { ok: true, data: out };
}`;

function parseArgs(argv){
  const opts = { page: null, all: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') opts.page = argv[++i];
    else if (a.startsWith('--page=')) opts.page = a.slice('--page='.length);
    else if (a === '--all') opts.all = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

async function probeOne(pageName){
  const cfg = PROBE_PAGES[pageName];
  if (!cfg) {
    console.error('[probe-dom] unknown page: ' + pageName + ' (allowed: ' + Object.keys(PROBE_PAGES).join('/') + ')');
    return { page: pageName, ok: false, error: 'unknown_page' };
  }
  const session = new Session({
    opts: {
      page: cfg.profile,
      reuseAnyRedditTab: true,
      navigateOnReuse: false,
      createIfMissing: false,
      verbose: false,
    },
  });
  try {
    await session.connect();
    await session.resolveTarget();
    const args = JSON.stringify({ targets: cfg.targets });
    const code = `Promise.resolve((${PROBE_FN_SRC})(${args})).then(r => JSON.stringify(r)).catch(e => JSON.stringify({ ok:false, error: String((e && e.message) || e) }))`;
    const r = await session.callRaw(code);
    if (!r || !r.ok) {
      console.log(`[probe-dom] page=${pageName} ERROR ${r && r.error ? r.error : 'unknown'}`);
      return { page: pageName, ok: false, raw: r };
    }
    const d = r.data;
    console.log(`[probe-dom] page=${pageName} url=${d.url}`);
    let okCount = 0, failCount = 0;
    for (const res of d.results) {
      if (res.ok) {
        okCount++;
        const r2 = res.hit.rect || {};
        const fb = res.hit.fallbackIndex > 0 ? ` (fallback#${res.hit.fallbackIndex})` : '';
        console.log(`  [OK ] ${res.name}: ${res.hit.selector}${fb}  count=${res.hit.count}  rect=${r2.w || 0}x${r2.h || 0}@(${r2.x || 0},${r2.y || 0})`);
      } else {
        failCount++;
        console.log(`  [FAIL] ${res.name}: tried ${res.sels.length} selectors`);
        for (const s of res.sels) console.log('         · ' + s);
      }
    }
    console.log(`[probe-dom] page=${pageName} summary: ok=${okCount} fail=${failCount} total=${d.results.length}`);
    return { page: pageName, ok: failCount === 0, okCount, failCount, results: d.results };
  } finally {
    await session.close();
  }
}

async function main(){
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node _dev-probe-dom.js [--page <home|subreddit|search|post|user|inbox>] [--all]');
    process.exit(0);
  }
  let pages;
  if (opts.all) pages = Object.keys(PROBE_PAGES);
  else if (opts.page) pages = [opts.page];
  else {
    console.error('[probe-dom] specify --page <name> or --all (allowed: ' + Object.keys(PROBE_PAGES).join('/') + ')');
    process.exit(2);
  }
  const all = [];
  for (const p of pages) {
    try {
      const r = await probeOne(p);
      all.push(r);
    } catch (e) {
      console.error(`[probe-dom] page=${p} threw:`, e && e.message ? e.message : e);
      all.push({ page: p, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
  const totalFail = all.reduce((acc, r) => acc + (r.failCount || (r.ok ? 0 : 1)), 0);
  console.log(`\n[probe-dom] DONE pages=${all.length} totalFail=${totalFail}`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[probe-dom] fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
