// bridges/common.js
// ---------------------------------------------------------------------------
// 纯浏览器代码。通过 // @@include ./common.js 注入各 bridge。
// READ：Firebase API + Algolia + DOM 兜底。
// ---------------------------------------------------------------------------

const HN_FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0';
const HN_ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

const FEED_TO_STORIES = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
  job: 'jobstories',
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

function okResult(data){ return { ok: true, data }; }
function errResult(error, extra){ return Object.assign({ ok: false, error: String(error) }, extra || {}); }

async function fetchHnFirebase(path, options){
  options = options || {};
  const p = path && path.charAt(0) === '/' ? path : '/' + String(path || '');
  const url = HN_FIREBASE_BASE + p;
  let res = null;
  let data = null;
  try {
    res = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'omit',
      headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      redirect: 'follow',
    });
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/json/i.test(contentType)) {
      data = await res.json();
    } else {
      const snippet = shortText(await res.text(), options.textLimit || 2000);
      data = { _nonJson: true, contentType, text: snippet.text, truncated: snippet.truncated, length: snippet.length };
    }
  } catch (e) {
    return { ok: false, error: 'network_error', message: String((e && e.message) || e), url };
  }
  return { ok: !!(res && res.ok), httpStatus: res ? res.status : null, url, data };
}

async function fetchAlgolia(endpoint, params){
  const ep = endpoint === 'date' ? 'search_by_date' : 'search';
  const usp = new URLSearchParams();
  if (params && typeof params === 'object') {
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (v == null || v === '') continue;
      usp.set(k, String(v));
    }
  }
  const url = HN_ALGOLIA_BASE + '/' + ep + (usp.toString() ? '?' + usp.toString() : '');
  let res = null;
  let data = null;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } });
    data = await res.json();
  } catch (e) {
    return { ok: false, error: 'network_error', message: String((e && e.message) || e), url };
  }
  return { ok: !!(res && res.ok), httpStatus: res ? res.status : null, url, data };
}

function readLoginState(){
  try {
    const links = Array.from(document.querySelectorAll('a'));
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      const href = (a.getAttribute && a.getAttribute('href')) || '';
      const text = ((a.textContent || '').trim());
      if (/^logout/i.test(href) || text === 'logout') {
        const prev = links[i - 1];
        const name = prev && prev.getAttribute && prev.getAttribute('href') && prev.getAttribute('href').includes('user?id=')
          ? decodeURIComponent((prev.getAttribute('href').match(/id=([^&]+)/) || [])[1] || '')
          : (text && text !== 'logout' ? text : null);
        return { loggedIn: true, name: name || null, source: 'nav-logout-link' };
      }
    }
    const loginLink = document.querySelector('a[href*="login"]');
    if (loginLink) return { loggedIn: false, name: null, source: 'nav-login-link' };
  } catch (_) {}
  return { loggedIn: false, name: null, source: 'unknown' };
}

async function sessionStateCommon(){
  const dom = readLoginState();
  return okResult({
    loggedIn: !!dom.loggedIn,
    name: dom.name || null,
    source: dom.source,
    url: location.href,
    timestamp: new Date().toISOString(),
  });
}

