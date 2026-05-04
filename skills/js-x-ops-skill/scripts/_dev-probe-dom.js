'use strict';

// _dev-probe-dom.js — X.com DOM 关键选择器探针（开发者用）
//
// 用法：
//   node scripts/_dev-probe-dom.js --page search
//   node scripts/_dev-probe-dom.js --page profile
//   node scripts/_dev-probe-dom.js --page post
//   node scripts/_dev-probe-dom.js --page home
//   node scripts/_dev-probe-dom.js --all
//
// 需已有登录态的浏览器 tab（复用任一 X tab，不强制导航）。

const path = require('path');
const { Session } = require(path.join(__dirname, '..', 'lib', 'session'));

const PROBE_PAGES = {
  search: {
    profile: 'search',
    targets: [
      { name: 'primary column', sel: ['[data-testid="primaryColumn"]', 'main[role="main"]'] },
      { name: 'search box', sel: ['[data-testid="SearchBox_Search_Input"]', 'input[placeholder*="Search"]'] },
      { name: 'tweet articles', sel: ['article[data-testid="tweet"]'] },
    ],
  },
  profile: {
    profile: 'profile',
    targets: [
      { name: 'primary column', sel: ['[data-testid="primaryColumn"]', 'main[role="main"]'] },
      { name: 'user display name', sel: ['[data-testid="UserName"]', '[data-testid="User-Name"]'] },
      { name: 'tweet timeline', sel: ['article[data-testid="tweet"]'] },
    ],
  },
  post: {
    profile: 'post',
    targets: [
      { name: 'primary column', sel: ['[data-testid="primaryColumn"]', 'main[role="main"]'] },
      { name: 'focal tweet', sel: ['article[data-testid="tweet"]'] },
      { name: 'tweet text', sel: ['[data-testid="tweetText"]'] },
    ],
  },
  home: {
    profile: 'home',
    targets: [
      { name: 'primary column', sel: ['[data-testid="primaryColumn"]', 'main[role="main"]'] },
      { name: 'home timeline', sel: ['article[data-testid="tweet"]'] },
      { name: 'side nav profile', sel: ['[data-testid="AppTabBar_Profile_Link"]', 'nav[role="navigation"]'] },
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

function parseArgs(argv) {
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

async function probeOne(pageName) {
  const cfg = PROBE_PAGES[pageName];
  if (!cfg) {
    console.error('[probe-dom] unknown page: ' + pageName + ' (allowed: ' + Object.keys(PROBE_PAGES).join('/') + ')');
    return { page: pageName, ok: false, error: 'unknown_page' };
  }
  const session = new Session({
    opts: {
      page: cfg.profile,
      reuseAnyXTab: true,
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
      console.log('[probe-dom] page=' + pageName + ' ERROR ' + (r && r.error ? r.error : 'unknown'));
      return { page: pageName, ok: false, raw: r };
    }
    const d = r.data;
    console.log('[probe-dom] page=' + pageName + ' url=' + d.url);
    let okCount = 0; let failCount = 0;
    for (const res of d.results) {
      if (res.ok) {
        okCount++;
        const r2 = res.hit.rect || {};
        const fb = res.hit.fallbackIndex > 0 ? (' (fallback#' + res.hit.fallbackIndex + ')') : '';
        console.log('  [OK ] ' + res.name + ': ' + res.hit.selector + fb + '  count=' + res.hit.count + '  rect=' + (r2.w || 0) + 'x' + (r2.h || 0) + '@(' + (r2.x || 0) + ',' + (r2.y || 0) + ')');
      } else {
        failCount++;
        console.log('  [FAIL] ' + res.name + ': tried ' + res.sels.length + ' selectors');
        for (const s of res.sels) console.log('         · ' + s);
      }
    }
    console.log('[probe-dom] page=' + pageName + ' summary: ok=' + okCount + ' fail=' + failCount + ' total=' + d.results.length);
    return { page: pageName, ok: failCount === 0, okCount, failCount, results: d.results };
  } finally {
    await session.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/_dev-probe-dom.js [--page search|profile|post|home] [--all]');
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
      console.error('[probe-dom] page=' + p + ' threw:', e && e.message ? e.message : e);
      all.push({ page: p, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
  const totalFail = all.reduce((acc, r) => acc + ((typeof r.failCount === 'number') ? r.failCount : (r.ok ? 0 : 1)), 0);
  console.log('\n[probe-dom] DONE pages=' + all.length + ' totalFail=' + totalFail);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[probe-dom] fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
