'use strict';

// lib/visualHint.js
// ---------------------------------------------------------------------------
// 把工具调用翻译成 visualHint，供 @js-eyes/visual-bridge-kit 的 wrapCallApi 使用。
//
// before：调度层在 callApi 之前调 getVisualHint(toolName, args, null)
// after： 调用 buildSummary(resp, hint) 抽出 items / relate / ok / errorCode
//
// hint shape:
//   {
//     kind:    'item' | 'list' | 'tree' | 'global' | 'navigation' | 'write',
//     toolName: string,
//     label:    string,           // HUD 主标题（包含工具名 + 关键参数）
//     anchor:   anchorSpec | null,// before/after 指向的"主对象"
//     target:   string,           // HUD 副标题（给人看的目标描述）
//     detail:   string,           // HUD 第三行
//     tone:     'pending' | 'info' | 'success' | 'danger',
//   }
//
// summary shape：
//   {
//     ok:        boolean,
//     items:     Array<anchorSpec>,
//     relate:    Array<{from, to, label}>,
//     errorCode: string,
//     detail:    string,
//     target:    string,
//   }
// ---------------------------------------------------------------------------

const HINTS = {
  // ---- READ 档 ----
  reddit_session_state: {
    kind: 'global',
    label: '读取登录态',
  },

  reddit_list_subreddit: {
    kind: 'list',
    label: ({ args }) => `抓 r/${args.sub || '?'} ${args.sort || 'hot'} ${args.limit || ''}`.trim(),
    anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
    target: ({ args }) => (args.sub ? `r/${args.sub}` : ''),
  },

  reddit_subreddit_about: {
    kind: 'item',
    label: ({ args }) => `r/${args.sub || '?'} 元信息`,
    anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
    target: ({ args }) => (args.sub ? `r/${args.sub}` : ''),
  },

  reddit_search: {
    kind: 'list',
    label: ({ args }) => `搜索 "${(args.q || '').slice(0, 24)}"${args.sub ? ` in r/${args.sub}` : ''}`,
    anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
    target: ({ args }) => (args.q || ''),
  },

  reddit_user_profile: {
    kind: 'item',
    label: ({ args }) => `u/${args.name || '?'} ${args.tab || 'overview'}`,
    anchor: ({ args }) => (args.name ? { user: args.name } : null),
    target: ({ args }) => (args.name ? `u/${args.name}` : ''),
  },

  reddit_inbox_list: {
    kind: 'list',
    label: ({ args }) => `inbox · ${args.box || 'inbox'}`,
    target: ({ args }) => (args.box || 'inbox'),
  },

  reddit_my_feed: {
    kind: 'list',
    label: ({ args }) => `feed · ${args.feed || 'home'} · ${args.sort || 'best'}`,
    target: ({ args }) => `${args.feed || 'home'} / ${args.sort || 'best'}`,
  },

  reddit_expand_more: {
    kind: 'tree',
    label: ({ args }) => `展开评论树 · ${args.linkId || ''}`,
    anchor: ({ args }) => (args.linkId ? args.linkId : null),
    target: ({ args }) => (args.linkId || ''),
  },

  // post 命令走 lib/api.js getPost 而非 runTool；保留 hint 以备直接调用 callApi 的链路。
  reddit_get_post: {
    kind: 'item',
    label: ({ args }) => `读取帖子 · ${args.url ? truncateUrl(args.url) : ''}`,
    anchor: ({ args }) => (args.url ? args.url : null),
    target: ({ args }) => (args.url || ''),
  },

  // ---- INTERACTIVE 档（导航；调度层 kind 走 navigation 分支）----
  reddit_navigate_post: {
    kind: 'navigation',
    label: ({ args }) => `导航到帖子 ${args.url ? truncateUrl(args.url) : ''}`,
    anchor: ({ args }) => (args.url ? args.url : null),
    target: ({ args }) => (args.url || ''),
  },
  reddit_navigate_subreddit: {
    kind: 'navigation',
    label: ({ args }) => `导航到 r/${args.sub || '?'}`,
    anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
    target: ({ args }) => (args.sub ? `r/${args.sub}` : ''),
  },
  reddit_navigate_search: {
    kind: 'navigation',
    label: ({ args }) => `搜索导航 "${(args.q || '').slice(0, 24)}"`,
    target: ({ args }) => (args.q || ''),
  },
  reddit_navigate_user: {
    kind: 'navigation',
    label: ({ args }) => `导航到 u/${args.name || '?'}`,
    anchor: ({ args }) => (args.name ? { user: args.name } : null),
    target: ({ args }) => (args.name ? `u/${args.name}` : ''),
  },
  reddit_navigate_inbox: {
    kind: 'navigation',
    label: ({ args }) => `导航到 inbox · ${args.box || 'inbox'}`,
    target: ({ args }) => (args.box || 'inbox'),
  },
  reddit_navigate_home: {
    kind: 'navigation',
    label: ({ args }) => `导航到 ${args.feed || 'home'}`,
    target: ({ args }) => (args.feed || 'home'),
  },
};

