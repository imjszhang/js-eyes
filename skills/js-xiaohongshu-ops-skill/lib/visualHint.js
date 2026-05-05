'use strict';

// 小红书工具 → visual hint（供 @js-eyes/visual-bridge-kit wrapCallApi）。
// hint.kind 决定 HUD 文案 / flash 元素的策略：
//   - 'global'      整页范围（登录态、导航后状态）
//   - 'item'        单个对象（笔记、用户主页）
//   - 'list'        列表（搜索结果、用户笔记、评论）
//   - 'navigation'  纯路由（不抓数据，只切 URL）

const HINTS = {
  xhs_session_state: {
    kind: 'global',
    label: '小红书登录态',
  },
  xhs_get_note: {
    kind: 'item',
    label: ({ args }) => `笔记 · ${truncateUrl((args && args.url) || '')}`,
    anchor: ({ args }) => parseNoteAnchor(args && args.url),
    target: ({ args }) => ((args && args.url) || ''),
  },
  xhs_get_note_comments: {
    kind: 'list',
    label: ({ args }) => `评论 · ${truncateUrl((args && args.url) || '')}`,
    anchor: ({ args }) => parseNoteAnchor(args && args.url),
    target: ({ args }) => ((args && args.url) || ''),
  },
  xhs_search_notes: {
    kind: 'list',
    label: ({ args }) => `搜索 "${String((args && args.keyword) || '').slice(0, 32)}"`,
    target: ({ args }) => ((args && args.keyword) || ''),
  },
  xhs_get_user: {
    kind: 'item',
    label: ({ args }) => `用户 · ${(args && args.userId) || '?'}`,
    anchor: ({ args }) => ((args && args.userId) ? { userId: args.userId } : null),
    target: ({ args }) => ((args && args.userId) || ''),
  },
  xhs_get_user_notes: {
    kind: 'list',
    label: ({ args }) => `${(args && args.userId) || '?'} 笔记列表`,
    anchor: ({ args }) => ((args && args.userId) ? { userId: args.userId } : null),
    target: ({ args }) => ((args && args.userId) || ''),
  },
  xhs_navigate_note: {
    kind: 'navigation',
    label: '导航笔记',
    target: ({ args }) => ((args && args.url) || ''),
  },
  xhs_navigate_search: {
    kind: 'navigation',
    label: ({ args }) => `导航搜索 "${String((args && args.keyword) || '').slice(0, 32)}"`,
    target: ({ args }) => ((args && args.keyword) || ''),
  },
  xhs_navigate_user: {
    kind: 'navigation',
    label: ({ args }) => `导航用户 ${(args && args.userId) || '?'}`,
    target: ({ args }) => ((args && args.userId) || ''),
  },
  xhs_navigate_home: {
    kind: 'navigation',
    label: '导航首页',
    target: '',
  },
};

function truncateUrl(u) {
  if (typeof u !== 'string') return '';
  return u.length > 64 ? u.slice(0, 61) + '…' : u;
}

function parseNoteAnchor(url) {
  if (typeof url !== 'string' || !url) return null;
  // /explore/<noteId> 或 /discovery/item/<noteId> 或 /user/profile/<uid>/<noteId>
  const m = /\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]{16,32})/i.exec(url);
  if (m) return { noteId: m[1] };
  return null;
}

function evalField(value, ctx) {
  if (typeof value === 'function') {
    try { return value(ctx); } catch (_) { return ''; }
  }
  return value == null ? '' : value;
}

function getVisualHint(toolName, args) {
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

// ---------------------------------------------------------------------------
// 卡片提取：把 result.data 的 notes/comments/note 映射成 anchorId 命名空间统一的卡片。
// 命名空间约定：'note:<noteId>' / 'user:<userId>' / 'comment:<commentId>'
// ---------------------------------------------------------------------------

function pickNoteArray(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.notes)) return data.notes;
  if (Array.isArray(data.items)) return data.items;
  return null;
}

function pickCommentArray(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.comments)) return data.comments;
  return null;
}

function extractNoteCard(n) {
  if (!n || typeof n !== 'object') return null;
  const noteId = n.noteId || n.id || '';
  const text = (n.title || n.desc || '').toString();
  return {
    id: noteId ? ('note:' + noteId) : '',
    noteId: String(noteId || ''),
    text: text.length > 280 ? text.slice(0, 277) + '…' : text,
    author: (n.user && (n.user.nickname || n.user.userId)) || n.author || '',
    likes: n.stats && (n.stats.likes ?? n.stats.likeCount),
    comments: n.stats && (n.stats.comments ?? n.stats.commentCount),
  };
}

