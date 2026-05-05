// bridges/search-bridge.js
// ---------------------------------------------------------------------------
// 小红书搜索结果 bridge。
//
// 暴露 window.__jse_xhs_search__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateSearch({ keyword, channelType?, sortBy?, contentType?, timeRange?, searchScope? })
//   search({ keyword, limit?, channelType?, sortBy?, contentType?, timeRange?, searchScope?, extractDetails? })
//   dom_search （runTool 主路径，auto = dom 优先）
//
// 设计源自 agent-js DeepSearchWorkflow/lib/mcp/tools/xhsSearch.js，做了:
//   - 版本化（VERSION='0.1.0'）
//   - 选择器 fallback
//   - 共享 common.js
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '0.1.3';

  // @@include ./common.js

  const FILTER_GROUPS = {
    sortBy: { selector: '.filter-group:nth-of-type(1) .dropdown-item', name: '排序' },
    contentType: { selector: '.filter-group:nth-of-type(2) .dropdown-item', name: '类型' },
    timeRange: { selector: '.filter-group:nth-of-type(3) .dropdown-item', name: '时间' },
    searchScope: { selector: '.filter-group:nth-of-type(4) .dropdown-item', name: '范围' },
  };

  const CHANNEL_TYPE_TO_TAB_INDEX = {
    '全部': 0, '图文': 1, '视频': 2, '用户': 3,
  };

  function _stateReady() {
    return /\/search_result/i.test(location.pathname);
  }

  function probe() {
    var session = sessionStateCommon();
    return okResult({
      url: location.href,
      hostname: location.hostname,
      bridge: { version: VERSION, name: 'search-bridge' },
      login: session && session.data ? session.data : null,
      timestamp: new Date().toISOString(),
    });
  }

  function state() {
    var ready = _stateReady();
    return okResult({
      ready: ready,
      reason: ready ? null : 'not_on_search',
      url: location.href,
      bridgeVersion: VERSION,
    });
  }

  function sessionState() { return sessionStateCommon(); }

  function navigateSearch(args) {
    args = args || {};
    var u = new URL('https://www.xiaohongshu.com/search_result');
    if (args.keyword) u.searchParams.set('keyword', String(args.keyword));
    u.searchParams.set('source', 'web_explore_feed');
    return navigateLocation(u.toString());
  }

  // ----- 滚动加载 -----

  async function _scrollAndCollect(limit, idleRoundsMax) {
    var collected = [];
    var seenIds = new Set();
    var idleRounds = 0;
    var maxRounds = 60;
    function snap() {
      var nodes = document.querySelectorAll('.feeds-container .note-item, .feeds-container section.note-item, section.note-item');
      var added = 0;
      nodes.forEach(function (node) {
        try {
          var item = _extractNoteCard(node);
          if (item && item.noteId && !seenIds.has(item.noteId)) {
            seenIds.add(item.noteId);
            collected.push(item);
            added++;
          }
        } catch (_) {}
      });
      return added;
    }

    snap();
    for (var round = 0; round < maxRounds; round++) {
      if (collected.length >= limit) break;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await delay(1200);
      var added = snap();
      if (added === 0) {
        idleRounds++;
        if (idleRounds >= (idleRoundsMax || 3)) break;
      } else {
        idleRounds = 0;
      }
    }
    return collected.slice(0, limit);
  }

  function _extractNoteCard(node) {
    if (!node) return null;
    // 卡片内通常有多个 <a>：a.cover 不带 token；a.title (/search_result/<id>?xsec_token=...) 带 token。
    // 优先选带 xsec_token 的链接。
    var anchors = node.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]');
    var withToken = null;
    var fallback = null;
    for (var i = 0; i < anchors.length; i++) {
      var h = readReactHref(anchors[i]) || anchors[i].getAttribute('href') || '';
      if (h.indexOf('xsec_token=') >= 0) { withToken = h; break; }
      if (!fallback) fallback = h;
    }
    var href = withToken || fallback;
    if (!href) return null;
    var fullUrl = href.startsWith('http') ? href : ('https://www.xiaohongshu.com' + href);
    var ref = parseNoteIdFromHref(fullUrl);
    if (!ref || !ref.noteId) return null;

    function pickText(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = node.querySelector(selectors[i]);
        if (el) {
          var t = (el.textContent || '').trim();
          if (t) return t;
        }
      }
      return '';
    }
    var title = pickText(['.footer .title', '.title span', '.title', 'a.cover .title']);
    var author = pickText(['.author-wrapper .author .name', '.author .name', '.user-name']);
    var likeText = pickText(['.like-wrapper .count', '.author-wrapper .count', '.count']);
    var coverImg = node.querySelector('a.cover img, img');
    var cover = coverImg ? (coverImg.getAttribute('src') || coverImg.getAttribute('data-src')) : null;

    return {
      noteId: ref.noteId,
      url: 'https://www.xiaohongshu.com/explore/' + ref.noteId
        + (ref.xsec_token ? ('?xsec_token=' + encodeURIComponent(ref.xsec_token)) : ''),
      xsec_token: ref.xsec_token || '',
      title: title,
      author: author,
      likeCount: parseCountText(likeText),
      cover: cover,
    };
  }

  // ----- channel / filter -----

  async function _switchChannel(channelType) {
    if (!channelType || channelType === '全部') return { ok: true, applied: '全部' };
    var idx = CHANNEL_TYPE_TO_TAB_INDEX[channelType];
    if (idx == null) return { ok: false, error: 'unknown_channel', channelType: channelType };
    var tabs = document.querySelectorAll('.search-channel-list li, .channel-list .channel');
    if (!tabs[idx]) return { ok: false, error: 'channel_tab_not_found', idx: idx };
    try { tabs[idx].click(); } catch (_) {}
    await delay(800);
    return { ok: true, applied: channelType };
  }

  async function _applyFilter(groupKey, optionLabel) {
    if (!optionLabel) return { ok: true, applied: null };
    var group = FILTER_GROUPS[groupKey];
    if (!group) return { ok: false, error: 'unknown_filter_group', groupKey: groupKey };
    var trigger = document.querySelector('.filter-group:nth-of-type(' + (Object.keys(FILTER_GROUPS).indexOf(groupKey) + 1) + ') .dropdown-trigger, .filters-wrapper .filter-' + groupKey);
    if (trigger) {
      try { trigger.click(); } catch (_) {}
      await delay(400);
    }
    var items = document.querySelectorAll(group.selector);
    var hit = null;
    items.forEach(function (it) {
      if (((it.textContent || '').trim()) === String(optionLabel)) hit = it;
    });
    if (!hit) return { ok: false, error: 'filter_option_not_found', groupKey: groupKey, optionLabel: optionLabel };
    try { hit.click(); } catch (_) {}
    await delay(800);
    return { ok: true, applied: optionLabel };
  }

  // ----- extract details（点详情 + 抽 #noteContainer） -----

  async function _extractDetails(notes, limitDetails) {
    var results = [];
    var max = Math.min(notes.length, limitDetails || notes.length);
    for (var i = 0; i < max; i++) {
      var note = notes[i];
      results.push(Object.assign({}, note, {
        // 详情抓取依赖在新 tab 跳转，bridge 内不做。这里仅返回基础卡片。
        // 详情走 note-bridge.getNote 由 caller 串行调用更稳妥。
        detailExtractedInline: false,
      }));
    }
    return results;
  }

  async function dom_search(args) {
    args = args || {};
    var keyword = String(args.keyword || '').trim();
    if (!keyword) return errResult('bad_arg', { reason: 'keyword required' });

    if (!_stateReady()) {
      var u = new URL('https://www.xiaohongshu.com/search_result');
      u.searchParams.set('keyword', keyword);
      u.searchParams.set('source', 'web_explore_feed');
      return { ok: false, error: 'dom_navigation_required', to: u.toString(),
        navMethod: 'navigateSearch', navArgs: { keyword: keyword } };
    }

    var limit = clampLimit(args.limit, 10, 200);
    var appliedFilters = {};

    var ch = await _switchChannel(args.channelType || '全部');
    appliedFilters.channelType = ch.applied;

    var filterPromises = [
      ['sortBy', args.sortBy],
      ['contentType', args.contentType],
      ['timeRange', args.timeRange],
      ['searchScope', args.searchScope],
    ];
    for (var i = 0; i < filterPromises.length; i++) {
      var fr = await _applyFilter(filterPromises[i][0], filterPromises[i][1]);
      appliedFilters[filterPromises[i][0]] = fr.applied || null;
      if (fr.error) appliedFilters[filterPromises[i][0] + '_error'] = fr.error;
    }

    await delay(800);

    var notes = await _scrollAndCollect(limit, 3);
    if (!notes.length) {
      return errResult('dom_extract_failed', { reason: 'no_notes', appliedFilters: appliedFilters });
    }

    if (args.extractDetails) {
      notes = await _extractDetails(notes, limit);
    }

    // 联想 / 相关搜索
    var suggestKeywords = [];
    document.querySelectorAll('.search-tip li, .suggest-list li').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t) suggestKeywords.push(t);
    });
    var relatedSearchKeywords = [];
    document.querySelectorAll('.related-search a, .related-search-wrap a, .recommend-tag').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t) relatedSearchKeywords.push(t);
    });
    var searchTabs = [];
    document.querySelectorAll('.search-channel-list li, .channel-list .channel').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t) searchTabs.push(t);
    });

    return okResult({
      keyword: keyword,
      total: notes.length,
      notes: notes,
      searchTabs: searchTabs,
      suggestKeywords: suggestKeywords.slice(0, 20),
      relatedSearchKeywords: relatedSearchKeywords.slice(0, 20),
      appliedFilters: appliedFilters,
      meta: { source: 'dom', bridge: 'search-bridge', version: VERSION },
    });
  }

  function search(args) { return dom_search(args || {}); }

  window.__jse_xhs_search__ = {
    __meta: { version: VERSION, name: 'search-bridge' },
    probe: probe,
    state: state,
    sessionState: sessionState,
    navigateSearch: navigateSearch,
    search: search,
    dom_search: dom_search,
  };

  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