function navigateLocation(targetUrl){
  const fromUrl = location.href;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return errResult('missing_target_url');
  }
  let parsed;
  try { parsed = new URL(targetUrl, location.href); } catch (_) {
    return errResult('invalid_target_url', { targetUrl });
  }
  if (!/(?:^|\.)news\.ycombinator\.com$/i.test(parsed.hostname)) {
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

function parseItemIdFromUrl(url){
  try {
    const u = new URL(url, 'https://news.ycombinator.com/');
    const id = u.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return parseInt(id, 10);
  } catch (_) {}
  const m = String(url || '').match(/[?&]id=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseUserIdFromUrl(url){
  try {
    const u = new URL(url, 'https://news.ycombinator.com/');
    const id = u.searchParams.get('id');
    if (id) return decodeURIComponent(id);
  } catch (_) {}
  const m = String(url || '').match(/[?&]id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function normalizeFeed(feed){
  const f = String(feed || 'top').toLowerCase().trim();
  return FEED_TO_STORIES[f] ? f : 'top';
}

function feedStoriesPath(feed){
  return '/' + FEED_TO_STORIES[normalizeFeed(feed)] + '.json';
}

function summarizeApiItem(d){
  if (!d || typeof d !== 'object') return null;
  return {
    id: typeof d.id === 'number' ? d.id : null,
    type: typeof d.type === 'string' ? d.type : null,
    title: typeof d.title === 'string' ? d.title : null,
    url: typeof d.url === 'string' ? d.url : null,
    text: typeof d.text === 'string' ? d.text : null,
    points: typeof d.score === 'number' ? d.score : null,
    author: typeof d.by === 'string' ? d.by : null,
    parentId: typeof d.parent === 'number' ? d.parent : null,
    kids: Array.isArray(d.kids) ? d.kids.slice(0, 500) : [],
    kidsCount: Array.isArray(d.kids) ? d.kids.length : 0,
    createdAt: typeof d.time === 'number' ? d.time : null,
    createdAtIso: typeof d.time === 'number' ? new Date(d.time * 1000).toISOString() : null,
    hnUrl: typeof d.id === 'number' ? 'https://news.ycombinator.com/item?id=' + d.id : null,
  };
}

function summarizeApiUser(d){
  if (!d || typeof d !== 'object') return null;
  return {
    id: typeof d.id === 'string' ? d.id : null,
    karma: typeof d.karma === 'number' ? d.karma : null,
    createdAt: typeof d.created === 'string' ? d.created : null,
    about: typeof d.about === 'string' ? d.about : null,
    submittedCount: Array.isArray(d.submitted) ? d.submitted.length : 0,
    submitted: Array.isArray(d.submitted) ? d.submitted.slice(0, 500) : [],
  };
}

async function fetchSingleItem(id){
  const resp = await fetchHnFirebase('/item/' + encodeURIComponent(String(id)) + '.json');
  if (!resp.ok || !resp.data || resp.data._nonJson) return { ok: false, resp };
  return { ok: true, item: resp.data, httpStatus: resp.httpStatus, url: resp.url };
}

async function batchFetchItems(ids, limit){
  const lim = clampLimit(limit, 30, 100);
  const slice = (ids || []).slice(0, lim);
  const items = [];
  for (let i = 0; i < slice.length; i++) {
    const r = await fetchSingleItem(slice[i]);
    if (r.ok && r.item) items.push(r.item);
  }
  return items;
}

async function fetchItemTree(rootId, options){
  options = options || {};
  const maxDepth = clampLimit(options.depth, 6, 20);
  const maxItems = clampLimit(options.limit, 200, 500);
  const items = [];
  const byParent = {};
  const seen = new Set();
  let truncated = false;

  async function walk(id, depth, parentId){
    if (seen.size >= maxItems) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) {
      truncated = true;
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    const r = await fetchSingleItem(id);
    if (!r.ok || !r.item) return;
    const summary = summarizeApiItem(r.item);
    const flat = Object.assign({}, summary, { depth, parentId: parentId || null });
    items.push(flat);
    if (parentId != null) {
      if (!byParent[parentId]) byParent[parentId] = [];
      byParent[parentId].push(id);
    }
    const kids = r.item.kids || [];
    for (let i = 0; i < kids.length; i++) {
      if (seen.size >= maxItems) {
        truncated = true;
        break;
      }
      await walk(kids[i], depth + 1, id);
    }
  }

  await walk(rootId, 0, null);
  return { items, byParent, truncated, rootId };
}

function parseFrontPageDom(limit){
  const lim = clampLimit(limit, 30, 100);
  const rows = [];
  try {
    const athings = Array.from(document.querySelectorAll('.athing'));
    for (let i = 0; i < athings.length && rows.length < lim; i++) {
      const row = athings[i];
      const titleLink = row.querySelector('.titleline a, td.title a');
      const subtext = row.nextElementSibling;
      const subtextEl = subtext && subtext.classList && subtext.classList.contains('subtext') ? subtext : null;
      let itemId = null;
      const href = titleLink && titleLink.getAttribute('href') || '';
      const idMatch = href.match(/id=(\d+)/);
      if (idMatch) itemId = parseInt(idMatch[1], 10);
      const site = row.querySelector('.sitebit a, .sitestr');
      let points = null;
      let author = null;
      let age = null;
      if (subtextEl) {
        const scoreEl = subtextEl.querySelector('.score');
        if (scoreEl) {
          const pm = (scoreEl.textContent || '').match(/(\d+)/);
          if (pm) points = parseInt(pm[1], 10);
        }
        const userEl = subtextEl.querySelector('.hnuser');
        if (userEl) author = (userEl.textContent || '').trim();
        const ageEl = subtextEl.querySelector('.age');
        if (ageEl) age = (ageEl.getAttribute('title') || ageEl.textContent || '').trim();
      }
      rows.push({
        rank: rows.length + 1,
        itemId,
        title: titleLink ? (titleLink.textContent || '').trim() : null,
        url: titleLink && titleLink.href ? titleLink.href : null,
        site: site ? (site.textContent || '').trim() : null,
        points,
        author,
        age,
        hnUrl: itemId ? 'https://news.ycombinator.com/item?id=' + itemId : null,
      });
    }
  } catch (_) {}
  return rows;
}

function parseItemPageDom(){
  const post = { title: null, url: null, text: null, author: null, points: null, itemId: parseItemIdFromUrl(location.href) };
  try {
    const titleLine = document.querySelector('.titleline, .fatitem .title, span.title');
    if (titleLine) {
      const a = titleLine.querySelector('a');
      post.title = a ? (a.textContent || '').trim() : (titleLine.textContent || '').trim();
      post.url = a && a.href ? a.href : null;
    }
    const fat = document.querySelector('.fatitem');
    if (fat) {
      const sub = fat.querySelector('.subtext, .comhead');
      if (sub) {
        const user = sub.querySelector('.hnuser');
        if (user) post.author = (user.textContent || '').trim();
        const score = sub.querySelector('.score');
        if (score) {
          const m = (score.textContent || '').match(/(\d+)/);
          if (m) post.points = parseInt(m[1], 10);
        }
      }
    }
    const textEl = document.querySelector('.fatitem .toptext, .fatitem td:nth-child(2)');
    if (textEl) post.text = (textEl.textContent || '').trim();
  } catch (_) {}

  const comments = [];
  const byParent = {};
  try {
    const comtrs = Array.from(document.querySelectorAll('tr.comtr'));
    for (let i = 0; i < comtrs.length; i++) {
      const tr = comtrs[i];
      const idAttr = tr.getAttribute('id') || '';
      const commentId = idAttr.startsWith('n') ? parseInt(idAttr.slice(1), 10) : null;
      const indentEl = tr.querySelector('.ind img');
      let depth = 0;
      if (indentEl && indentEl.width) depth = Math.floor(parseInt(indentEl.width, 10) / 40) || 0;
      const userEl = tr.querySelector('.hnuser');
      const author = userEl ? (userEl.textContent || '').trim() : null;
      const defaultEl = tr.querySelector('.default');
      const text = defaultEl ? (defaultEl.textContent || '').trim() : null;
      const ageEl = tr.querySelector('.age');
      const age = ageEl ? (ageEl.getAttribute('title') || ageEl.textContent || '').trim() : null;
      let parentId = post.itemId;
      if (depth > 0 && comments.length > 0) {
        for (let j = comments.length - 1; j >= 0; j--) {
          if (comments[j].depth === depth - 1) {
            parentId = comments[j].id;
            break;
          }
        }
      }
      const entry = { id: commentId, depth, parentId, author, text, age, type: 'comment' };
      comments.push(entry);
      if (parentId != null) {
        if (!byParent[parentId]) byParent[parentId] = [];
        byParent[parentId].push(commentId);
      }
    }
  } catch (_) {}

  return { post, comments, byParent };
}

function parseUserPageDom(limit){
  const lim = clampLimit(limit, 30, 100);
  const profile = { userId: parseUserIdFromUrl(location.href), karma: null, created: null, about: null };
  const items = [];
  try {
    const rows = Array.from(document.querySelectorAll('form table tr'));
    for (let i = 0; i < rows.length; i++) {
      const tds = rows[i].querySelectorAll('td');
      if (tds.length >= 2) {
        const label = (tds[0].textContent || '').trim().toLowerCase();
        const val = (tds[1].textContent || '').trim();
        if (label === 'user:') profile.userId = val || profile.userId;
        if (label === 'karma:') profile.karma = parseInt(val, 10) || null;
        if (label === 'created:') profile.created = val;
        if (label === 'about:') profile.about = val;
      }
    }
    const subtexts = Array.from(document.querySelectorAll('.subtext'));
    for (let i = 0; i < subtexts.length && items.length < lim; i++) {
      const sub = subtexts[i];
      const titleRow = sub.previousElementSibling;
      const titleLink = titleRow && titleRow.querySelector('.titleline a, a');
      let itemId = null;
      const href = titleLink && titleLink.getAttribute('href') || '';
      const m = href.match(/id=(\d+)/);
      if (m) itemId = parseInt(m[1], 10);
      items.push({
        itemId,
        title: titleLink ? (titleLink.textContent || '').trim() : null,
        hnUrl: itemId ? 'https://news.ycombinator.com/item?id=' + itemId : null,
        age: (sub.querySelector('.age') && sub.querySelector('.age').getAttribute('title')) || null,
      });
    }
  } catch (_) {}
  return { profile, items };
}

function resolveReadMode(mode){
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'api' || m === 'dom') return m;
  return 'auto';
}
