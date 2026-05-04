'use strict';

// X.com 工具 → visual hint（供 @js-eyes/visual-bridge-kit wrapCallApi）。

const HINTS = {
  x_session_state: {
    kind: 'global',
    label: 'X 登录态',
  },
  x_search_tweets: {
    kind: 'list',
    label: ({ args }) => `搜索 "${String((args && args.keyword) || '').slice(0, 32)}"`,
    target: ({ args }) => ((args && args.keyword) || ''),
  },
  x_get_profile: {
    kind: 'list',
    label: ({ args }) => `@${(args && args.username) || '?'} 时间线`,
    anchor: ({ args }) => ((args && args.username) ? { username: args.username } : null),
    target: ({ args }) => ((args && args.username) || ''),
  },
  x_get_post: {
    kind: 'item',
    label: ({ args }) => `推文 · ${truncateId((args && args.tweetUrl) || '')}`,
    target: ({ args }) => ((args && args.tweetUrl) || ''),
  },
  x_get_home_feed: {
    kind: 'list',
    label: ({ args }) => `首页 · ${((args && args.feed) || 'foryou')}`,
    target: ({ args }) => ((args && args.feed) || 'foryou'),
  },
  x_navigate_search: {
    kind: 'navigation',
    label: ({ args }) => `导航搜索 "${String((args && args.keyword) || '').slice(0, 32)}"`,
    target: ({ args }) => ((args && args.keyword) || ''),
  },
  x_navigate_profile: {
    kind: 'navigation',
    label: ({ args }) => `导航用户 @${(args && args.username) || '?'}`,
    target: ({ args }) => ((args && args.username) || ''),
  },
  x_navigate_post: {
    kind: 'navigation',
    label: ({ args }) => `导航推文`,
    target: ({ args }) => ((args && args.tweetUrl) || ''),
  },
  x_navigate_home: {
    kind: 'navigation',
    label: ({ args }) => `导航首页 ${((args && args.feed) || 'foryou')}`,
    target: ({ args }) => ((args && args.feed) || 'home'),
  },
};

function truncateId(u){
  if (typeof u !== 'string') return '';
  return u.length > 48 ? u.slice(0, 45) + '…' : u;
}

function evalField(value, ctx){
  if (typeof value === 'function') {
    try { return value(ctx); } catch (_) { return ''; }
  }
  return value == null ? '' : value;
}

function getVisualHint(toolName, args){
  const def = HINTS[toolName];
  const ctx = { args: args || {}, toolName };
  if (!def) {
    return {
      kind: 'global',
      toolName,
      label: toolName,
      anchor: null,
      target: '',
      detail: '',
      tone: 'pending',
    };
  }
  return {
    kind: def.kind || 'global',
    toolName,
    label: evalField(def.label, ctx) || toolName,
    anchor: evalField(def.anchor, ctx) || null,
    target: evalField(def.target, ctx) || '',
    detail: evalField(def.detail, ctx) || '',
    tone: def.tone || 'pending',
  };
}

function pickTweetArray(data){
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.tweets)) return data.tweets;
  if (data.data && Array.isArray(data.data.tweets)) return data.data.tweets;
  return null;
}

function extractTweetAnchors(data){
  const arr = pickTweetArray(data);
  const out = [];
  if (!arr) return out;
  for (const tw of arr) {
    if (!tw) continue;
    const id = tw.tweetId || tw.id || tw.rest_id;
    if (id != null) out.push({ tweetId: String(id) });
    if (out.length >= 8) break;
  }
  return out;
}

