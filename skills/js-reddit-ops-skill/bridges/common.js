// bridges/common.js
// ---------------------------------------------------------------------------
// 本文件是纯浏览器代码，不要被 Node require。
// 每个 bridge 文件的顶部包含一行：
//   // @@include ./common.js
// session.js 在注入 bridge 前会把这一行替换为本文件全部内容，
// 从而实现 helpers 单一来源（不依赖运行时 module resolution）。
//
// 设计取舍：
// - READ 数据优先走 reddit 公开 JSON 端点（与浏览器同源，复用 cookie）。
// - DOM 兜底交给 Node 端 cheerio 实现，本 bridge 不再 walk 复杂 DOM。
// - 双前端探测仅做粗粒度判断（shreddit / old / unknown），决定后续 helper 的取数路径。
// ---------------------------------------------------------------------------

const __jseRedditCache = {
  frontendHref: null,
  frontend: null,
  meHref: null,
  me: null,
};

function clampLimit(value, defaultValue, maxValue){
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function shortText(value, maxLen){
  const text = String(value == null ? '' : value);
  const limit = clampLimit(maxLen, 2000, 20000);
  if (text.length <= limit) return { text, truncated: false, length: text.length };
  return { text: text.slice(0, limit), truncated: true, length: text.length };
}

function detectFrontend(){
  const href = location.href;
  if (__jseRedditCache.frontendHref === href && __jseRedditCache.frontend) {
    return __jseRedditCache.frontend;
  }
  let frontend = 'unknown';
  try {
    if (typeof window.shreddit !== 'undefined'
        || document.querySelector('shreddit-app, shreddit-post, shreddit-comment')) {
      frontend = 'shreddit';
    } else if (document.querySelector('#siteTable, body.listing-page, #header-bottom-left')) {
      frontend = 'old';
    } else if (/(^|\.)old\.reddit\.com/i.test(location.hostname)) {
      frontend = 'old';
    } else if (/reddit\.com$/i.test(location.hostname) || /\.reddit\.com$/i.test(location.hostname)) {
      frontend = 'shreddit';
    }
  } catch (_) {}
  __jseRedditCache.frontendHref = href;
  __jseRedditCache.frontend = frontend;
  return frontend;
}

function buildRedditUrl(path, params){
  let origin = 'https://www.reddit.com';
  try {
    if (location.origin && /reddit\.com$/i.test(location.hostname)) {
      origin = location.origin;
    }
  } catch (_) {}
  let qs = '';
  if (params && typeof params === 'object') {
    const usp = new URLSearchParams();
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (v == null || v === '') continue;
      usp.set(k, String(v));
    }
    qs = usp.toString();
  }
  const sep = path.includes('?') ? '&' : '?';
  return origin + path + (qs ? sep + qs : '');
}

async function fetchRedditJson(path, params, options){
  options = options || {};
  let p = path;
  if (!/\.json(\?|$)/.test(p)) {
    if (p.includes('?')) {
      p = p.replace('?', '.json?');
    } else {
      p = p + '.json';
    }
  }
  const url = buildRedditUrl(p, Object.assign({ raw_json: 1 }, params || {}));
  let res = null;
  let data = null;
  try {
    res = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: Object.assign({
        'Accept': 'application/json',
      }, options.headers || {}),
      redirect: 'follow',
    });
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/json/i.test(contentType)) {
      data = await res.json();
    } else {
      const snippet = shortText(await res.text(), options.textLimit || 2000);
      data = {
        _nonJson: true,
        contentType,
        text: snippet.text,
        truncated: snippet.truncated,
        length: snippet.length,
      };
    }
  } catch (e) {
    return { ok: false, error: 'network_error', message: String((e && e.message) || e), url };
  }
  return { ok: !!(res && res.ok), httpStatus: res ? res.status : null, url, data };
}