function truncateUrl(u){
  if (typeof u !== 'string') return '';
  return u.length > 40 ? u.slice(0, 37) + '…' : u;
}

function evalField(value, ctx){
  if (typeof value === 'function') {
    try { return value(ctx); } catch (_) { return ''; }
  }
  return value == null ? '' : value;
}

/**
 * getVisualHint - 根据工具名 + args 生成 hint。
 *
 * @param {string} toolName
 * @param {object} args
 * @returns {object} hint
 */
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

/**
 * buildSummary - 把 bridge 返回的 resp 翻译成 summary（用于 after hook）。
 *
 * 规则：
 *   - resp.ok === false → ok:false + errorCode
 *   - kind:'list' → 从 result.items[] 抽前 8 个 fullname/id
 *   - kind:'tree' → 从 result.items[] 用 parent_id → fullname 拼 relate
 *   - 其它 → ok:true，items=[], relate=[]
 *
 * @param {object} resp - session.callApi 返回
 * @param {object} hint
 * @returns {object} summary
 */
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
    const items = extractListAnchors(data);
    return {
      ok: true,
      items,
      relate: [],
      errorCode: '',
      detail: items.length ? `${items.length} 项` : '',
      target: '',
    };
  }

  if (kind === 'tree' && data) {
    const relate = extractTreeRelations(data);
    const items = extractListAnchors(data);
    return {
      ok: true,
      items,
      relate,
      errorCode: '',
      detail: items.length ? `+${items.length} 节点` : '',
      target: '',
    };
  }

  return { ok: true, items: [], relate: [], errorCode: '', detail: '', target: '' };
}

function extractListAnchors(data){
  const out = [];
  const arr = pickItemsArray(data);
  if (!arr) return out;
  for (const it of arr) {
    if (!it) continue;
    const fn = it.id || it.name || it.fullname || it.comment_id;
    if (typeof fn === 'string' && /^t[1-5]_/.test(fn)) out.push(fn);
    if (out.length >= 8) break;
  }
  return out;
}

function pickItemsArray(data){
  if (!data) return null;
  if (Array.isArray(data.items)) return data.items;
  if (data.data && Array.isArray(data.data.items)) return data.data.items;
  if (Array.isArray(data.children)) return data.children;
  return null;
}

