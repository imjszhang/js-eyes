'use strict';

function idFromUrl(url, pattern) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.pathname.match(pattern) || [])[1] || null;
  } catch (_) {
    return (String(url).match(pattern) || [])[1] || null;
  }
}

function getVisualHint(toolName, args = {}) {
  const answerId = idFromUrl(args.url, /\/answer\/(\d+)/);
  const articleId = idFromUrl(args.url, /\/p\/(\d+)/);
  const questionId = args.questionId || idFromUrl(args.url, /\/question\/(\d+)/);
  if (toolName === 'zhihu_search') {
    return {
      kind: 'list',
      toolName,
      label: `知乎搜索：${args.keyword || ''}`,
      anchor: { keyword: args.keyword || null },
      target: args.keyword ? `关键词：${args.keyword}` : '知乎搜索',
      tone: 'pending',
    };
  }
  if (toolName === 'zhihu_get_question_answers') {
    return {
      kind: 'list',
      toolName,
      label: '读取知乎问题回答',
      anchor: {
        questionId,
      },
      target: questionId ? `问题 ${questionId}` : '知乎问题',
      tone: 'pending',
    };
  }
  if (toolName === 'zhihu_get_answer') {
    return {
      kind: 'item',
      toolName,
      label: '读取知乎回答',
      anchor: {
        url: args.url || null,
        answerId,
      },
      target: answerId ? `回答 ${answerId}` : (args.url || '知乎回答'),
      tone: 'pending',
    };
  }
  if (toolName === 'zhihu_get_article') {
    return {
      kind: 'item',
      toolName,
      label: '读取知乎专栏',
      anchor: {
        url: args.url || null,
        articleId,
      },
      target: articleId ? `专栏 ${articleId}` : (args.url || '知乎专栏'),
      tone: 'pending',
    };
  }
  if (toolName === 'zhihu_get_user' || toolName === 'zhihu_get_user_answers' || toolName === 'zhihu_get_user_articles') {
    return {
      kind: toolName === 'zhihu_get_user' ? 'item' : 'list',
      toolName,
      label: '读取知乎用户',
      anchor: {
        url: args.url || null,
        userSlug: args.userSlug || args.userId || null,
      },
      target: args.userSlug || args.userId || args.url || '知乎用户',
      tone: 'pending',
    };
  }
  return {
    kind: 'global',
    toolName,
    label: toolName,
    anchor: args || null,
    target: toolName,
    tone: 'pending',
  };
}

function buildSummary(resp, hint, err) {
  if (err) return { ok: false, errorCode: err.code || err.message || 'error', detail: err.message || String(err) };
  const ok = !!(resp && resp.ok);
  const data = resp && resp.data;
  const list = data && (data.items || data.answers || data.articles);
  return {
    ok,
    errorCode: ok ? '' : ((resp && resp.error) || 'unknown'),
    detail: ok
      ? (data && (data.title || data.name || data.keyword || hint.label)) || hint.label
      : ((resp && resp.error) || 'unknown'),
    items: Array.isArray(list) ? list.slice(0, 12).map((item) => ({
      id: item.answer_id || item.url || item.title,
      title: item.title || item.excerpt || item.url || '',
      anchor: item.answer_id ? { answerId: item.answer_id } : item.url ? { url: item.url } : null,
    })) : [],
  };
}

function extractPayload(resp) {
  if (!resp || !resp.ok || !resp.data) return null;
  const data = resp.data;
  if (Array.isArray(data.items)) return { items: data.items, totalCount: data.count || data.items.length };
  if (Array.isArray(data.answers)) return { items: data.answers, totalCount: data.count || data.answers.length };
  if (Array.isArray(data.articles)) return { items: data.articles, totalCount: data.count || data.articles.length };
  return {
    title: data.title || data.name || null,
    author: data.author_name || (data.author && data.author.name) || null,
    url: data.source_url || null,
    contentPreview: data.content ? String(data.content).slice(0, 500) : null,
  };
}

module.exports = {
  getVisualHint,
  buildSummary,
  extractPayload,
};