async function readMeViaApi(force){
  const href = location.href;
  if (!force && __jseRedditCache.meHref === href && __jseRedditCache.me) return __jseRedditCache.me;
  const resp = await fetchRedditJson('/api/v1/me.json', null, { textLimit: 512 });
  let info = { loggedIn: false, name: null, totalKarma: null, modhash: null, source: 'api' };
  if (resp && resp.ok && resp.data && typeof resp.data === 'object' && !resp.data._nonJson) {
    const d = resp.data.data || resp.data;
    if (d && typeof d === 'object') {
      info = {
        loggedIn: !!d.name && !d.error,
        name: d.name || null,
        totalKarma: typeof d.total_karma === 'number' ? d.total_karma : null,
        modhash: d.modhash || null,
        source: 'api',
      };
    }
  }
  __jseRedditCache.meHref = href;
  __jseRedditCache.me = info;
  return info;
}

function readLoginStateDom(){
  try {
    const userLink = document.querySelector('#header .user a[href^="/user/"]');
    if (userLink) {
      const href = userLink.getAttribute('href') || '';
      const m = /\/user\/([\w-]+)/.exec(href);
      return { loggedIn: !!(m && m[1] && !/login/i.test(href)), name: m ? m[1] : null, source: 'old-header' };
    }
    const drawer = document.querySelector(
      'faceplate-dropdown-menu[noun="user-drawer"], faceplate-dropdown-menu[noun="user_drawer"], faceplate-tracker[noun="user_drawer"]'
    );
    if (drawer) {
      const name = drawer.getAttribute('username') || drawer.getAttribute('user-name') || null;
      return { loggedIn: !!name, name, source: 'shreddit-drawer' };
    }
  } catch (_) {}
  return { loggedIn: false, name: null, source: 'unknown' };
}

function parsePostUrl(url){
  try {
    const u = new URL(url);
    const m = /^\/(?:r\/([\w-]+)\/)?comments\/(\w+)(?:\/[^/]*)?\/?$/.exec(u.pathname);
    if (!m) return { sub: null, postId: null };
    return { sub: m[1] || null, postId: m[2] };
  } catch (_) {
    return { sub: null, postId: null };
  }
}

function unixToIso(secs){
  if (typeof secs !== 'number' || !Number.isFinite(secs)) return '';
  try { return new Date(secs * 1000).toISOString(); } catch (_) { return ''; }
}

function pickImageUrlsFromPost(post){
  if (!post || typeof post !== 'object') return [];
  const out = [];
  const seen = new Set();
  const push = (src) => {
    if (!src || typeof src !== 'string') return;
    if (!/^https?:/i.test(src)) return;
    if (/avatar|emoji|redditstatic|favicon/i.test(src)) return;
    if (seen.has(src)) return;
    seen.add(src);
    out.push(src);
  };
  if (post.url && /(i\.redd\.it|preview\.redd\.it|external-preview)/i.test(post.url)) push(post.url);
  if (post.url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(post.url)) push(post.url);
  if (post.media_metadata && typeof post.media_metadata === 'object') {
    for (const k of Object.keys(post.media_metadata)) {
      const m = post.media_metadata[k];
      if (m && m.s) {
        const u = m.s.u || m.s.gif || m.s.mp4 || null;
        if (u) push(String(u).replace(/&amp;/g, '&'));
      }
    }
  }
  if (post.preview && Array.isArray(post.preview.images)) {
    for (const img of post.preview.images) {
      if (img && img.source && typeof img.source.url === 'string') {
        push(img.source.url.replace(/&amp;/g, '&'));
      }
    }
  }
  return out;
}