function extractTreeRelations(data){
  const out = [];
  const arr = pickItemsArray(data);
  if (!arr) return out;
  for (const it of arr) {
    if (!it) continue;
    const child = it.id || it.name || it.fullname || it.comment_id;
    const parent = it.parent_id || it._parent_id;
    if (typeof child === 'string' && typeof parent === 'string'
        && /^t1_/.test(child) && /^t[13]_/.test(parent)) {
      out.push({ from: parent, to: child, label: '' });
    }
    if (out.length >= 24) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot：业务数据 payload 抽取
// ---------------------------------------------------------------------------
// extractPayload(resp, hint, err) → payload 透传到 after event.payload，下游
// hyperframes translator 按 hint.kind 路由到 HTML 模板渲卡片。
//
// payload shape（按 hint.kind）：
//   list       => { items: [redditItem...], totalCount, sub, sort, label, target }
//   item       => 单条 redditItem（外层不再包 items）
//   tree       => { items: [redditItem...], relations: [{from,to,depth}] }
//   global     => { summary, fields: [{k, v}], extra }
//   navigation => { from, to, hint: 'page_will_reload' }
//   write      => 走 global 兜底（首版不做精细抽取）

const REDDIT_ITEM_FIELDS = [
  'id', 'name', 'fullname', 'comment_id',
  'title', 'author', 'subreddit', 'subreddit_name_prefixed',
  'score', 'ups', 'downs', 'upvote_ratio',
  'num_comments', 'created_utc',
  'link_flair_text', 'flair',
  'thumbnail', 'preview_url',
  'permalink', 'url',
  'selftext', 'body', 'body_md',
  'is_video', 'is_self', 'over_18', 'spoiler', 'stickied', 'locked',
  'parent_id', '_parent_id', 'depth',
];

function extractRedditItemFields(it){
  if (!it || typeof it !== 'object') return null;
  const out = {};
  for (const key of REDDIT_ITEM_FIELDS) {
    if (it[key] != null) out[key] = it[key];
  }
  // 规范化：fullname 选用第一个非空 id
  out.id = it.id || it.name || it.fullname || it.comment_id || '';
  // contentPreview：selftext / body / title 截断
  const previewSrc = (typeof it.selftext === 'string' ? it.selftext : '')
    || (typeof it.body === 'string' ? it.body : '')
    || (typeof it.body_md === 'string' ? it.body_md : '')
    || '';
  if (previewSrc) {
    out.contentPreview = previewSrc.length > 240 ? previewSrc.slice(0, 237) + '…' : previewSrc;
  }
  // createdAt（人读）
  if (Number.isFinite(it.created_utc)) {
    try {
      const d = new Date(it.created_utc * 1000);
      out.createdAt = d.toISOString();
    } catch (_) {}
  }
  // subreddit：偏好不带 r/ 的纯名
  if (typeof it.subreddit === 'string' && it.subreddit) {
    out.subreddit = it.subreddit;
  } else if (typeof it.subreddit_name_prefixed === 'string') {
    out.subreddit = it.subreddit_name_prefixed.replace(/^r\//, '');
  }
  return out;
}

function pickSingleItem(data){
  if (!data || typeof data !== 'object') return null;
  if (data.item && typeof data.item === 'object') return data.item;
  if (data.post && typeof data.post === 'object') return data.post;
  if (data.about && typeof data.about === 'object') return data.about;
  if (data.profile && typeof data.profile === 'object') return data.profile;
  if (data.user && typeof data.user === 'object') return data.user;
  if (data.subreddit && typeof data.subreddit === 'object') return data.subreddit;
  // 顶层 reddit listing：第一项即视为单 item
  const arr = pickItemsArray(data);
  if (Array.isArray(arr) && arr[0]) return arr[0];
  return null;
}

function extractGlobalFields(data){
  const out = { summary: '', fields: [] };
  if (!data || typeof data !== 'object') return out;
  const fields = [];
  const seen = new Set();
  const push = (k, v) => {
    if (!k || seen.has(k)) return;
    if (v == null) return;
    if (typeof v === 'object') return;
    seen.add(k);
    fields.push({ k, v: String(v) });
  };
  // 偏好这几个键的稳定顺序
  const ordered = [
    'name', 'subreddit', 'user', 'box', 'feed', 'sort',
    'subscribers', 'active_user_count', 'created_utc',
    'logged_in', 'is_authenticated', 'username',
    'title', 'public_description', 'description',
  ];
  for (const k of ordered) push(k, data[k]);
  // 兜底：再扫一遍其它原子键
  for (const k of Object.keys(data)) push(k, data[k]);
  out.fields = fields.slice(0, 12);
  out.summary = (typeof data.title === 'string' && data.title)
    || (typeof data.public_description === 'string' && data.public_description)
    || (typeof data.description === 'string' && data.description)
    || '';
  return out;
}

function extractPayload(resp, hint, err){
  if (err) {
    return { error: { message: err && err.message ? String(err.message) : String(err), code: err && err.code ? String(err.code) : '' } };
  }
  if (!resp || typeof resp !== 'object') return null;
  const data = (resp.data && typeof resp.data === 'object') ? resp.data : null;
  const kind = (hint && hint.kind) || 'global';
  const toolName = (hint && hint.toolName) || '';

  // navigation 没有标准 data；走 hint.target / resp 字段
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
    const arr = pickItemsArray(data) || [];
    const items = arr.slice(0, 8).map(extractRedditItemFields).filter(Boolean);
    return {
      items,
      totalCount: arr.length,
      sub: data.sub || data.subreddit || '',
      sort: data.sort || '',
      label: (hint && hint.label) || '',
      target: (hint && hint.target) || '',
    };
  }

  if (kind === 'item' && data) {
    const it = pickSingleItem(data);
    const fields = extractRedditItemFields(it);
    if (fields && fields.id) return fields;
    // 兜底：subreddit_about / user_profile 等返回结构化非 listing 数据
    return Object.assign({ id: '' }, extractGlobalFields(data));
  }

  if (kind === 'tree' && data) {
    const arr = pickItemsArray(data) || [];
    const items = arr.slice(0, 24).map(extractRedditItemFields).filter(Boolean);
    const relations = extractTreeRelations(data);
    return {
      items,
      relations,
      label: (hint && hint.label) || '',
    };
  }

  if (kind === 'global') {
    return extractGlobalFields(data || resp);
  }

  if (kind === 'write') {
    return Object.assign({ ok: resp.ok !== false }, extractGlobalFields(data || resp));
  }

  return null;
}

module.exports = {
  getVisualHint,
  buildSummary,
  extractPayload,
  extractRedditItemFields,
  extractGlobalFields,
};
