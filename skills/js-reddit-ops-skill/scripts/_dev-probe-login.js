'use strict';

// 一次性 probe，定位 reddit-ops 报 loggedIn:false 但浏览器 tab 里其实已登录的根因。
// 直接通过 Session.callRaw 在当前命中 tab 里跑三件事：
//   1) cookie 是否含 reddit_session / token_v2 / loid
//   2) /api/v1/me.json 真实响应（status / 长度 / data.name）
//   3) shreddit 当前的登录指示元素结构（覆盖现有 SKILL.md 写死的选择器之外）
// 用完即删 / 不进 skill.contract，仅本仓库开发者用。

const { Session } = require('../lib/session');

async function main(){
  const s = new Session({ opts: { page: 'home', verbose: true } });
  await s.connect();
  await s.resolveTarget();

  const probe = `(async () => {
    const out = {
      url: location.href,
      ua: navigator.userAgent.slice(0, 80),
      cookieLen: 0,
      cookieFlags: { reddit_session: false, token_v2: false, edgebucket: false, loid: false, csrf_token: false },
      me: null,
      meErr: null,
      genericLoginEls: [],
      usernameEls: [],
    };
    try {
      const c = String(document.cookie || '');
      out.cookieLen = c.length;
      out.cookieFlags.reddit_session = /(^|; *)reddit_session=/.test(c);
      out.cookieFlags.token_v2 = /(^|; *)token_v2=/.test(c);
      out.cookieFlags.edgebucket = /(^|; *)edgebucket=/.test(c);
      out.cookieFlags.loid = /(^|; *)loid=/.test(c);
      out.cookieFlags.csrf_token = /(^|; *)csrf_token=/.test(c);
    } catch (e) { out.cookieErr = String(e && e.message || e); }

    // 1. 直接绝对 URL fetch
    try {
      const r = await fetch('https://www.reddit.com/api/v1/me.json?raw_json=1', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      const text = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) {}
      out.me = {
        status: r.status,
        ok: r.ok,
        type: r.headers.get('content-type'),
        textLen: text.length,
        textHead: text.slice(0, 360),
        keys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 20) : null,
        name: parsed && (parsed.name || (parsed.data && parsed.data.name)) || null,
      };
    } catch (e) {
      out.meErr = String(e && e.message || e);
    }

    // 2. 走 bridge 的 readMeViaApi（同 fetchRedditJson 路径），看它到底拿到啥
    try {
      const homeMod = window.__jse_reddit_home__;
      if (homeMod) {
        const sess = homeMod.sessionState ? await homeMod.sessionState() : null;
        out.bridgeSession = sess;
      } else {
        out.bridgeSession = { _err: 'bridge_not_loaded' };
      }
    } catch (e) { out.bridgeSessionErr = String(e && e.message || e); }

    // 3. 同 origin（reddit 内部用） raw fetch
    try {
      const r2 = await fetch('/api/v1/me.json?raw_json=1', { credentials: 'include' });
      out.meRelative = { status: r2.status, ok: r2.ok };
    } catch (e) {
      out.meRelativeErr = String(e && e.message || e);
    }

    try {
      const sels = [
        'faceplate-dropdown-menu[noun="user-drawer"]',
        'faceplate-dropdown-menu[noun="user_drawer"]',
        'faceplate-tracker[noun="user_drawer"]',
        'faceplate-tracker[noun="user-drawer"]',
        '#header .user a[href^="/user/"]',
        'button[id^="expand-user-drawer-button"]',
        'a[href^="/user/me"]',
        'shreddit-async-loader[bundlename*="user"]',
        '[data-faceplate-tracking-context*="logged_in"]',
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) { out.genericLoginEls.push({ sel, found: false }); continue; }
        out.genericLoginEls.push({
          sel, found: true, tag: el.tagName.toLowerCase(),
          attrs: Array.from(el.attributes || []).slice(0, 12).map((a) => a.name + '=' + (a.value || '').slice(0, 80)),
        });
      }
      const named = Array.from(document.querySelectorAll('[username]'))
        .slice(0, 5)
        .map((el) => ({ tag: el.tagName.toLowerCase(), username: el.getAttribute('username') }));
      out.usernameEls = named;
    } catch (e) {
      out.domErr = String(e && e.message || e);
    }

    return JSON.stringify(out);
  })()`;

  const raw = await s.callRaw(probe, { timeoutMs: 30000 });
  let parsed = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch (_) {} }
  process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');

  if (s.bot && typeof s.bot.disconnect === 'function') {
    try { await s.bot.disconnect(); } catch (_) {}
  }
}

main().catch((e) => { console.error('probe failed:', e && e.stack || e); process.exit(1); });