function extractCommentCard(c) {
  if (!c || typeof c !== 'object') return null;
  const cid = c.id || c.commentId || '';
  const text = (c.content || '').toString();
  return {
    id: cid ? ('comment:' + cid) : '',
    commentId: String(cid || ''),
    text: text.length > 200 ? text.slice(0, 197) + '…' : text,
    user: (c.user && (c.user.nickname || c.user.userId)) || '',
    likes: c.likeCount ?? c.likes ?? 0,
  };
}

function extractNoteAnchors(data) {
  const arr = pickNoteArray(data);
  const out = [];
  if (!arr) return out;
  for (const n of arr) {
    if (!n) continue;
    const id = n.noteId || n.id;
    if (id != null) out.push({ noteId: String(id) });
    if (out.length >= 8) break;
  }
  return out;
}

function buildSummary(resp, hint) {
  if (!resp || typeof resp !== 'object') {
    return { ok: false, items: [], relate: [], errorCode: 'no_response', detail: '', target: '' };
  }
  if (resp.ok === false) {
    return {
      ok: false,
      items: [],
      relate: [],
      errorCode: (resp.error && (resp.error.code || resp.error)) || resp.error || 'unknown',
      detail: (resp.error && resp.error.message) || resp.message || '',
      target: '',
    };
  }
  // runTool 顶层包了一层；result 通常在 resp.result 而非 resp.data
  const data = (resp.result && typeof resp.result === 'object')
    ? resp.result
    : (resp.data && typeof resp.data === 'object' ? resp.data : null);
  const kind = (hint && hint.kind) || 'global';

  if (kind === 'list' && data) {
    const noteAnchors = extractNoteAnchors(data);
    const items = noteAnchors.length ? noteAnchors
      : (pickCommentArray(data) || []).slice(0, 8).map((c) => ({ commentId: String(c.id || c.commentId || '') })).filter((x) => x.commentId);
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
    const note = data.note && typeof data.note === 'object' ? data.note : data;
    const id = note && (note.noteId || note.id);
    const items = id ? [{ noteId: String(id) }] : [];
    return { ok: true, items, relate: [], errorCode: '', detail: '', target: '' };
  }
  return { ok: true, items: [], relate: [], errorCode: '', detail: '', target: '' };
}

function extractPayload(resp, hint, err) {
  if (err) {
    return {
      error: {
        message: err && err.message ? String(err.message) : String(err),
        code: err && err.code ? String(err.code) : '',
      },
    };
  }
  if (!resp || typeof resp !== 'object') return null;
  const data = (resp.result && typeof resp.result === 'object')
    ? resp.result
    : (resp.data && typeof resp.data === 'object' ? resp.data : null);
  const kind = (hint && hint.kind) || 'global';

  if (kind === 'navigation') {
    const to = (resp && (resp.url || resp.to)) || (data && (data.url || data.to)) || (hint && hint.target) || '';
    return {
      from: '',
      to: typeof to === 'string' ? to : '',
      hint: 'page_will_reload',
      label: (hint && hint.label) || '',
    };
  }

  if (kind === 'list' && data) {
    const noteArr = pickNoteArray(data);
    if (noteArr) {
      const items = noteArr.slice(0, 12).map(extractNoteCard).filter(Boolean);
      return {
        items,
        totalCount: noteArr.length,
        keyword: data.keyword || (hint && hint.target) || '',
        userId: data.userId || '',
        label: (hint && hint.label) || '',
        target: (hint && hint.target) || '',
      };
    }
    const commentArr = pickCommentArray(data);
    if (commentArr) {
      const items = commentArr.slice(0, 12).map(extractCommentCard).filter(Boolean);
      return {
        items,
        totalCount: data.totalCount || commentArr.length,
        label: (hint && hint.label) || '',
        target: (hint && hint.target) || '',
      };
    }
    return null;
  }

  if (kind === 'item' && data) {
    const note = data.note && typeof data.note === 'object' ? data.note : data;
    const card = extractNoteCard(note);
    return card || { noteId: '', text: '' };
  }

  if (kind === 'global') {
    const d = data || resp;
    const fields = [];
    if (d && typeof d === 'object') {
      for (const k of ['loggedIn', 'userId', 'username', 'nickname']) {
        if (d[k] != null) fields.push({ k, v: String(d[k]) });
      }
      if (d.cookieFlags) fields.push({ k: 'web_session', v: d.cookieFlags.hasWebSession ? 'yes' : 'no' });
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