function buildCommentTree(children, depth){
  if (!Array.isArray(children)) return [];
  const out = [];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    if (child.kind === 'more') {
      const c = child.data || {};
      out.push({
        author_name: '',
        comment_id: c.name || (c.id ? 'more_' + c.id : ''),
        content: '',
        score: '0',
        depth: typeof c.depth === 'number' ? c.depth : depth,
        permalink: '',
        time: '',
        replies: [],
        _kind: 'more',
        _children: Array.isArray(c.children) ? c.children.slice(0, 1000) : [],
        _count: typeof c.count === 'number' ? c.count : 0,
        _parent_id: typeof c.parent_id === 'string' ? c.parent_id : '',
      });
      continue;
    }
    if (child.kind !== 't1') continue;
    const c = child.data || {};
    const repliesData = c.replies && typeof c.replies === 'object'
      ? (c.replies.data && Array.isArray(c.replies.data.children) ? c.replies.data.children : null)
      : null;
    const replies = buildCommentTree(repliesData, depth + 1);
    out.push({
      author_name: typeof c.author === 'string' ? c.author : '',
      comment_id: c.name || (c.id ? 't1_' + c.id : ''),
      content: typeof c.body === 'string' ? c.body : '',
      score: String(typeof c.score === 'number' ? c.score : (c.score == null ? 0 : c.score)),
      depth: typeof c.depth === 'number' ? c.depth : depth,
      permalink: c.permalink ? ('https://www.reddit.com' + c.permalink) : '',
      time: unixToIso(c.created_utc),
      replies,
    });
  }
  return out;
}

function countCommentsInTree(items){
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const c of items) {
    if (c && c._kind === 'more') continue;
    n += 1 + countCommentsInTree(c.replies || []);
  }
  return n;
}

function normalizePostListingItem(child){
  if (!child || typeof child !== 'object' || child.kind !== 't3') return null;
  const d = child.data || {};
  return {
    id: d.name || (d.id ? 't3_' + d.id : ''),
    postId: d.id || '',
    kind: 't3',
    title: typeof d.title === 'string' ? d.title : '',
    selftext: typeof d.selftext === 'string' ? d.selftext : '',
    author: typeof d.author === 'string' ? d.author : '',
    subreddit: typeof d.subreddit === 'string' ? d.subreddit : '',
    subredditPrefixed: typeof d.subreddit_name_prefixed === 'string' ? d.subreddit_name_prefixed : '',
    score: typeof d.score === 'number' ? d.score : 0,
    upvoteRatio: typeof d.upvote_ratio === 'number' ? d.upvote_ratio : null,
    numComments: typeof d.num_comments === 'number' ? d.num_comments : 0,
    permalink: d.permalink ? ('https://www.reddit.com' + d.permalink) : '',
    url: typeof d.url === 'string' ? d.url : '',
    createdUtc: unixToIso(d.created_utc),
    isSelf: !!d.is_self,
    isVideo: !!d.is_video,
    over18: !!d.over_18,
    stickied: !!d.stickied,
    spoiler: !!d.spoiler,
    domain: typeof d.domain === 'string' ? d.domain : '',
    flair: typeof d.link_flair_text === 'string' ? d.link_flair_text : '',
    thumbnail: (typeof d.thumbnail === 'string' && /^https?:/.test(d.thumbnail)) ? d.thumbnail : '',
    images: pickImageUrlsFromPost(d),
  };
}

function normalizeCommentListingItem(child){
  if (!child || typeof child !== 'object' || child.kind !== 't1') return null;
  const d = child.data || {};
  return {
    id: d.name || (d.id ? 't1_' + d.id : ''),
    kind: 't1',
    body: typeof d.body === 'string' ? d.body : '',
    author: typeof d.author === 'string' ? d.author : '',
    subreddit: typeof d.subreddit === 'string' ? d.subreddit : '',
    score: typeof d.score === 'number' ? d.score : 0,
    permalink: d.permalink ? ('https://www.reddit.com' + d.permalink) : '',
    linkTitle: typeof d.link_title === 'string' ? d.link_title : '',
    linkPermalink: d.link_permalink ? d.link_permalink : '',
    linkAuthor: typeof d.link_author === 'string' ? d.link_author : '',
    parentId: typeof d.parent_id === 'string' ? d.parent_id : '',
    createdUtc: unixToIso(d.created_utc),
    over18: !!d.over_18,
  };
}