function buildSummary(resp, hint){
  if (!resp || typeof resp !== 'object') {
    return { ok: false, items: [], relate: [], errorCode: 'no_response', detail: '', target: '' };
  }
  if (resp.ok === false) {
    return {
      ok: false,
      items: [],
      relate: [],
      errorCode: resp.error || resp.code || 'unknown',
      detail: resp.message || '',
      target: '',
    };
  }
  const data = (resp.data && typeof resp.data === 'object') ? resp.data : null;
  const kind = (hint && hint.kind) || 'global';

  if (kind === 'list' && data) {
    const items = extractTweetAnchors(data);
    return {
      ok: true,
      items,
      relate: [],
      errorCode: '',
      detail: items.length ? `${items.length} 条` : '',
      target: '',
    };
  }

  if (kind === 'item' && data) {
    const tw = data.tweet && typeof data.tweet === 'object' ? data.tweet : data;
    const id = tw && (tw.tweetId || tw.id);
    const items = id ? [{ tweetId: String(id) }] : [];
    return {
      ok: true,
      items,
      relate: [],
      errorCode: '',
      detail: '',
      target: '',
    };
  }

  return { ok: true, items: [], relate: [], errorCode: '', detail: '', target: '' };
}

function extractTweetCard(tw){
  if (!tw || typeof tw !== 'object') return null;
  const rawId = tw.tweetId || tw.id || tw.rest_id;
  const tweetId = rawId != null ? String(rawId) : '';
  const text = tw.text || tw.full_text || '';
  // hyperframes translator anchorIdOf({tweetId}) → 'tweet:<id>' namespace；
  // 同时 generic 卡片模板从 item.id 取 data-anchor-id。两边必须用同一个命名空间，
  // 否则 flash event 的 anchorId 与 HTML 卡片的 data-anchor-id 对不上，离线 composition
  // 里 .flash-active 永远附不到任何节点（视觉上完全看不到选中高亮）。
  return {
    id: tweetId ? ('tweet:' + tweetId) : '',
    tweetId,
    text: typeof text === 'string' ? (text.length > 280 ? text.slice(0, 277) + '…' : text) : '',
    screenName: tw.screenName || tw.username || (tw.author && tw.author.username) || '',
    likes: tw.stats && tw.stats.likes,
    retweets: tw.stats && tw.stats.retweets,
  };
}

function extractPayload(resp, hint, err){
  if (err) {
    return {
      error: {
        message: err && err.message ? String(err.message) : String(err),
        code: err && err.code ? String(err.code) : '',
      },
    };
  }
  if (!resp || typeof resp !== 'object') return null;
  const data = (resp.data && typeof resp.data === 'object') ? resp.data : null;
  const kind = (hint && hint.kind) || 'global';

  if (kind === 'navigation') {
    const to = (resp && (resp.url || resp.to)) || (data && (data.url || data.to)) || (hint && hint.target) || '';
    const from = (resp && resp.from) || (data && data.from) || '';
    return {
      from: typeof from === 'string' ? from : '',
      to: typeof to === 'string' ? to : '',
      hint: 'page_will_reload',
      label: (hint && hint.label) || '',
    };
  }

  if (kind === 'list' && data) {
    const arr = pickTweetArray(data) || [];
    const items = arr.slice(0, 12).map(extractTweetCard).filter(Boolean);
    return {
      items,
      totalCount: arr.length,
      keyword: data.keyword || '',
      username: data.username || '',
      label: (hint && hint.label) || '',
      target: (hint && hint.target) || '',
    };
  }

  if (kind === 'item' && data) {
    const tw = data.tweet && typeof data.tweet === 'object' ? data.tweet : data;
    const card = extractTweetCard(tw);
    return card || { tweetId: '', text: '' };
  }

  if (kind === 'global') {
    const d = data || resp;
    const fields = [];
    if (d && typeof d === 'object') {
      for (const k of ['loggedIn', 'username', 'screenName', 'name', 'userId']) {
        if (d[k] != null) fields.push({ k, v: String(d[k]) });
      }
    }
    return { summary: '', fields: fields.slice(0, 12) };
  }

  return null;
}

module.exports = {
  getVisualHint,
  buildSummary,
  extractPayload,
};
