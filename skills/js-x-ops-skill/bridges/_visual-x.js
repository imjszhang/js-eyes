// bridges/_visual-x.js
// ---------------------------------------------------------------------------
// X.com 站点视觉钩子：
//   - setSiteAnchorResolver(spec → DOM element)
//       识别 { tweetId } / { username } / 'http(s)://x.com/...status/<id>' /
//       裸数字 id / CSS selector，定位 article[data-testid="tweet"] 或 user link。
//   - setSiteStaggerFlashItems({items, stride, label, tone}) → 列表呼吸感
//       两阶段：① 同步 emit 全部语义 flash 进 ring buffer（drain 立即取走，
//       零 timing drift）；② setTimeout 内 scrollIntoView + flashElement 画 outline。
//       完整对齐 reddit `_visual-reddit.js` 的设计，X 上没有这块就只剩 default
//       stagger（不滚动），首屏外推文永远看不见 flash 效果。
//
// 由 bridges/common.js 顶部 `// @@include` 注入；依赖 visual.common.js 已建好
// `window.__jse_visual`。
// ---------------------------------------------------------------------------

;(function installXVisualHooks(){
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || typeof window.__jse_visual.setSiteAnchorResolver !== 'function') return;

  function safeQS(sel){
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (_) { return null; }
  }

  function escapeCss(s){
    if (typeof s !== 'string') return '';
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
      try { return window.CSS.escape(s); } catch (_) {}
    }
    return s.replace(/[^\w-]/g, function(ch){ return '\\' + ch; });
  }

  function tweetIdFromUrl(s){
    if (typeof s !== 'string') return null;
    const m = /(?:status|tweet)\/(\d{6,})/i.exec(s);
    return m ? m[1] : null;
  }

  function resolveTweet(idLike){
    if (idLike == null) return null;
    let id = String(idLike).trim();
    if (!/^\d{6,}$/.test(id)) {
      const fromUrl = tweetIdFromUrl(id);
      if (fromUrl) id = fromUrl;
      else return null;
    }
    const idEsc = escapeCss(id);
    // X 的 article[data-testid="tweet"] 不带 data-tweet-id 属性，tweetId 仅出现
    // 在内嵌的 <a href="/.../status/<id>">。直接命中 <a> 会让 outline 画成
    // 一根细长条；这里命中 <a> 后用 closest 升级到 article 整卡，再兜底。
    const direct = safeQS('article[data-testid="tweet"][data-tweet-id="' + idEsc + '"]');
    if (direct) return direct;
    const linkInArticle = safeQS('article[data-testid="tweet"] a[href*="/status/' + idEsc + '"]');
    if (linkInArticle) {
      const card = (typeof linkInArticle.closest === 'function')
        ? linkInArticle.closest('article[data-testid="tweet"]')
        : null;
      return card || linkInArticle;
    }
    const anyLink = safeQS('a[href*="/status/' + idEsc + '"]');
    if (anyLink) {
      const card = (typeof anyLink.closest === 'function')
        ? anyLink.closest('article[data-testid="tweet"]')
        : null;
      return card || anyLink;
    }
    return null;
  }

  function resolveUser(name){
    if (!name) return null;
    const u = String(name).replace(/^@/, '').trim();
    if (!u) return null;
    const ue = escapeCss(u);
    return safeQS('a[href="/' + ue + '"]')
        || safeQS('a[href^="/' + ue + '/"]')
        || safeQS('[data-testid="UserName"] a');
  }

  function resolveAnchor(spec){
    if (spec == null) return null;
    if (typeof spec === 'string') {
      const id = /^\d{6,}$/.test(spec.trim()) ? spec.trim() : tweetIdFromUrl(spec);
      if (id) return resolveTweet(id);
      if (spec.indexOf('article') === 0) return safeQS(spec);
      return safeQS(spec);
    }
    if (typeof spec === 'object') {
      if (spec.selector && typeof spec.selector === 'string') return safeQS(spec.selector);
      if (spec.tweetId != null) return resolveTweet(spec.tweetId);
      if (spec.url) return resolveTweet(tweetIdFromUrl(String(spec.url)) || spec.url);
      if (spec.username) return resolveUser(spec.username);
    }
    return null;
  }

  function staggerFlashItems(opts){
    const o = opts || {};
    const items = Array.isArray(o.items) ? o.items.slice(0, 12) : [];
    const cfg = (window.__jse_visual.getConfig && window.__jse_visual.getConfig()) || {};
    const stride = typeof o.stride === 'number'
      ? Math.max(0, o.stride)
      : (cfg.listStrideMs || 90);
    const tone = o.tone || 'info';
    const label = o.label || '';
    const v = window.__jse_visual;

    // 阶段 1：同步 emit 全部语义 flash 到 ring buffer。
    // 后台 tab 的 setTimeout 会被浏览器节流到 1Hz，若把 emit 也丢进 setTimeout，
    // 90ms*N 的 stagger 几乎全漂到下次 drain 之后；同步入 buffer 可保证 events.jsonl
    // 总数 100% 准确。
    let scheduled = 0;
    items.forEach(function(item){
      try {
        if (v && typeof v.emit === 'function') {
          const anchorObj = (item && typeof item === 'object')
            ? Object.assign({}, item)
            : { spec: String(item || '') };
          v.emit({ type: 'flash', tone: tone, label: label, anchor: anchorObj });
          scheduled++;
        }
      } catch (_) {}
    });

    // 阶段 2：setTimeout 内做 scrollIntoView + 在线 outline。
    //   - scrollIntoView 是异步：同一 tick 内 getBoundingClientRect() 仍返回滚动前的
    //     rect，flashElement::isInViewport 立刻拒绝 → 在线看不到任何 outline 框
    //     （录制里仍有 flash 事件，因为阶段 1 同步 emit 过了）。
    //   - 修复：scroll 与 flash 拆成两段 setTimeout，中间留 60ms 给浏览器完成 layout
    //     更新；rect 已是滚动后的，isInViewport 通过，outline 正常画出。
    const scrollSettleMs = 60;
    items.forEach(function(item, idx){
      window.setTimeout(function(){
        const el = resolveAnchor(item);
        if (!el) return;
        let needsScroll = false;
        try {
          const rect0 = el.getBoundingClientRect && el.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          const inVP = rect0
            && rect0.width > 4
            && rect0.height > 4
            && rect0.top < vh - 80
            && rect0.bottom > 80;
          if (!inVP && typeof el.scrollIntoView === 'function') {
            needsScroll = true;
            try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); }
            catch (_) { try { el.scrollIntoView(true); } catch (__) {} }
          }
        } catch (_) {}
        const drawFlash = function(){
          try {
            v.flashElement(el, { tone: tone, label: label, anchor: item });
          } catch (_) {}
        };
        if (needsScroll) window.setTimeout(drawFlash, scrollSettleMs);
        else drawFlash();
      }, idx * stride);
    });

    if (items.length > 0) {
      const n = items.length;
      const dur = typeof cfg.durationMs === 'number' ? cfg.durationMs : 420;
      const lastEdge = (n - 1) * stride + scrollSettleMs;
      if (typeof v.bumpCaptureSettleRelative === 'function') {
        v.bumpCaptureSettleRelative(lastEdge + Math.floor(dur * 0.55) + 80);
      }
    }

    return scheduled;
  }

  window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
  if (typeof window.__jse_visual.setSiteStaggerFlashItems === 'function') {
    window.__jse_visual.setSiteStaggerFlashItems(staggerFlashItems);
  }
})();
