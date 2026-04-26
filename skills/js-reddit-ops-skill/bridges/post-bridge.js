// bridges/post-bridge.js
// ---------------------------------------------------------------------------
// Reddit 单帖详情 bridge。
//
// 暴露 window.__jse_reddit_post__ API：
//   __meta = { version, name }
//   probe() / state() / sessionState()
//   getPost({ url?, sub?, postId?, depth?, limit?, sort? })
//   expandMore({ linkId, children, sort?, depth?, limitChildren? })
//   navigatePost({ url? } | { sub, postId })
//
// 数据获取以 reddit 公开 JSON 端点为主路径：
//   - getPost:    /r/<sub>/comments/<id>.json?raw_json=1&depth=...&limit=...&sort=...
//   - expandMore: /api/morechildren?api_type=json&link_id=t3_xxx&children=a,b,c&sort=...
// 都通过 fetchRedditJson(credentials: 'include') 复用浏览器同源 cookie。
//
// 修改任意方法后请 bump VERSION，下次 session.ensureBridge 自动重装。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.4.1';

  // @@include ./common.js

  const DEFAULT_DEPTH = 8;
  const MAX_DEPTH = 20;
  const DEFAULT_COMMENT_LIMIT = 500;
  const MAX_COMMENT_LIMIT = 1000;
  const ALLOWED_SORTS = new Set(['top', 'best', 'new', 'old', 'controversial', 'qa', 'confidence']);
  const DEFAULT_EXPAND_LIMIT = 200;
  const MAX_EXPAND_LIMIT = 500;

  async function probe(){
    const url = location.href;
    const meta = parsePostUrl(url);
    const frontend = detectFrontend();
    let me = { loggedIn: false, name: null, source: 'api' };
    try { me = await readMeViaApi(false); } catch (_) {}
    const dom = readLoginStateDom();
    return okResult({
      url,
      frontend,
      login: { api: me, dom, loggedIn: !!(me.loggedIn || dom.loggedIn) },
      post: meta,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'post-bridge' },
    });
  }

  async function state(){
    const url = location.href;
    const meta = parsePostUrl(url);
    const frontend = detectFrontend();
    const ready = !!(meta.postId);
    return okResult({
      ready,
      reason: ready ? null : 'not_on_post_page',
      url,
      frontend,
      post: meta,
      bridgeVersion: VERSION,
    });
  }

  async function getPost(args){
    args = args || {};
    const explicitUrl = typeof args.url === 'string' && args.url ? args.url : null;
    const here = parsePostUrl(location.href);
    const fromUrl = explicitUrl ? parsePostUrl(explicitUrl) : { sub: null, postId: null };
    const sub = (args.sub && String(args.sub)) || fromUrl.sub || here.sub;
    const postId = (args.postId && String(args.postId)) || fromUrl.postId || here.postId;
    const sourceUrl = explicitUrl || location.href;

    if (!postId) {
      return errResult('invalid_post_url', { url: sourceUrl, sub, postId });
    }

    const depth = clampLimit(args.depth, DEFAULT_DEPTH, MAX_DEPTH);
    const limit = clampLimit(args.limit, DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
    const rawSort = args.sort && /^[a-z]+$/i.test(args.sort) ? String(args.sort).toLowerCase() : 'top';
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'top';

    const path = sub
      ? '/r/' + sub + '/comments/' + postId + '.json'
      : '/comments/' + postId + '.json';
    const params = { limit, depth, sort };

    const t0 = Date.now();
    const resp = await fetchRedditJson(path, params, { textLimit: 4096 });
    const fetchDurationMs = Date.now() - t0;

    if (!resp.ok || !Array.isArray(resp.data)) {
      const body = resp.data && resp.data.text
        ? { text: resp.data.text, truncated: !!resp.data.truncated, length: resp.data.length || null }
        : null;
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        url: resp.url || null,
        body,
        message: resp.message || null,
      });
    }

    const postListing = resp.data[0];
    const commentListing = resp.data[1];
    const postChild = postListing && postListing.data && Array.isArray(postListing.data.children)
      ? postListing.data.children[0]
      : null;
    const post = (postChild && postChild.data) ? postChild.data : {};
    const commentsRaw = commentListing && commentListing.data && Array.isArray(commentListing.data.children)
      ? commentListing.data.children
      : [];

    const subredditName = (typeof post.subreddit === 'string' && post.subreddit) || sub || '';
    const subredditUrl = subredditName ? ('https://www.reddit.com/r/' + subredditName) : '';
    const comments = buildCommentTree(commentsRaw, 0);
    const totalParsed = countCommentsInTree(comments);

    const data = {
      title: typeof post.title === 'string' ? post.title : '',
      content: typeof post.selftext === 'string' ? post.selftext : '',
      author_name: typeof post.author === 'string' ? post.author : '',
      author_id: typeof post.author_fullname === 'string' && post.author_fullname
        ? post.author_fullname
        : (typeof post.author === 'string' ? post.author : ''),
      publish_time: unixToIso(post.created_utc),
      upvote_count: String(typeof post.score === 'number' ? post.score : (post.score == null ? 0 : post.score)),
      comment_count: String(
        typeof post.num_comments === 'number' ? post.num_comments
          : (post.num_comments == null ? 0 : post.num_comments)
      ),
      subreddit_name: subredditName,
      subreddit_url: subredditUrl,
      image_urls: pickImageUrlsFromPost(post),
      comments,
      source_url: sourceUrl,
    };

    return okResult({
      data,
      meta: {
        bridge: 'post-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        sort,
        depth,
        limit,
        topLevel: comments.length,
        totalParsedComments: totalParsed,
        declaredCommentCount: typeof post.num_comments === 'number' ? post.num_comments : null,
        frontend: detectFrontend(),
        postId,
        subreddit: subredditName,
      },
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function expandMore(args){
    args = args || {};
    const linkId = typeof args.linkId === 'string' ? args.linkId.trim() : '';
    if (!/^t3_[a-z0-9]+$/i.test(linkId)) {
      return errResult('invalid_link_id', { hint: 'linkId 必须形如 t3_xxxxx' });
    }
    let children = args.children;
    if (typeof children === 'string') children = children.split(/[,\s]+/);
    if (!Array.isArray(children) || children.length === 0) {
      return errResult('missing_children', {
        hint: 'children 是 reddit_get_post 评论树里 _kind=more 节点的 _children 字段',
      });
    }
    const stripped = [];
    for (const c of children) {
      const v = String(c == null ? '' : c).replace(/^t1_/i, '').trim();
      if (/^[a-z0-9]+$/i.test(v)) stripped.push(v);
    }
    if (stripped.length === 0) return errResult('no_valid_children');

    const limit = clampLimit(args.limitChildren, DEFAULT_EXPAND_LIMIT, MAX_EXPAND_LIMIT);
    const submitted = stripped.slice(0, limit);
    const sortRaw = typeof args.sort === 'string' ? args.sort.toLowerCase() : 'top';
    const sort = ALLOWED_SORTS.has(sortRaw) ? sortRaw : 'top';
    const depth = args.depth != null ? clampLimit(args.depth, MAX_DEPTH, MAX_DEPTH) : null;

    const params = {
      api_type: 'json',
      link_id: linkId,
      children: submitted.join(','),
      sort,
      raw_json: 1,
    };
    if (depth != null) params.depth = depth;

    const t0 = Date.now();
    const resp = await fetchRedditJson('/api/morechildren', params, { textLimit: 4096 });
    const fetchDurationMs = Date.now() - t0;

    if (!resp.ok || !resp.data || resp.data._nonJson) {
      const body = resp.data && resp.data.text
        ? { text: resp.data.text, truncated: !!resp.data.truncated }
        : null;
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        endpoint: resp.url || null,
        body,
      });
    }

    const json = resp.data && resp.data.json;
    const errors = (json && Array.isArray(json.errors)) ? json.errors : [];
    if (errors.length > 0) {
      return errResult('api_error', {
        errors,
        httpStatus: resp.httpStatus || null,
        endpoint: resp.url || null,
      });
    }

    const things = (json && json.data && Array.isArray(json.data.things)) ? json.data.things : [];
    const items = [];
    const moreItems = [];
    const byParent = {};

    for (const thing of things) {
      if (!thing || typeof thing !== 'object') continue;
      if (thing.kind === 't1') {
        const c = thing.data || {};
        const item = {
          author_name: typeof c.author === 'string' ? c.author : '',
          comment_id: c.name || (c.id ? 't1_' + c.id : ''),
          content: typeof c.body === 'string' ? c.body : '',
          score: String(typeof c.score === 'number' ? c.score : (c.score == null ? 0 : c.score)),
          depth: typeof c.depth === 'number' ? c.depth : null,
          parent_id: typeof c.parent_id === 'string' ? c.parent_id : '',
          permalink: typeof c.permalink === 'string' && c.permalink
            ? ('https://www.reddit.com' + c.permalink)
            : '',
          time: unixToIso(c.created_utc),
        };
        items.push(item);
        const p = item.parent_id;
        if (p) {
          if (!byParent[p]) byParent[p] = [];
          byParent[p].push(item);
        }
      } else if (thing.kind === 'more') {
        const c = thing.data || {};
        const moreNode = {
          comment_id: c.name || (c.id ? 'more_' + c.id : ''),
          parent_id: typeof c.parent_id === 'string' ? c.parent_id : '',
          depth: typeof c.depth === 'number' ? c.depth : null,
          _kind: 'more',
          _children: Array.isArray(c.children) ? c.children.slice(0, 1000) : [],
          _count: typeof c.count === 'number' ? c.count : 0,
        };
        moreItems.push(moreNode);
        const p = moreNode.parent_id;
        if (p) {
          if (!byParent[p]) byParent[p] = [];
          byParent[p].push(moreNode);
        }
      }
    }

    return okResult({
      linkId,
      sort,
      depth,
      requestedChildrenCount: stripped.length,
      submittedChildrenCount: submitted.length,
      returnedCommentCount: items.length,
      returnedMoreCount: moreItems.length,
      items,
      moreItems,
      byParent,
      meta: {
        bridge: 'post-bridge',
        version: VERSION,
        endpoint: resp.url || null,
        httpStatus: resp.httpStatus || null,
        fetchDurationMs,
      },
    });
  }

  function navigatePost(args){
    args = args || {};
    let url = typeof args.url === 'string' && args.url ? args.url : null;
    if (!url) {
      const sub = args.sub && String(args.sub).replace(/^\/?r\//i, '').replace(/^\/+|\/+$/g, '');
      const postId = args.postId && String(args.postId).replace(/^t3_/i, '');
      if (postId) {
        url = sub
          ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(postId)}/`
          : `https://www.reddit.com/comments/${encodeURIComponent(postId)}/`;
      }
    }
    if (!url) return errResult('missing_target_url', { hint: '提供 url 或 (sub + postId)' });
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'post-bridge' },
    probe,
    state,
    sessionState,
    getPost,
    expandMore,
    navigatePost,
  };
  window.__jse_reddit_post__ = api;
  return { ok: true, version: VERSION, name: 'post-bridge' };
})();
