// bridges/_visual-reddit.js
// ---------------------------------------------------------------------------
// reddit 专属的 anchor 解析器，覆盖 @js-eyes/visual-bridge-kit 默认实现。
// 由 // @@include 在 bridges/common.js 顶部装载，作为 IIFE 立即执行。
//
// 输入 spec 可能是：
//   - reddit fullname 字符串：t3_xxx / t1_xxx / t2_xxx / t4_xxx / t5_xxx
//     （也容错前缀 'r/<sub>' / 'u/<user>' / '/r/<sub>' / '/user/<user>'）
//   - 形如 { selector: '#xxx' } 的显式选择器
//   - reddit URL 字符串（提取 t3_/t1_ 后再查）
//   - 任意 CSS 选择器（兜底）
//
// 解析失败必须返回 null，让调度层自动降级 HUD-only。
// ---------------------------------------------------------------------------

;(function installRedditVisualAnchor(){
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || !window.__jse_visual.setSiteAnchorResolver) return;

  function safeQS(sel){
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (_) { return null; }
  }

  function safeQSAll(sel){
    if (!sel) return [];
    try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return []; }
  }

  function detectFE(){
    // common.js 已 @@include 在前面，detectFrontend 会被 IIFE 一并捕获。
    // 这里二次实现一遍是为了避免对 common.js 函数名产生硬耦合。
    try {
      if (typeof window.shreddit !== 'undefined'
          || document.querySelector('shreddit-app, shreddit-post, shreddit-comment')) {
        return 'shreddit';
      }
      if (document.querySelector('#siteTable, body.listing-page, #header-bottom-left')) {
        return 'old';
      }
      if (/(^|\.)old\.reddit\.com/i.test(location.hostname)) return 'old';
      if (/reddit\.com$/i.test(location.hostname)) return 'shreddit';
    } catch (_) {}
    return 'unknown';
  }

  function resolvePost(fn, fe){
    if (fe === 'old') {
      const a = safeQS('#thing_' + cssEscape(fn));
      if (a) return a;
    }
    // shreddit 当前列表页（2026-05 经探针验证）实际 DOM 结构：
    //   <article data-post-id="t3_xxx"><shreddit-post id="t3_xxx" data-ks-item>
    //     <a data-ks-id="t3_xxx" slot="full-post-link" href="/r/.../comments/<id>/...">
    //
    // 旧 fallback 用的 `article[data-test-id*="..."]` 与 `a[data-click-id="body"]`
    // 在新版上全部 0 命中。下面把 selector 链按"最稳 → 最容错"重排：
    //   1. shreddit-post[id="t3_..."]                自定义元素本体（推荐入口）
    //   2. article[data-post-id="t3_..."]             外层 wrap，比 shreddit-post 略稳（class 不变）
    //   3. a[data-ks-id="t3_..."]                      帖子 anchor，新版 reddit 给的"锚点 link"
    //   4. [data-fullname="t3_..."]                    旧 reddit 兜底
    //   5. article[data-test-id*="..."]                legacy（旧 reddit/shreddit 早期）
    //   6. a[data-click-id="body"][href*="/<id>/"]     legacy（旧 reddit/shreddit 早期）
    return safeQS('shreddit-post[id="' + cssEscape(fn) + '"]')
        || safeQS('article[data-post-id="' + cssEscape(fn) + '"]')
        || safeQS('a[data-ks-id="' + cssEscape(fn) + '"]')
        || safeQS('[data-fullname="' + cssEscape(fn) + '"]')
        || safeQS('article[data-test-id*="' + cssEscape(fn) + '"]')
        || safeQS('a[data-click-id="body"][href*="/' + escapeReg(idFromFullname(fn)) + '/"]');
  }

  function resolveComment(fn, fe){
    if (fe === 'old') {
      const a = safeQS('.comment[data-fullname="' + cssEscape(fn) + '"]')
            || safeQS('#thing_' + cssEscape(fn));
      if (a) return a;
    }
    return safeQS('shreddit-comment[thingid="' + cssEscape(fn) + '"]')
        || safeQS('shreddit-comment[id="' + cssEscape(fn) + '"]')
        || safeQS('[data-fullname="' + cssEscape(fn) + '"]')
        || safeQS('[id="' + cssEscape(fn) + '"]');
  }

  function resolveSubreddit(name){
    if (!name) return null;
    const lc = name.toLowerCase();
    // 探针实测：r/<sub> 列表页里 `a[href^="/r/<sub>/"]` 命中 124（每张卡里都有），
    // 反而是 `a[href="/r/<sub>"]` 精确 1 命中（侧边栏 community link），更适合
    // 作为"指向 sub 这个实体"的 anchor。所以把精确匹配前置，shreddit-subreddit-icon
    // 再退一档（探针显示该 selector 在新版列表页 0 命中，仅 community 主页有）。
    return safeQS('a[href="/r/' + cssEscape(name) + '"], a[href="/r/' + cssEscape(lc) + '"]')
        || safeQS('a[href="/r/' + cssEscape(name) + '/"], a[href="/r/' + cssEscape(lc) + '/"]')
        || safeQS('shreddit-subreddit-icon[name="' + cssEscape(lc) + '"]')
        || safeQS('shreddit-subreddit-icon[name="' + cssEscape(name) + '"]')
        || safeQS('a[href^="/r/' + cssEscape(name) + '/"], a[href^="/r/' + cssEscape(lc) + '/"]');
  }

  function resolveUser(name){
    if (!name) return null;
    return safeQS('a[href^="/user/' + cssEscape(name) + '/"], a[href^="/u/' + cssEscape(name) + '/"]')
        || safeQS('a[href="/user/' + cssEscape(name) + '"], a[href="/u/' + cssEscape(name) + '"]');
  }

  function resolveMessage(fn){
    return safeQS('[data-fullname="' + cssEscape(fn) + '"]')
        || safeQS('[id="' + cssEscape(fn) + '"]');
  }

  function idFromFullname(fn){
    if (!fn || typeof fn !== 'string') return '';
    const m = /^t[1-5]_(\w+)$/.exec(fn);
    return m ? m[1] : fn;
  }

  function cssEscape(s){
    if (typeof s !== 'string') return '';
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
      try { return CSS.escape(s); } catch (_) {}
    }
    return s.replace(/[^\w-]/g, (ch) => '\\' + ch);
  }

  function escapeReg(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function fromUrl(spec){
    if (typeof spec !== 'string') return null;
    let u;
    try { u = new URL(spec, location.href); } catch (_) { return null; }
    if (!/reddit\.com$/i.test(u.hostname)) return null;
    const m = /^\/(?:r\/[\w-]+\/)?comments\/(\w+)/.exec(u.pathname);
    if (m && m[1]) return resolvePost('t3_' + m[1], detectFE());
    const sub = /^\/r\/([\w-]+)/.exec(u.pathname);
    if (sub && sub[1]) return resolveSubreddit(sub[1]);
    const usr = /^\/(?:user|u)\/([\w-]+)/.exec(u.pathname);
    if (usr && usr[1]) return resolveUser(usr[1]);
    return null;
  }

  function resolveFullname(fn, fe){
    if (typeof fn !== 'string') return null;
    if (/^t3_/.test(fn)) return resolvePost(fn, fe);
    if (/^t1_/.test(fn)) return resolveComment(fn, fe);
    if (/^t5_/.test(fn)) return resolveSubreddit(idFromFullname(fn));
    if (/^t2_/.test(fn)) return resolveUser(idFromFullname(fn));
    if (/^t4_/.test(fn)) return resolveMessage(fn);
    return null;
  }

  function resolvePrefixed(value){
    if (typeof value !== 'string') return null;
    let m;
    m = /^\/?r\/([\w-]+)\/?$/i.exec(value);
    if (m) return resolveSubreddit(m[1]);
    m = /^\/?(?:user|u)\/([\w-]+)\/?$/i.exec(value);
    if (m) return resolveUser(m[1]);
    return null;
  }

  function resolveAnchor(spec){
    if (!spec) return null;
    const fe = detectFE();

    if (typeof spec === 'string') {
      // reddit fullname
      const fn = resolveFullname(spec, fe);
      if (fn) return fn;
      // r/sub or u/user
      const px = resolvePrefixed(spec);
      if (px) return px;
      // URL
      const url = fromUrl(spec);
      if (url) return url;
      // 兜底 CSS selector
      return safeQS(spec);
    }

    if (typeof spec === 'object') {
      if (spec.fullname) return resolveFullname(spec.fullname, fe) || null;
      if (spec.subreddit) return resolveSubreddit(spec.subreddit);
      if (spec.user) return resolveUser(spec.user);
      if (spec.url) return fromUrl(spec.url);
      if (spec.selector) return safeQS(spec.selector);
    }
    return null;
  }

  function staggerFlashItems(opts){
    const o = opts || {};
    const items = Array.isArray(o.items) ? o.items.slice(0, 12) : [];
    const cfg = window.__jse_visual.getConfig();
    const stride = typeof o.stride === 'number' ? Math.max(0, o.stride) : cfg.listStrideMs;
    const tone = o.tone || 'info';
    const label = o.label || '';
    const v = window.__jse_visual;

    // post-2.7.0 解耦原则：
    //   - "在线视觉 flash"（flashElement 在页面上画 outline）依赖 DOM/viewport，
    //     reddit-ops 大部分 READ 命令用 fetch 不导航页面，搜出来的 t3_xxx 在当前
    //     页 DOM 里 0 命中是常态；探针实测：登录态 r/<sub>/hot 即使 selector 命
    //     中也会 5/6 在首屏外被 isInViewport reject。
    //   - "离线 composition flash"（hyperframes 用 data-anchor-id 加 .flash-active）
    //     只需要 anchor 的语义 id，不依赖 DOM 是否能选中。
    //
    // 修复策略 C（语义 flash 降级 + emit 同步化）：
    //   v3.6.3 第二轮修：firefox 后台 tab setTimeout 被节流到 1Hz，原 stagger 用
    //   90ms*N 间隔 setTimeout 安排 emit 几乎全漂到下次 drain 之后。这里把"语义
    //   flash 事件 emit"提前到同步 for-loop（事件立刻进 ring buffer，drain 时
    //   一次性取走，零 timing drift），仅"视觉 outline + scrollIntoView"留在
    //   setTimeout 里散布——离线 events.jsonl 总数 100% 准确，在线视觉照常。
    //
    //   双 emit 现象：当 DOM 能命中 + inVP，flashElement 内部还会 emit 一次同 anchor
    //   的 flash（与同步 emit 重复）。timeline.js 把它们处理成"两次 .flash-active
    //   动画"，视觉上是"语义入场 + 单帧聚焦"的加强效果，不算 bug。
    let scheduled = 0;

    // 阶段 1：同步立刻 emit 全部语义 flash 到 ring buffer。
    items.forEach((item) => {
      try {
        if (v && typeof v.emit === 'function') {
          const anchorObj = (item && typeof item === 'object')
            ? Object.assign({}, item)
            : { spec: String(item || '') };
          v.emit({ type: 'flash', tone, label, anchor: anchorObj });
          scheduled++;
        }
      } catch (_) {}
    });

    // 阶段 2：setTimeout 内做 scrollIntoView + 在线 outline。后台 tab 被节流也不
    // 影响离线事件流（已在阶段 1 全部入 buffer）。
    items.forEach((item, idx) => {
      window.setTimeout(() => {
        const el = resolveAnchor(item);
        if (!el) return;
        try {
          const rect0 = el.getBoundingClientRect && el.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          const inVP = rect0
            && rect0.width > 4
            && rect0.height > 4
            && rect0.top < vh - 80
            && rect0.bottom > 80;
          if (!inVP && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); }
            catch (_) { try { el.scrollIntoView(true); } catch (__) {} }
          }
        } catch (_) {}
        window.__jse_visual.flashElement(el, {
          tone,
          label,
          anchor: item,
        });
      }, idx * stride);
    });

    if (items.length > 0) {
      const dur = typeof cfg.durationMs === 'number' ? cfg.durationMs : 420;
      const lastSlot = (items.length - 1) * stride;
      if (typeof v.bumpCaptureSettleRelative === 'function') {
        v.bumpCaptureSettleRelative(lastSlot + Math.floor(dur * 0.55) + 80);
      }
    }

    return scheduled;
  }

  window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
  window.__jse_visual.setSiteStaggerFlashItems(staggerFlashItems);
})();
