// bridges/profile-bridge.js
// ---------------------------------------------------------------------------
// X.com 用户主页 bridge。
//
// 暴露 window.__jse_x_profile__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateProfile({ username, tab? })
//   getProfile({ username, maxPages?, includeReplies?, ... })
//
// 内部走两段 GraphQL：UserByScreenName 拿 user.rest_id，再 UserTweets 翻页。
// 遇到 429 连续 3 次暂停 5 分钟。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.0.2';

  // @@include ./common.js

  const DEFAULT_MAX_PAGES = 5;
  const MAX_MAX_PAGES = 80;
  const PAGE_DELAY_MS = 2000;
  const PAUSE_AFTER_429_MS = 5 * 60 * 1000;

  function parseUsernameFromPath(){
    const m = /^\/([\w_]+)(?:\/(?:with_replies|media|likes|highlights|articles)?)?\/?$/.exec(location.pathname || '');
    if (!m) return null;
    const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings']);
    if (reserved.has(m[1])) return null;
    return m[1];
  }

  function parseTabFromPath(){
    const m = /^\/[\w_]+\/(with_replies|media|likes|highlights|articles)\/?$/.exec(location.pathname || '');
    return m ? m[1] : 'tweets';
  }

  async function probe(){
    const username = parseUsernameFromPath();
    const tab = parseTabFromPath();
    const sessionResp = await sessionStateCommon();
    const dParams = await discoverGraphQLParams(['UserByScreenName', 'UserTweets', 'UserTweetsAndReplies']);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      username,
      tab,
      login: sessionResp && sessionResp.data ? sessionResp.data : null,
      graphql: dParams.data,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'profile-bridge' },
    });
  }

  async function state(){
    const username = parseUsernameFromPath();
    const ready = !!username;
    return okResult({
      ready,
      reason: ready ? null : 'not_on_profile_path',
      url: location.href,
      username,
      tab: parseTabFromPath(),
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  function navigateProfile(args){
    args = args || {};
    const username = String(args.username || '').replace(/^@/, '').trim();
    if (!username) return errResult('missing_username');
    const tab = args.tab && String(args.tab);
    let path = '/' + encodeURIComponent(username);
    if (tab && /^(with_replies|media|likes|highlights|articles)$/.test(tab)) {
      path += '/' + tab;
    }
    return navigateLocation('https://x.com' + path);
  }

  async function _resolveUserId(username, queryId, features){
    const userFeatures = features || {
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
    };
    const variables = {
      screen_name: username,
      withSafetyModeUserFields: true,
    };
    const fieldToggles = { withAuxiliaryUserLabels: false };
    const resp = await fetchXGraphQL({
      opName: 'UserByScreenName',
      queryId,
      variables,
      features: userFeatures,
      fieldToggles,
    });
    if (!resp.ok) return { ok: false, error: resp.error || 'fetch_failed', statusCode: resp.statusCode };
    try {
      const userResult = resp.data && resp.data.data && resp.data.data.user && resp.data.data.user.result;
      if (!userResult) return { ok: false, error: 'no_user_result' };
      const userId = userResult.rest_id;
      if (!userId) return { ok: false, error: 'no_rest_id' };
      const userLegacy = userResult.legacy || {};
      const userCore = userResult.core || {};
      const userAvatar = userResult.avatar || {};
      const userLocation = userResult.location || {};
      const locStr = (typeof userLocation === 'string')
        ? userLocation
        : (userLocation.location || userLegacy.location || '');
      return {
        ok: true,
        userId,
        profile: {
          name: userCore.name || userLegacy.name || '',
          screenName: userCore.screen_name || userLegacy.screen_name || username,
          bio: userLegacy.description || (userResult.profile_bio && userResult.profile_bio.description) || '',
          location: locStr,
          website: (userLegacy.entities && userLegacy.entities.url && userLegacy.entities.url.urls && userLegacy.entities.url.urls[0] && userLegacy.entities.url.urls[0].expanded_url) || '',
          followersCount: userLegacy.followers_count || 0,
          followingCount: userLegacy.friends_count || 0,
          tweetCount: userLegacy.statuses_count || 0,
          listedCount: userLegacy.listed_count || 0,
          joinDate: userCore.created_at || userLegacy.created_at || '',
          avatarUrl: userAvatar.image_url || userLegacy.profile_image_url_https || '',
          bannerUrl: userLegacy.profile_banner_url || '',
          isVerified: userResult.is_blue_verified || false,
          isProtected: (userResult.privacy && userResult.privacy.protected) || userLegacy.protected || false,
        },
      };
    } catch (e) {
      return { ok: false, error: 'parse_user_failed', message: String(e && e.message || e) };
    }
  }

  async function getProfile(args){
    args = args || {};
    const username = String(args.username || '').replace(/^@/, '').trim();
    if (!username) return errResult('missing_username');
    const includeReplies = !!args.includeReplies;
    const maxPages = clampLimit(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);

    const tweetsOp = includeReplies ? 'UserTweetsAndReplies' : 'UserTweets';
    let disc = await discoverGraphQLParams(['UserByScreenName', tweetsOp]);
    let userMeta = disc.data && disc.data.UserByScreenName;
    let tweetsMeta = disc.data && disc.data[tweetsOp];
    if (!userMeta || !userMeta.queryId) {
      return errResult('graphql_discover_failed', { opName: 'UserByScreenName' });
    }
    if (!tweetsMeta || !tweetsMeta.queryId) {
      return errResult('graphql_discover_failed', { opName: tweetsOp });
    }

    let resolved = await _resolveUserId(username, userMeta.queryId, userMeta.features);
    if (!resolved.ok && (resolved.statusCode === 400 || resolved.statusCode === 404)) {
      invalidateGraphQLCache('UserByScreenName');
      disc = await discoverGraphQLParams(['UserByScreenName', tweetsOp]);
      const reUserMeta = disc.data && disc.data.UserByScreenName;
      if (reUserMeta && reUserMeta.queryId) {
        userMeta = reUserMeta;
        resolved = await _resolveUserId(username, userMeta.queryId, userMeta.features);
      }
    }
    if (!resolved.ok) return errResult(resolved.error, { opName: 'UserByScreenName', statusCode: resolved.statusCode });

    let features = tweetsMeta.features || DEFAULT_GRAPHQL_FEATURES;
    let variablesTemplate = tweetsMeta.variables || null;

    const allTweets = [];
    const seenIds = new Set();
    let cursor = null;
    let consecutive429 = 0;
    let pausedOnce = false;
    let cacheInvalidated = false;
    const pageMeta = [];

    for (let page = 1; page <= maxPages; page++) {
      const variables = variablesTemplate
        ? Object.assign({}, variablesTemplate)
        : {
            userId: resolved.userId, count: 20, includePromotedContent: false,
            withQuickPromoteEligibilityTweetFields: true, withVoice: true, withV2Timeline: true,
          };
      variables.userId = resolved.userId;
      if (!variables.count) variables.count = 20;
      if (cursor) variables.cursor = cursor; else delete variables.cursor;

      const t0 = Date.now();
      const resp = await fetchXGraphQL({
        opName: tweetsOp,
        queryId: tweetsMeta.queryId,
        variables,
        features,
      });
      const durMs = Date.now() - t0;

      if (!resp.ok && resp.statusCode === 429) {
        consecutive429++;
        if (consecutive429 >= 3 && !pausedOnce) {
          pausedOnce = true;
          await delay(PAUSE_AFTER_429_MS);
          consecutive429 = 0;
          page--;
          continue;
        }
        const retryDelay = (resp.retryAfter || 30) * 1000;
        await delay(Math.min(retryDelay, 60 * 1000));
        page--;
        continue;
      }
      if (!resp.ok && (resp.statusCode === 400 || resp.statusCode === 404) && !cacheInvalidated) {
        cacheInvalidated = true;
        invalidateGraphQLCache(tweetsOp);
        disc = await discoverGraphQLParams([tweetsOp]);
        const newMeta = disc.data && disc.data[tweetsOp];
        if (newMeta && newMeta.queryId) {
          tweetsMeta = newMeta;
          features = newMeta.features || features;
          variablesTemplate = newMeta.variables || variablesTemplate;
          page--;
          continue;
        }
      }
      if (!resp.ok) {
        pageMeta.push({ page, ok: false, error: resp.error, statusCode: resp.statusCode || null, durMs });
        break;
      }
      consecutive429 = 0;

      let entries = [];
      try {
        const userResult = resp.data && resp.data.data && resp.data.data.user && resp.data.data.user.result;
        const tl = (userResult && userResult.timeline_v2 && userResult.timeline_v2.timeline)
          || (userResult && userResult.timeline && userResult.timeline.timeline);
        const ins = (tl && tl.instructions) || [];
        for (const inst of ins) {
          if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
            entries = entries.concat(inst.entries);
          } else if (inst.type === 'TimelinePinEntry' && inst.entry) {
            entries.unshift(inst.entry);
          }
        }
      } catch (_) {}
      const parsed = parseTweetEntries(entries);
      let added = 0;
      for (const tw of parsed.tweets) {
        if (tw && tw.tweetId && !seenIds.has(tw.tweetId)) {
          seenIds.add(tw.tweetId);
          allTweets.push(tw);
          added++;
        }
      }
      pageMeta.push({ page, ok: true, returned: parsed.tweets.length, added, durMs, hasNext: !!parsed.nextCursor });
      cursor = parsed.nextCursor;
      if (!cursor) break;
      if (page < maxPages) await delay(PAGE_DELAY_MS);
    }

    return okResult({
      username,
      includeReplies,
      profile: resolved.profile,
      total: allTweets.length,
      tweets: allTweets,
      pages: pageMeta,
      meta: {
        bridge: 'profile-bridge',
        version: VERSION,
        userOpName: 'UserByScreenName',
        userQueryId: userMeta.queryId,
        tweetsOpName: tweetsOp,
        tweetsQueryId: tweetsMeta.queryId,
        graphqlSourceUser: userMeta.source || 'unknown',
        graphqlSourceTweets: tweetsMeta.source || 'unknown',
        pausedOn429: pausedOnce,
        endedReason: cursor ? 'reached_max_pages' : 'no_cursor',
      },
    });
  }

  const api = {
    __meta: { version: VERSION, name: 'profile-bridge' },
    probe,
    state,
    sessionState,
    navigateProfile,
    getProfile,
  };
  window.__jse_x_profile__ = api;
  return { ok: true, version: VERSION, name: 'profile-bridge' };
})();
