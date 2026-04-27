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
  const VERSION = '3.0.3';

  // @@include ./common.js

  const PAUSE_AFTER_429_MS = 5 * 60 * 1000;
  const REPLY_PAGE_DELAY_MS = 1500;
  const MAX_REPLY_PAGES = 10;

  function parsePostFromPath(){
    const m = /^\/([\w_]+)\/status\/(\d+)/.exec(location.pathname || '');
    if (!m) return { username: null, tweetId: null };
    return { username: m[1], tweetId: m[2] };
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
    const sessionResp = await sessionStateCommon();
    const dParams = await discoverGraphQLParams(['TweetDetail', 'TweetResultByRestId']);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      username,
      tweetId,
      login: sessionResp && sessionResp.data ? sessionResp.data : null,
      graphql: dParams.data,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'post-bridge' },
    });
  }

  async function state(){
    const { username, tweetId } = parsePostFromPath();
    const ready = !!tweetId;
    return okResult({
      ready,
      reason: ready ? null : 'not_on_status_path',
      url: location.href,
      username,
      tweetId,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  function navigatePost(args){
    args = args || {};
    let url = null;
    if (typeof args.url === 'string' && args.url) {
      url = args.url;
    } else {
      const username = args.username && String(args.username).replace(/^@/, '');
      const tweetId = extractTweetId(args.tweetId);
      if (!tweetId) return errResult('missing_tweetId_or_url');
      url = 'https://x.com/' + (username || 'i') + '/status/' + tweetId;
    }
    return navigateLocation(url);
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

  async function getPost(args){
    args = args || {};
    const tweetIdInput = args.tweetId != null ? args.tweetId : (args.url || null);
    const tweetId = extractTweetId(tweetIdInput);
    if (!tweetId) return errResult('missing_tweetId');
    const withThread = !!args.withThread;
    const withReplies = !!args.withReplies;

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
        withArticlePlainText: false,
        withGrokAnalyze: false,
        withDisallowedReplyControls: false,
      };

      let resp = null;
      while (true) {
        const t0 = Date.now();
        resp = await fetchXGraphQL({
          opName: 'TweetDetail',
          queryId: detailMeta.queryId,
          variables,
          features: detailMeta.features || DEFAULT_GRAPHQL_FEATURES,
          fieldToggles,
        });
        const _durMs = Date.now() - t0;
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
          if (newMeta && newMeta.queryId) {
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

        if (withReplies && replyCursor) {
          for (let p = 0; p < MAX_REPLY_PAGES && replyCursor; p++) {
            await delay(REPLY_PAGE_DELAY_MS);
            const v2 = Object.assign({}, variables, { cursor: replyCursor });
            const next = await fetchXGraphQL({
              opName: 'TweetDetail',
              queryId: detailMeta.queryId,
              variables: v2,
              features: detailMeta.features || DEFAULT_GRAPHQL_FEATURES,
              fieldToggles,
            });
            if (!next.ok) break;
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
          },
        });
      }
    }

    if (restMeta && restMeta.queryId) {
      const variables = {
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false,
      };
      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
      };
      let resp = null;
      while (true) {
        resp = await fetchXGraphQL({
          opName: 'TweetResultByRestId',
          queryId: restMeta.queryId,
          variables,
          features: restMeta.features || DEFAULT_GRAPHQL_FEATURES,
          fieldToggles,
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
          if (newMeta && newMeta.queryId) {
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
            note: 'fallback_path_no_thread_no_replies',
          },
        });
      }
    }

    return errResult('all_paths_failed', { tweetId });
  }

  const api = {
    __meta: { version: VERSION, name: 'post-bridge' },
    probe,
    state,
    sessionState,
    navigatePost,
    getPost,
  };
  window.__jse_x_post__ = api;
  return { ok: true, version: VERSION, name: 'post-bridge' };
})();
