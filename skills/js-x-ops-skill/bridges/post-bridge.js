// bridges/post-bridge.js
// ---------------------------------------------------------------------------
// X.com 推文详情 bridge（READ-only，不含发帖逻辑——发帖留在 v3.1）。
//
// 暴露 window.__jse_x_post__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigatePost({ url } | { tweetId, username })
//   getPost({ tweetId, withThread?, withReplies? })
//
// 主路径走 GraphQL TweetDetail；fallback 是 TweetResultByRestId。
// 遇到 429 连续 3 次暂停 5 分钟。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.8.1';

  // @@include ./common.js

  const PAUSE_AFTER_429_MS = 5 * 60 * 1000;
  const REPLY_PAGE_DELAY_MS = 1500;
  const MAX_REPLY_PAGES = 10;
  // v3.0.4：单次 getPost 总耗时预算；超过则返回 partial + meta.timedOut。
  const DEFAULT_BUDGET_MS = 60 * 1000;
  // v3.0.4：fetchXGraphQL 单次调用 timeout（默认 15s 对老 thread 不够）。
  const FETCH_TIMEOUT_MS = 25 * 1000;

  function parsePostFromPath(){
    const m = /^\/([\w_]+)\/status\/(\d+)/.exec(location.pathname || '');
    if (!m) return { username: null, tweetId: null };
    return { username: m[1], tweetId: m[2] };
  }

  function parseArticleFromPath(){
    return parseArticleFromPathname(location.pathname || '');
  }

  function resolvePostInput(args){
    args = args || {};
    if (args.contentKind === 'article' && args.articleId) {
      return { kind: 'article', articleId: String(args.articleId) };
    }
    if (args.contentKind === 'tweet' && args.tweetId) {
      return { kind: 'tweet', tweetId: String(args.tweetId) };
    }
    const input = args.url != null ? args.url : (args.articleId != null ? args.articleId : args.tweetId);
    const fromInput = classifyPostInputUrl(input);
    if (fromInput.kind !== 'unknown') return fromInput;
    const fromPathArt = parseArticleFromPath();
    if (fromPathArt.articleId) {
      return { kind: 'article', articleId: fromPathArt.articleId };
    }
    const fromPathPost = parsePostFromPath();
    if (fromPathPost.tweetId) {
      return { kind: 'tweet', tweetId: fromPathPost.tweetId };
    }
    return { kind: 'unknown' };
  }

  function extractTweetId(input){
    if (input == null) return null;
    const s = String(input).trim();
    if (/^\d{6,}$/.test(s)) return s;
    const m = /\/status\/(\d+)/.exec(s);
    return m ? m[1] : null;
  }

  async function probe(){
    const { username, tweetId } = parsePostFromPath();
    const { articleId } = parseArticleFromPath();
    const sessionResp = await sessionStateCommon();
    const dParams = await discoverGraphQLParams(['TweetDetail', 'TweetResultByRestId']);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      username,
      tweetId,
      articleId,
      login: sessionResp && sessionResp.data ? sessionResp.data : null,
      graphql: dParams.data,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'post-bridge' },
    });
  }

  async function state(){
    const { username, tweetId } = parsePostFromPath();
    const { articleId } = parseArticleFromPath();
    const ready = !!tweetId || !!articleId;
    return okResult({
      ready,
      reason: ready ? null : 'not_on_post_or_article_path',
      url: location.href,
      username,
      tweetId,
      articleId,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function dom_getPost(args){
    args = args || {};
    const tweetIdInput = args.tweetId != null ? args.tweetId : (args.url || null);
    const tweetId = extractTweetId(tweetIdInput);
    if (!tweetId) return errResult('missing_tweetId');
    const parsed = parsePostFromPath();
    const pathId = parsed && parsed.tweetId;
    if (!pathId || String(pathId) !== String(tweetId)) {
      const username = args.username && String(args.username).replace(/^@/, '');
      const url = 'https://x.com/' + (username || 'i') + '/status/' + tweetId;
      return {
        ok: false,
        error: 'dom_navigation_required',
        to: url,
        navMethod: 'navigatePost',
        navArgs: { tweetId, username: username || undefined, url },
      };
    }
    const main = document.querySelector('article[data-testid="tweet"]');
    if (!main) return errResult('dom_extract_failed', { hint: 'no_tweet_article' });
    const tw = parseTweetArticle(main);
    if (!tw) return errResult('dom_extract_failed', { hint: 'parse_failed' });
    return okResult({
      tweetId,
      tweet: tw,
      thread: [],
      replies: [],
      replyCursor: null,
      meta: { bridge: 'post-bridge', version: VERSION, path: 'dom_getPost', note: 'dom_only_no_thread' },
    });
  }

  function navigatePost(args){
    args = args || {};
    let url = null;
    if (typeof args.url === 'string' && args.url) {
      url = args.url;
    } else if (args.contentKind === 'article' && args.articleId) {
      url = 'https://x.com/i/article/' + String(args.articleId);
    } else {
      const username = args.username && String(args.username).replace(/^@/, '');
      const tweetId = extractTweetId(args.tweetId);
      if (!tweetId) return errResult('missing_tweetId_or_url');
      url = 'https://x.com/' + (username || 'i') + '/status/' + tweetId;
    }
    return navigateLocation(url);
  }

  async function dom_getArticle(args){
    args = args || {};
    const resolved = resolvePostInput(args);
    const parsed = parseArticleFromPath();
    const articleId = args.articleId
      || (resolved.kind === 'article' ? resolved.articleId : null)
      || parsed.articleId;
    if (!articleId) return errResult('missing_articleId');
    if (!parsed.articleId || String(parsed.articleId) !== String(articleId)) {
      const url = 'https://x.com/i/article/' + articleId;
      return {
        ok: false,
        error: 'dom_navigation_required',
        to: url,
        navMethod: 'navigatePost',
        navArgs: { url, contentKind: 'article', articleId: String(articleId) },
      };
    }
    const article = parseArticlePageDom();
    if (!article || !(article.content || article.title)) {
      return errResult('dom_extract_failed', { hint: 'no_article_body' });
    }
    return okResult({
      contentKind: 'article',
      articleId: String(articleId),
      article,
      meta: {
        bridge: 'post-bridge',
        version: VERSION,
        path: 'dom_getArticle',
      },
    });
  }

  async function api_getArticle(args){
    return dom_getArticle(args);
  }

  async function getArticle(args){
    const dom = await dom_getArticle(args);
    if (dom.ok) return dom;
    return dom;
  }

  function _buildArticleFromTweetGraphQL(tweet){
    if (!tweet || !tweet.linkedArticle || !tweet.linkedArticle.articleId) return null;
    const la = tweet.linkedArticle;
    const ac = tweet.articleContent;
    const content = (ac && ac.contentMarkdown) || tweet.articlePlainText || tweet.content || '';
    if (!content.trim()) return null;
    return {
      articleId: String(la.articleId),
      title: la.title || (ac && ac.title) || '',
      content,
      contentMarkdown: (ac && ac.contentMarkdown) || '',
      plainText: (ac && ac.plainText) || tweet.articlePlainText || '',
      coverUrl: (ac && ac.coverUrl) || la.coverUrl || '',
      mediaUrls: (ac && ac.mediaUrls) || [],
      mediaDetails: (ac && ac.mediaDetails) || [],
      articleUrl: la.articleUrl || ('https://x.com/i/article/' + la.articleId),
      author: tweet.author || { name: '', username: '', avatarUrl: '' },
      publishTime: tweet.publishTime || '',
      source: (ac && ac.source) || 'graphql_content_state',
    };
  }

  function _shouldAutoFetchArticleFromTweet(tweet){
    if (!tweet || !tweet.linkedArticle || !tweet.linkedArticle.articleId) return false;
    if (isArticleGraphQLComplete(tweet.articleContent)) return false;
    const ac = tweet.articleContent;
    if (ac && ac.expectedInlineMedia && ac.inlineMediaComplete === false) return true;
    if (ac && ac.expectedInlineMedia && !(ac.mediaDetails && ac.mediaDetails.length)) return true;
    if (ac && ac.coverUrl) return false;
    if (tweet.articlePlainText && tweet.articlePlainText.length > 200) {
      return !(ac && ac.parsedFromContentState);
    }
    const content = String(tweet.content || '');
    if (content.length > 280 && !/t\.co\//i.test(content)) return false;
    return true;
  }

  async function _maybeUpgradeTweetToArticle(tweetResult, args){
    if (!tweetResult || !tweetResult.ok || !tweetResult.tweet) return tweetResult;
    const tweet = tweetResult.tweet;
    if (!tweet.linkedArticle || !tweet.linkedArticle.articleId) return tweetResult;

    const gqlArticle = _buildArticleFromTweetGraphQL(tweet);
    if (gqlArticle && isArticleGraphQLComplete(tweet.articleContent)) {
      return okResult({
        contentKind: 'article',
        articleId: gqlArticle.articleId,
        article: gqlArticle,
        seedTweet: tweet,
        tweet: null,
        thread: [],
        replies: [],
        replyCursor: null,
        meta: Object.assign({}, tweetResult.meta || {}, {
          autoResolvedFromTweet: true,
          seedTweetId: tweet.tweetId || null,
          path: 'graphql_content_state',
        }),
      });
    }

    if (!_shouldAutoFetchArticleFromTweet(tweet)) {
      if (gqlArticle && gqlArticle.content) {
        return okResult({
          contentKind: 'article',
          articleId: gqlArticle.articleId,
          article: gqlArticle,
          seedTweet: tweet,
          tweet: null,
          thread: [],
          replies: [],
          replyCursor: null,
          meta: Object.assign({}, tweetResult.meta || {}, {
            autoResolvedFromTweet: true,
            seedTweetId: tweet.tweetId || null,
            path: 'graphql_partial',
            note: 'dom_skipped_incomplete_media',
          }),
        });
      }
      return tweetResult;
    }

    const la = tweet.linkedArticle;
    const art = await getArticle(Object.assign({}, args, {
      contentKind: 'article',
      articleId: la.articleId,
    }));
    if (!art.ok || !art.article) {
      if (gqlArticle && gqlArticle.content) {
        return okResult({
          contentKind: 'article',
          articleId: gqlArticle.articleId,
          article: gqlArticle,
          seedTweet: tweet,
          tweet: null,
          thread: [],
          replies: [],
          replyCursor: null,
          meta: Object.assign({}, tweetResult.meta || {}, {
            autoResolvedFromTweet: true,
            seedTweetId: tweet.tweetId || null,
            path: 'graphql_fallback_dom_failed',
          }),
        });
      }
      return tweetResult;
    }
    const merged = Object.assign({}, gqlArticle || {}, art.article, {
      content: (gqlArticle && gqlArticle.contentMarkdown) || art.article.content || '',
      contentMarkdown: (gqlArticle && gqlArticle.contentMarkdown) || '',
      mediaDetails: [].concat((gqlArticle && gqlArticle.mediaDetails) || [], art.article.mediaDetails || []),
      mediaUrls: Array.from(new Set([].concat(
        (gqlArticle && gqlArticle.mediaUrls) || [],
        art.article.mediaUrls || [],
      ))),
      coverUrl: art.article.coverUrl || (gqlArticle && gqlArticle.coverUrl) || '',
      source: (gqlArticle && gqlArticle.mediaDetails && gqlArticle.mediaDetails.length)
        ? 'graphql_content_state+dom'
        : (art.article.source || 'dom_article_page'),
    });
    return okResult({
      contentKind: 'article',
      articleId: String(la.articleId),
      article: merged,
      seedTweet: tweet,
      tweet: null,
      thread: [],
      replies: [],
      replyCursor: null,
      meta: Object.assign({}, art.meta || {}, tweetResult.meta || {}, {
        autoResolvedFromTweet: true,
        seedTweetId: tweet.tweetId || null,
      }),
    });
  }

  function _parseTweetDetail(json, focalTweetId){
    const focal = { focalTweet: null, threadTweets: [], replies: [], replyCursor: null };
    try {
      const ins = (json && json.data && json.data.threaded_conversation_with_injections_v2
        && json.data.threaded_conversation_with_injections_v2.instructions) || [];
      let allEntries = [];
      for (const inst of ins) {
        if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
          allEntries = allEntries.concat(inst.entries);
        }
      }
      const tweetEntries = [];
      for (const entry of allEntries) {
        const entryId = entry.entryId || '';
        if (entryId.startsWith('cursor-bottom-')) {
          focal.replyCursor = (entry.content && entry.content.itemContent && entry.content.itemContent.value)
            || (entry.content && entry.content.value) || null;
          continue;
        }
        if (entryId.startsWith('conversationthread-')) {
          const items = (entry.content && entry.content.items) || [];
          for (const it of items) {
            const r = it.item && it.item.itemContent && it.item.itemContent.tweet_results && it.item.itemContent.tweet_results.result;
            const parsed = r ? parseSingleTweetResult(r) : null;
            if (parsed) focal.replies.push(parsed);
          }
          continue;
        }
        if (!entryId.startsWith('tweet-')) continue;
        const result = entry.content && entry.content.itemContent && entry.content.itemContent.tweet_results && entry.content.itemContent.tweet_results.result;
        const parsed = result ? parseSingleTweetResult(result) : null;
        if (!parsed) continue;
        tweetEntries.push({ entryId, parsed });
      }
      const focalIdx = focalTweetId
        ? tweetEntries.findIndex((e) => e.entryId === 'tweet-' + focalTweetId
            || (e.parsed && String(e.parsed.tweetId) === String(focalTweetId)))
        : -1;
      if (focalIdx >= 0) {
        focal.focalTweet = tweetEntries[focalIdx].parsed;
        for (let i = 0; i < tweetEntries.length; i++) {
          if (i === focalIdx) continue;
          focal.threadTweets.push(tweetEntries[i].parsed);
        }
      } else if (tweetEntries.length) {
        focal.focalTweet = tweetEntries[0].parsed;
        for (let i = 1; i < tweetEntries.length; i++) {
          focal.threadTweets.push(tweetEntries[i].parsed);
        }
      }
    } catch (_) {}
    return focal;
  }

  async function api_getPost(args){
    args = args || {};
    const tweetIdInput = args.tweetId != null ? args.tweetId : (args.url || null);
    const tweetId = extractTweetId(tweetIdInput);
    if (!tweetId) return errResult('missing_tweetId');
    const withThread = !!args.withThread;
    const withReplies = !!args.withReplies;
    // v3.0.4：浏览器侧 wall-clock 预算（缺省 60s）。超过预算后停止新请求，
    // 把当前已收集的数据带 meta.timedOut/partial 返回。
    const budgetMs = Number.isFinite(args.budgetMs) && args.budgetMs > 0
      ? Math.min(args.budgetMs, 5 * 60 * 1000)
      : DEFAULT_BUDGET_MS;
    const t0Total = Date.now();
    const budgetExpired = () => (Date.now() - t0Total) > budgetMs;

    let disc = await discoverGraphQLParams(['TweetDetail', 'TweetResultByRestId']);
    let detailMeta = disc.data && disc.data.TweetDetail;
    let restMeta = disc.data && disc.data.TweetResultByRestId;
    if ((!detailMeta || !detailMeta.queryId) && (!restMeta || !restMeta.queryId)) {
      return errResult('graphql_discover_failed', { opNames: ['TweetDetail', 'TweetResultByRestId'] });
    }

    let pausedOnce = false;
    let consecutive429 = 0;
    let detailCacheInvalidated = false;
    let restCacheInvalidated = false;
    let collectedReplyPages = 0;
    let timedOut = false;

    if (detailMeta && detailMeta.queryId) {
      const variables = {
        focalTweetId: tweetId,
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: false,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withV2Timeline: true,
      };
      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: true,
        withGrokAnalyze: false,
        withDisallowedReplyControls: false,
      };

      let resp = null;
      while (true) {
        if (budgetExpired()) { timedOut = true; break; }
        resp = await fetchXGraphQL({
          opName: 'TweetDetail',
          queryId: detailMeta.queryId,
          variables,
          features: detailMeta.features || DEFAULT_GRAPHQL_FEATURES,
          fieldToggles,
          timeoutMs: FETCH_TIMEOUT_MS,
        });
        if (resp.ok) break;
        if (resp.statusCode === 429) {
          consecutive429++;
          if (consecutive429 >= 3 && !pausedOnce) {
            pausedOnce = true;
            await delay(PAUSE_AFTER_429_MS);
            consecutive429 = 0;
            continue;
          }
          await delay(Math.min(((resp.retryAfter || 30) * 1000), 60 * 1000));
          continue;
        }
        if ((resp.statusCode === 400 || resp.statusCode === 404) && !detailCacheInvalidated) {
          detailCacheInvalidated = true;
          invalidateGraphQLCache('TweetDetail');
          const reDisc = await discoverGraphQLParams(['TweetDetail']);
          const newMeta = reDisc.data && reDisc.data.TweetDetail;
          if (newMeta && newMeta.queryId && newMeta.queryId !== detailMeta.queryId) {
            detailMeta = newMeta;
            continue;
          }
        }
        break;
      }
      if (resp && resp.ok) {
        const parsed = _parseTweetDetail(resp.data, tweetId);
        const thread = withThread ? parsed.threadTweets : [];
        const replies = withReplies ? parsed.replies : [];
        let replyCursor = withReplies ? parsed.replyCursor : null;
        collectedReplyPages = withReplies ? 1 : 0;

        if (withReplies && replyCursor) {
          for (let p = 0; p < MAX_REPLY_PAGES && replyCursor; p++) {
            if (budgetExpired()) { timedOut = true; break; }
            await delay(REPLY_PAGE_DELAY_MS);
            if (budgetExpired()) { timedOut = true; break; }
            const v2 = Object.assign({}, variables, { cursor: replyCursor });
            const next = await fetchXGraphQL({
              opName: 'TweetDetail',
              queryId: detailMeta.queryId,
              variables: v2,
              features: detailMeta.features || DEFAULT_GRAPHQL_FEATURES,
              fieldToggles,
              timeoutMs: FETCH_TIMEOUT_MS,
            });
            if (!next.ok) break;
            collectedReplyPages++;
            const more = _parseTweetDetail(next.data, tweetId);
            for (const r of more.replies) {
              if (r && !replies.some((x) => x.tweetId === r.tweetId)) replies.push(r);
            }
            replyCursor = more.replyCursor;
          }
        }

        return okResult({
          tweetId,
          tweet: parsed.focalTweet,
          thread,
          replies,
          replyCursor: replyCursor || null,
          meta: {
            bridge: 'post-bridge',
            version: VERSION,
            opName: 'TweetDetail',
            queryId: detailMeta.queryId,
            graphqlSource: detailMeta.source || 'unknown',
            pausedOn429: pausedOnce,
            withThread,
            withReplies,
            collectedReplyPages,
            timedOut,
            partial: timedOut,
            durationMs: Date.now() - t0Total,
            budgetMs,
          },
        });
      }
      if (timedOut) {
        // TweetDetail 拿不到任何数据但已超预算；不再降级到 REST，直接报告超时。
        return errResult('budget_exceeded_no_data', {
          tweetId,
          opName: 'TweetDetail',
          durationMs: Date.now() - t0Total,
          budgetMs,
          timedOut: true,
        });
      }
    }

    if (restMeta && restMeta.queryId && !budgetExpired()) {
      const variables = {
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false,
      };
      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: true,
        withGrokAnalyze: false,
      };
      let resp = null;
      while (true) {
        if (budgetExpired()) { timedOut = true; break; }
        resp = await fetchXGraphQL({
          opName: 'TweetResultByRestId',
          queryId: restMeta.queryId,
          variables,
          features: restMeta.features || DEFAULT_GRAPHQL_FEATURES,
          fieldToggles,
          timeoutMs: FETCH_TIMEOUT_MS,
        });
        if (resp.ok) break;
        if (resp.statusCode === 429) {
          consecutive429++;
          if (consecutive429 >= 3 && !pausedOnce) {
            pausedOnce = true;
            await delay(PAUSE_AFTER_429_MS);
            consecutive429 = 0;
            continue;
          }
          await delay(Math.min(((resp.retryAfter || 30) * 1000), 60 * 1000));
          continue;
        }
        if ((resp.statusCode === 400 || resp.statusCode === 404) && !restCacheInvalidated) {
          restCacheInvalidated = true;
          invalidateGraphQLCache('TweetResultByRestId');
          const reDisc = await discoverGraphQLParams(['TweetResultByRestId']);
          const newMeta = reDisc.data && reDisc.data.TweetResultByRestId;
          if (newMeta && newMeta.queryId && newMeta.queryId !== restMeta.queryId) {
            restMeta = newMeta;
            continue;
          }
        }
        break;
      }
      if (resp && resp.ok) {
        const tweetResult = resp.data && resp.data.data && resp.data.data.tweetResult && resp.data.data.tweetResult.result;
        const parsed = tweetResult ? parseSingleTweetResult(tweetResult) : null;
        if (!parsed) return errResult('parse_failed', { opName: 'TweetResultByRestId' });
        return okResult({
          tweetId,
          tweet: parsed,
          thread: [],
          replies: [],
          replyCursor: null,
          meta: {
            bridge: 'post-bridge',
            version: VERSION,
            opName: 'TweetResultByRestId',
            queryId: restMeta.queryId,
            graphqlSource: restMeta.source || 'unknown',
            pausedOn429: pausedOnce,
            timedOut,
            partial: false,
            durationMs: Date.now() - t0Total,
            budgetMs,
            note: 'fallback_path_no_thread_no_replies',
          },
        });
      }
    }

    return errResult('all_paths_failed', {
      tweetId,
      timedOut,
      durationMs: Date.now() - t0Total,
      budgetMs,
    });
  }

  async function getPostTweet(args){
    const gql = await api_getPost(args);
    if (gql.ok) return _maybeUpgradeTweetToArticle(gql, args);
    const tryDom = gql.error === 'graphql_discover_failed' || gql.error === 'all_paths_failed';
    if (tryDom) {
      const dom = await dom_getPost(args);
      if (dom.ok) return _maybeUpgradeTweetToArticle(dom, args);
      return dom;
    }
    return gql;
  }

  async function getPost(args){
    args = args || {};
    const resolved = resolvePostInput(args);
    if (resolved.kind === 'article') {
      return getArticle(Object.assign({}, args, {
        contentKind: 'article',
        articleId: resolved.articleId,
      }));
    }
    if (resolved.kind === 'short') {
      const fromPath = parseArticleFromPath();
      if (fromPath.articleId) {
        return getArticle(Object.assign({}, args, {
          contentKind: 'article',
          articleId: fromPath.articleId,
        }));
      }
      const fromPost = parsePostFromPath();
      if (fromPost.tweetId) {
        return getPostTweet(Object.assign({}, args, {
          contentKind: 'tweet',
          tweetId: fromPost.tweetId,
        }));
      }
      if (args.url) {
        return {
          ok: false,
          error: 'dom_navigation_required',
          to: args.url,
          navMethod: 'navigatePost',
          navArgs: { url: args.url },
        };
      }
      return errResult('unresolved_short_url');
    }
    if (resolved.kind === 'tweet') {
      return getPostTweet(Object.assign({}, args, { tweetId: resolved.tweetId }));
    }
    return errResult('missing_tweetId_or_articleId');
  }

  const api = {
    __meta: { version: VERSION, name: 'post-bridge' },
    probe,
    state,
    sessionState,
    navigatePost,
    getPost,
    getArticle,
    api_getPost,
    api_getArticle,
    dom_getPost,
    dom_getArticle,
  };
  window.__jse_x_post__ = api;
  return { ok: true, version: VERSION, name: 'post-bridge' };
})();