function normalizeMessageListingItem(child){
  if (!child || typeof child !== 'object') return null;
  const kind = child.kind;
  const d = child.data || {};
  if (kind !== 't1' && kind !== 't4') return null;
  return {
    id: d.name || (d.id ? kind + '_' + d.id : ''),
    kind,
    type: kind === 't4' ? 'message' : (d.type || 'comment_reply'),
    subject: typeof d.subject === 'string' ? d.subject : '',
    body: typeof d.body === 'string' ? d.body : '',
    author: typeof d.author === 'string' ? d.author : '',
    destination: typeof d.dest === 'string' ? d.dest : '',
    subreddit: typeof d.subreddit === 'string' ? d.subreddit : '',
    linkTitle: typeof d.link_title === 'string' ? d.link_title : '',
    context: typeof d.context === 'string' ? d.context : '',
    parentId: typeof d.parent_id === 'string' ? d.parent_id : '',
    isUnread: !!d.new,
    createdUtc: unixToIso(d.created_utc),
  };
}

function summarizeListing(listing, options){
  options = options || {};
  if (!listing || typeof listing !== 'object') {
    return { items: [], after: null, before: null, returnedCount: 0, dist: null };
  }
  const data = listing.data || {};
  const childrenRaw = Array.isArray(data.children) ? data.children : [];
  const normalize = options.normalize || normalizePostListingItem;
  const items = [];
  for (const child of childrenRaw) {
    const item = normalize(child);
    if (item) items.push(item);
  }
  return {
    items,
    after: typeof data.after === 'string' ? data.after : null,
    before: typeof data.before === 'string' ? data.before : null,
    returnedCount: items.length,
    dist: typeof data.dist === 'number' ? data.dist : null,
  };
}

async function sessionStateCommon(){
  let me = { loggedIn: false, name: null, totalKarma: null, modhash: null, source: 'api' };
  try { me = await readMeViaApi(false); } catch (_) {}
  const dom = readLoginStateDom();
  return okResult({
    loggedIn: !!(me.loggedIn || dom.loggedIn),
    name: me.name || dom.name || null,
    totalKarma: me.totalKarma,
    modhash: me.modhash,
    source: me.loggedIn ? 'api' : (dom.loggedIn ? 'dom' : 'none'),
    api: me,
    dom,
    url: location.href,
    timestamp: new Date().toISOString(),
  });
}

/**
 * navigateLocation - INTERACTIVE 档位通用导航：仅 location.assign，绝不模拟点击。
 *
 * @param {string} targetUrl  目标 URL（必须是 reddit.com 同源；其它会被拒）
 * @returns {{ok:true, data:{noop:boolean, from:{url:string}, to:{url:string}, hint:string}}}
 *        | {ok:false, error:string, ...}
 */
function navigateLocation(targetUrl){
  const fromUrl = location.href;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return errResult('missing_target_url');
  }
  let parsed;
  try { parsed = new URL(targetUrl, location.href); } catch (_) {
    return errResult('invalid_target_url', { targetUrl });
  }
  if (!/(?:^|\.)reddit\.com$/i.test(parsed.hostname)) {
    return errResult('cross_origin_navigation_forbidden', { hostname: parsed.hostname });
  }
  const to = parsed.toString();
  if (to === fromUrl) {
    return okResult({ noop: true, from: { url: fromUrl }, to: { url: to }, hint: 'already_at_target' });
  }
  try {
    location.assign(to);
  } catch (e) {
    return errResult('location_assign_threw', { message: String((e && e.message) || e), from: { url: fromUrl }, to: { url: to } });
  }
  return okResult({ noop: false, from: { url: fromUrl }, to: { url: to }, hint: 'page_will_reload' });
}

function buildQueryPatch(patch, baseUrl){
  let u;
  try { u = new URL(baseUrl || location.href); } catch (_) { u = new URL('https://www.reddit.com/'); }
  const p = u.searchParams;
  const input = patch || {};
  for (const k of Object.keys(input)){
    const v = input[k];
    if (v == null || v === '') {
      p.delete(k);
    } else {
      p.set(k, String(v));
    }
  }
  return u.origin + u.pathname + (p.toString() ? '?' + p.toString() : '') + (u.hash || '');
}

function okResult(data){ return { ok: true, data }; }
function errResult(error, extra){ return Object.assign({ ok: false, error: String(error) }, extra || {}); }
