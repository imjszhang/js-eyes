// bridges/_visual-x.js
// ---------------------------------------------------------------------------
// X.com 站点视觉钩子：
//   - setSiteAnchorResolver(spec → DOM element)
//       识别 { tweetId } / { username } / 'http(s)://x.com/...status/<id>' /
//       裸数字 id / CSS selector，定位 article[data-testid="tweet"] 或 user link。
//
// v0.7：站点 staggerFlashItems override 已删除。kit 默认 defaultStaggerFlashItems
// 已升级为「规划→批量调度→可选呼吸」三阶段（见 visual.common.js），自带 sync
// emit + 在视口外的项一次 scrollIntoView+settle 后批量 outline，X / Reddit 同时受益。
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

  window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
  // v0.7: 不再注册 site staggerFlashItems —— 直接用 kit 的三阶段默认实现
})();
