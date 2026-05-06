function q(selector, root) {
  return (root || document).querySelector(selector);
}

function qa(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

function textOf(node) {
  return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function attrOf(node, name) {
  return node ? (node.getAttribute(name) || '') : '';
}

function absUrl(href) {
  try {
    return href ? new URL(href, location.href).toString() : '';
  } catch (_) {
    return href || '';
  }
}

function parseMetricText(value) {
  const s = String(value || '').replace(/,/g, '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)(万)?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] ? 10000 : 1));
}

function meta(name) {
  return attrOf(q(`meta[itemprop="${name}"], meta[name="${name}"], meta[property="${name}"]`), 'content');
}

function clampLimit(value, defaultValue, maxValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeListOptions(args) {
  return {
    limit: clampLimit(args && args.limit, 10, 100),
    maxPages: clampLimit(args && args.maxPages, 1, 20),
  };
}

function bottomY() {
  const doc = document.documentElement;
  const body = document.body;
  return Math.max(
    doc ? doc.scrollHeight : 0,
    body ? body.scrollHeight : 0,
    doc ? doc.offsetHeight : 0,
    body ? body.offsetHeight : 0,
  );
}

async function scrollAndCollect(options) {
  const limit = options.limit;
  const maxPages = Math.max(1, options.maxPages || 1);
  const snapshot = options.snapshot;
  const keyOf = options.keyOf || ((item) => item && (item.url || item.id || item.title));
  const scrollAnchor = options.scrollAnchor || (() => null);
  const waitMs = options.waitMs || 900;
  const idleRoundsMax = options.idleRoundsMax || 2;
  const seen = new Set();
  const items = [];
  let duplicateSkipped = 0;
  let idleRounds = 0;
  let scrollRounds = 0;
  let endedReason = 'max_rounds';
  let previousBottom = bottomY();

  for (let page = 0; page < maxPages; page++) {
    const beforeCount = items.length;
    const batch = snapshot();
    for (const item of batch) {
      if (!item) continue;
      const key = keyOf(item);
      if (!key) continue;
      if (seen.has(key)) {
        duplicateSkipped++;
        continue;
      }
      seen.add(key);
      items.push(item);
      if (items.length >= limit) {
        endedReason = 'limit';
        break;
      }
    }
    if (items.length >= limit) break;

    const added = items.length - beforeCount;
    idleRounds = added > 0 ? 0 : idleRounds + 1;
    if (idleRounds >= idleRoundsMax) {
      endedReason = 'idle';
      break;
    }
    if (page + 1 >= maxPages) {
      endedReason = 'max_rounds';
      break;
    }

    const anchor = scrollAnchor();
    try {
      if (anchor && typeof anchor.scrollIntoView === 'function') {
        anchor.scrollIntoView({ block: 'end', behavior: 'auto' });
      } else {
        window.scrollTo(0, bottomY());
      }
    } catch (_) {
      window.scrollTo(0, bottomY());
    }
    scrollRounds++;
    await delay(waitMs);

    const nextBottom = bottomY();
    if (nextBottom <= previousBottom && added === 0) {
      endedReason = 'idle';
      break;
    }
    previousBottom = nextBottom;
  }

  const returned = items.slice(0, limit);
  return {
    items: returned,
    pageInfo: {
      requestedLimit: limit,
      requestedMaxPages: maxPages,
      returnedCount: returned.length,
      scrollRounds,
      endedReason,
      duplicateSkipped,
    },
  };
}

function currentPageState() {
  const bodyText = textOf(document.body);
  const hasLoginWall = !!q('.SignFlow, .Modal-wrapper, .Login-content, .MobileModal') && /登录|注册/.test(bodyText);
  const hasCaptcha = /验证码|安全验证|拖动滑块|异常流量/.test(bodyText);
  const hasAnswer = !!q('.ContentItem.AnswerItem, .AnswerItem, .RichContent-inner');
  const hasArticle = !!q('.Post-RichTextContainer, article.Post-Main, .Post-Header');
  const hasQuestion = !!q('.QuestionHeader, .QuestionPage, .Question-main');
  const hasSearch = location.pathname.indexOf('/search') === 0 || !!q('.SearchResult-Card, .SearchMain');
  const hasUser = /^\/(people|org)\//.test(location.pathname) || !!q('.ProfileHeader, .Profile-main');
  return {
    ready: document.readyState === 'complete' || document.readyState === 'interactive',
    url: location.href,
    title: document.title,
    hasLoginWall,
    hasCaptcha,
    hasAnswer,
    hasArticle,
    hasQuestion,
    hasSearch,
    hasUser,
  };
}

function errorIfBlocked() {
  const state = currentPageState();
  if (state.hasCaptcha) return { ok: false, error: 'captcha_required', data: { state } };
  if (state.hasLoginWall) return { ok: false, error: 'login_required', loginUrl: 'https://www.zhihu.com/signin', data: { state } };
  return null;
}

function richText(root) {
  if (!root) return '';
  const clone = root.cloneNode(true);
  qa('script, style, noscript, svg, button', clone).forEach((node) => node.remove());
  qa('br', clone).forEach((node) => node.replaceWith('\n'));
  qa('p, li, h1, h2, h3, blockquote', clone).forEach((node) => {
    if (node.nextSibling) node.after('\n\n');
  });
  return String(clone.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

function extractAuthor(root) {
  const authorRoot = q('.AuthorInfo, .ContentItem-meta, .Post-Author', root) || root || document;
  let name = null;
  const zopNode = root && root.getAttribute && root.getAttribute('data-zop') ? root : q('[data-zop]', root);
  if (zopNode) {
    try {
      const zop = JSON.parse(zopNode.getAttribute('data-zop') || '{}');
      if (zop && zop.authorName) name = zop.authorName;
    } catch (_) {}
  }
  name = name
    || attrOf(q('.AuthorInfo meta[itemprop="name"], .Post-Author meta[itemprop="name"]', authorRoot), 'content')
    || textOf(q('.UserLink-link, .AuthorInfo-name, .AuthorInfo-name a, [itemprop="name"]', authorRoot));
  const url = absUrl(attrOf(q('.UserLink-link, .AuthorInfo-name a, a[href*="/people/"], a[href*="/org/"]', authorRoot), 'href'));
  return { name: name || null, url: url || null };
}

function extractStats(root) {
  const upvoteText = meta('upvoteCount')
    || textOf(q('.VoteButton--up, button[aria-label*="赞同"], button', root));
  const commentText = meta('commentCount')
    || textOf(q('.ContentItem-actions button[aria-label*="评论"], .BottomActions-CommentBtn', root));
  return {
    upvote_count: parseMetricText(upvoteText) != null ? String(parseMetricText(upvoteText)) : (upvoteText || '0'),
    comment_count: parseMetricText(commentText) != null ? String(parseMetricText(commentText)) : (commentText || '0'),
  };
}

function extractAnswer(args) {
  const blocked = errorIfBlocked();
  if (blocked) return blocked;
  const root = q('.ContentItem.AnswerItem, .AnswerItem') || document;
  const contentRoot = q('.RichContent-inner span.RichText[itemprop="text"], .RichContent-inner, .RichText[itemprop="text"]', root);
  const title = meta('name') || textOf(q('.QuestionHeader-title, h1'));
  const author = extractAuthor(root);
  const stats = extractStats(root);
  const answerId = (location.pathname.match(/\/answer\/(\d+)/) || [])[1] || null;
  const questionId = (location.pathname.match(/\/question\/(\d+)/) || [])[1] || null;
  return {
    ok: true,
    data: {
      title: title || '未找到问题标题',
      author_name: author.name || '未找到作者',
      author,
      content: richText(contentRoot) || '未找到回答内容',
      upvote_count: stats.upvote_count || '0',
      comment_count: stats.comment_count || '0',
      answer_id: answerId,
      question_id: questionId,
      source_url: (args && args.url) || location.href,
    },
  };
}

function extractArticle(args) {
  const blocked = errorIfBlocked();
  if (blocked) return blocked;
  const contentRoot = q('.Post-RichTextContainer, .RichText.ztext, article .RichText');
  const title = meta('og:title') || textOf(q('.Post-Title, h1'));
  const author = extractAuthor(document);
  const stats = extractStats(document);
  const articleId = (location.pathname.match(/\/p\/(\d+)/) || [])[1] || null;
  return {
    ok: true,
    data: {
      title: title ? title.replace(/\s+-\s+知乎$/, '') : '未找到文章标题',
      author_name: author.name || '未找到作者',
      author,
      publish_time: textOf(q('.ContentItem-time, .Post-Date, time')) || attrOf(q('meta[property="article:published_time"]'), 'content') || '未找到发布时间',
      content: richText(contentRoot) || '未找到文章内容',
      upvote_count: stats.upvote_count || '0',
      comment_count: stats.comment_count || '0',
      article_id: articleId,
      source_url: (args && args.url) || location.href,
    },
  };
}

async function extractQuestionAnswers(args) {
  const blocked = errorIfBlocked();
  if (blocked) return blocked;
  const opts = normalizeListOptions(args);
  const questionId = (location.pathname.match(/\/question\/(\d+)/) || [])[1] || null;
  const collected = await scrollAndCollect({
    limit: opts.limit,
    maxPages: opts.maxPages,
    scrollAnchor: () => qa('.ContentItem.AnswerItem, .List-item .AnswerItem').pop(),
    snapshot: () => qa('.ContentItem.AnswerItem, .List-item .AnswerItem').map((node) => {
      const author = extractAuthor(node);
      const contentRoot = q('.RichContent-inner, .RichText[itemprop="text"]', node);
      const href = attrOf(q('a[href*="/answer/"]', node), 'href');
      const answerId = (href.match(/\/answer\/(\d+)/) || [])[1] || attrOf(node, 'name') || null;
      const stats = extractStats(node);
      return {
        answer_id: answerId,
        url: absUrl(href),
        author,
        author_name: author.name,
        excerpt: richText(contentRoot).slice(0, 500),
        upvote_count: stats.upvote_count || '0',
        comment_count: stats.comment_count || '0',
      };
    }),
    keyOf: (item) => item.url || item.answer_id || `${item.author_name || ''}:${item.excerpt || ''}`,
  });
  return {
    ok: true,
    data: {
      question_id: questionId,
      title: textOf(q('.QuestionHeader-title, h1')) || meta('name') || document.title,
      description: richText(q('.QuestionRichText, .QuestionHeader-detail')),
      answers: collected.items,
      count: collected.items.length,
      pageInfo: collected.pageInfo,
      source_url: location.href,
    },
  };
}

async function extractSearch(args) {
  const blocked = errorIfBlocked();
  if (blocked) return blocked;
  const opts = normalizeListOptions(args);
  const url = new URL(location.href);
  const keyword = (args && args.keyword) || url.searchParams.get('q') || '';
  const currentKeyword = url.searchParams.get('q') || '';
  const currentType = url.searchParams.get('type') || '';
  if (args && args.keyword && currentKeyword !== args.keyword) {
    const target = new URL('https://www.zhihu.com/search');
    target.searchParams.set('q', args.keyword);
    if (args.type) target.searchParams.set('type', args.type);
    return { ok: false, error: 'dom_navigation_required', to: target.toString(), navMethod: 'navigateSearch', navArgs: args || {} };
  }
  if (args && args.type && currentType !== args.type) {
    const target = new URL('https://www.zhihu.com/search');
    target.searchParams.set('q', args.keyword || currentKeyword);
    target.searchParams.set('type', args.type);
    return { ok: false, error: 'dom_navigation_required', to: target.toString(), navMethod: 'navigateSearch', navArgs: args || {} };
  }
  const collected = await scrollAndCollect({
    limit: opts.limit,
    maxPages: opts.maxPages,
    scrollAnchor: () => qa('.SearchResult-Card, .List-item, .ContentItem').pop(),
    snapshot: () => qa('.SearchResult-Card, .List-item, .ContentItem').map((node) => {
      const link = q('a[href]', node);
      const rawHref = attrOf(link, 'href');
      const item = {
        title: textOf(q('.ContentItem-title, h2, a', node)) || textOf(link),
        url: absUrl(rawHref),
        excerpt: textOf(q('.RichContent-inner, .SearchResult-Card .Highlight, .ContentItem-excerpt', node)).slice(0, 500),
        type: /\/answer\//.test(rawHref) ? 'answer'
          : /zhuanlan\.zhihu\.com\/p\//.test(rawHref) || /\/p\//.test(rawHref) ? 'article'
            : /\/question\//.test(rawHref) ? 'question' : 'unknown',
      };
      return item.title || item.url ? item : null;
    }),
    keyOf: (item) => item.url || item.title,
  });
  return {
    ok: true,
    data: {
      keyword,
      items: collected.items,
      count: collected.items.length,
      pageInfo: collected.pageInfo,
      source_url: location.href,
    },
  };
}

function extractUser(args) {
  const blocked = errorIfBlocked();
  if (blocked) return blocked;
  const header = q('.ProfileHeader, .Profile-main') || document;
  return {
    ok: true,
    data: {
      user_slug: (location.pathname.match(/^\/(?:people|org)\/([^/?#]+)/) || [])[1] || (args && (args.userSlug || args.userId)) || null,
      name: textOf(q('.ProfileHeader-name, .ProfileHeader-title, h1', header)) || document.title.replace(/\s+-\s+知乎$/, ''),
      headline: textOf(q('.ProfileHeader-headline, .ProfileHeader-info, .ProfileHeader-description', header)),
      stats_text: textOf(q('.ProfileHeader-contentFooter, .Profile-mainColumn, .NumberBoard', header)),
      source_url: location.href,
    },
  };
}

async function extractUserList(args, kind) {
  const base = extractUser(args);
  if (!base.ok) return base;
  const opts = normalizeListOptions(args);
  const collected = await scrollAndCollect({
    limit: opts.limit,
    maxPages: opts.maxPages,
    scrollAnchor: () => qa('.List-item .ContentItem, .Profile-mainColumn .ContentItem').pop(),
    snapshot: () => qa('.List-item .ContentItem, .Profile-mainColumn .ContentItem').map((node) => {
      const link = kind === 'answers'
        ? (q('a[href*="/answer/"]', node) || q('a[href*="/question/"]', node))
        : (q('a[href*="zhuanlan.zhihu.com/p/"], a[href*="/p/"]', node) || q('a[href]', node));
      const rawHref = attrOf(link, 'href');
      const item = {
        title: textOf(q('.ContentItem-title, h2, a', node)) || textOf(link),
        url: absUrl(rawHref),
        excerpt: textOf(q('.RichContent-inner, .ContentItem-excerpt', node)).slice(0, 500),
      };
      if (!item.title && !item.url) return null;
      if (kind === 'articles' && !(/zhuanlan\.zhihu\.com\/p\//.test(rawHref) || /\/p\//.test(rawHref))) return null;
      if (kind === 'answers' && !/\/answer\//.test(rawHref)) return null;
      return item;
    }),
    keyOf: (item) => item.url || item.title,
  });
  base.data[kind] = collected.items;
  base.data.count = collected.items.length;
  base.data.pageInfo = collected.pageInfo;
  return base;
}

function sessionState() {
  const cookies = document.cookie.split(';').map((p) => p.trim().split('=')[0]).filter(Boolean);
  const state = currentPageState();
  const name = textOf(q('.AppHeader-profileEntry, .Avatar, .ProfileHeader-name, .UserLink-link'));
  return {
    ok: true,
    data: {
      loggedInLikely: cookies.includes('z_c0') || (!!name && !state.hasLoginWall),
      userName: name || null,
      cookieFlags: {
        hasZC0: cookies.includes('z_c0'),
        hasD_c0: cookies.includes('d_c0'),
        hasQ_c1: cookies.includes('q_c1'),
      },
      state,
    },
  };
}

function navigateTo(url) {
  const from = location.href;
  if (!url || from === url) {
    return { ok: true, data: { noop: true, from: { url: from }, to: { url: url || from } } };
  }
  location.assign(url);
  return { ok: true, data: { from: { url: from }, to: { url } } };
}
