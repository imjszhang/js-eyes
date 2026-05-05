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
//   search({ keyword, limit?, channelType?, sortBy?, contentType?, timeRange?, searchScope?,
//            extractDetails?, detailsLimit? })
//   dom_search （runTool 主路径，auto = dom 优先）
//
// v3.2 起 UI 路径与 agent-js DeepSearchWorkflow/lib/mcp/tools/xhsSearch.js 对齐：
//   - 频道 Tab 在 #channel-container 内按文本匹配
//   - 筛选通过点击「筛选」span → .filters-wrapper 行内按文本匹配选项 → body 关闭
//   - extractDetails 走「同 tab：点 a → 等 #noteContainer → 内联抽取 → 点关闭按钮 / back → 等列表重现」
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '0.3.6';

  // visual-bridge-kit 桥：当 visual 启用时，window.__jse_visual 会被注入。
  // 在编排关键节点主动 emit HUD/flash，让 19s 的串行详情过程不再「中段空白」。
  function _vis() { try { return window.__jse_visual || null; } catch (_) { return null; } }
  function _vhud(action, target, detail, tone) {
    var v = _vis(); if (!v || !v.showHud) return;
    try { v.showHud({ action: action || '', target: target || '', detail: detail || '', status: tone || 'info' }); } catch (_) {}
  }
  function _vflash(el, tone, label) {
    var v = _vis(); if (!v || !v.flashElement || !el) return;
    try { v.flashElement(el, { tone: tone || 'info', label: label || '' }); } catch (_) {}
  }

  // @@include ./common.js

  const FILTER_CATEGORY_LABELS = {
    sortBy: '排序依据',
    contentType: '笔记类型',
    timeRange: '发布时间',
    searchScope: '搜索范围',
  };

  const CHANNEL_LABELS = ['全部', '图文', '视频', '用户'];

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

  // ----- 通用等待 -----

  function _waitFor(selector, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 8000);
      function tick() {
        var el = null;
        try { el = document.querySelector(selector); } catch (_) {}
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 200);
      }
      tick();
    });
  }

  function _waitForFeeds(timeoutMs) {
    return _waitFor('.feeds-container .note-item, .feeds-container section.note-item, section.note-item', timeoutMs || 8000);
  }

  function _randomJitter(minMs, maxMs) {
    var d = Math.floor(minMs + Math.random() * Math.max(1, maxMs - minMs));
    return delay(d);
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
    var fullUrl = href.indexOf('http') === 0 ? href : ('https://www.xiaohongshu.com' + href);
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
      // 保留卡片节点引用（仅在本帧有效；详情阶段会重新查找）
      _selector: 'noteId=' + ref.noteId,
    };
  }

  // ----- 频道 Tab：参考 xhsSearch.js 走 #channel-container -----

  async function _switchChannel(channelType) {
    if (!channelType || channelType === '全部') return { ok: true, applied: '全部' };
    if (CHANNEL_LABELS.indexOf(channelType) === -1) {
      return { ok: false, error: 'unknown_channel', channelType: channelType };
    }
    var container = document.querySelector('#channel-container');
    if (!container) {
      return { ok: false, error: 'channel_container_not_found' };
    }
    // 优先 button/role=button/a，再退化到所有叶子元素文本匹配
    // 优先 [data-hp-bound]（Vue 真节点；visual-bridge-kit 的 HP overlay 没有这个属性）
    var bound = container.querySelectorAll('[data-hp-bound]');
    var hit = null;
    for (var bi = 0; bi < bound.length; bi++) {
      if ((bound[bi].textContent || '').trim() === channelType) { hit = bound[bi]; break; }
    }
    if (!hit) {
      var primary = container.querySelectorAll('div[role="button"], button, a, span');
      for (var i = 0; i < primary.length; i++) {
        if (primary[i].hasAttribute('data-hp-installed')) continue;
        if ((primary[i].textContent || '').trim() === channelType) { hit = primary[i]; break; }
      }
    }
    if (!hit) {
      var all = container.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        if (el.hasAttribute('data-hp-installed')) continue;
        if (el.children.length === 0 && (el.textContent || '').trim() === channelType) { hit = el; break; }
      }
    }
    if (!hit) {
      return { ok: false, error: 'channel_tab_not_found', channelType: channelType };
    }
    _vhud('切频道', channelType, '', 'pending');
    _vflash(hit, 'info', '频道');
    try { hit.click(); } catch (_) {}
    await _randomJitter(800, 1200);
    await _waitForFeeds(8000);
    _vhud('切频道', channelType, 'OK', 'success');
    return { ok: true, applied: channelType };
  }

  // ----- 筛选面板：点击「筛选」span 打开 -----

  async function _openFilterPanel() {
    if (document.querySelector('.filters-wrapper')) return { ok: true, alreadyOpen: true };
    var spans = document.querySelectorAll('span');
    var hit = null;
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].textContent || '').trim() === '筛选' && spans[i].children.length === 0) {
        hit = spans[i]; break;
      }
    }
    if (!hit) {
      // 备路径：可点击元素含「筛选」文本
      var clickable = document.querySelectorAll('[role="button"], [style*="cursor: pointer"], button, div');
      for (var j = 0; j < clickable.length; j++) {
        var c = clickable[j];
        if ((c.textContent || '').indexOf('筛选') >= 0 && (c.textContent || '').trim().length < 10) {
          hit = c; break;
        }
      }
    }
    if (!hit) return { ok: false, error: 'filter_trigger_not_found' };
    _vhud('打开筛选面板', '', '', 'pending');
    _vflash(hit, 'info', '筛选');
    try { hit.click(); } catch (_) {}
    var panel = await _waitFor('.filters-wrapper', 3000);
    if (!panel) return { ok: false, error: 'filter_panel_not_opened' };
    _vhud('打开筛选面板', '', 'OK', 'success');
    await delay(400);
    return { ok: true };
  }

  async function _applyFilter(groupKey, optionLabel) {
    if (!optionLabel) return { ok: true, applied: null };
    var category = FILTER_CATEGORY_LABELS[groupKey];
    if (!category) return { ok: false, error: 'unknown_filter_group', groupKey: groupKey };
    var panel = document.querySelector('.filters-wrapper');
    if (!panel) return { ok: false, error: 'filter_panel_not_open', groupKey: groupKey };

    // xhs 实测面板结构：.filters-wrapper > .filters > [.title, .tag-container > .tags(.active?) > <span>]
    // 每行的 `.filters` 第一个子元素是分类标题（"排序依据" 等），第二个是 `.tag-container`。
    // 「选项」是 `.tags` div，每个内部是 `<span>` —— 真正的 React onClick 挂在 `.tags` 上，
    // 点 inner span 虽然能命中文本但不会真的触发 onChange（之前 0.3.2 的 false-positive 根因）。
    var filterRows = panel.querySelectorAll('.filters');
    var targetRow = null;
    for (var i = 0; i < filterRows.length; i++) {
      var row = filterRows[i];
      var titleEl = row.children && row.children[0];
      var titleText = titleEl ? (titleEl.textContent || '').trim() : '';
      if (titleText.indexOf(category) >= 0) { targetRow = row; break; }
    }
    if (!targetRow) {
      return { ok: false, error: 'filter_row_not_found', groupKey: groupKey, category: category };
    }

    // 关键：xhs 用 Vue（不是 React）；同时 visual-bridge-kit 的 hyperframes pointer overlay
    // 给每个 .tags 装了一个 absolute positioned 的「点击映射层」（带 `data-hp-installed` /
    // `data-hp-kind` 但**没有** `data-v-eb91fffe`），它出现在 querySelectorAll 顺序的前面。
    // 直接 click() 这个 overlay 不会触发 Vue 的 onChange —— 必须 click 真实的 Vue 节点
    // （带 `data-hp-bound="1"` + `data-v-eb91fffe`）。
    function _selectRealTag(row, label) {
      var bound = row.querySelectorAll('.tag-container .tags[data-hp-bound]');
      for (var i = 0; i < bound.length; i++) {
        if ((bound[i].textContent || '').trim() === String(label)) return bound[i];
      }
      // 兼容旧 / 未注入 visual 的情况：回到全集匹配，并主动跳过 HP overlay
      var all = row.querySelectorAll('.tag-container .tags');
      for (var j = 0; j < all.length; j++) {
        if (all[j].hasAttribute('data-hp-installed')) continue;
        var raw = (all[j].textContent || '').trim();
        if (raw === String(label) || raw === String(label) + String(label)) return all[j];
      }
      return null;
    }
    function _realActiveText(row) {
      // 同样跳过 HP overlay，避免读到镜像的 active 状态
      var bound = row.querySelectorAll('.tag-container .tags[data-hp-bound].active');
      if (bound.length) return (bound[0].textContent || '').trim();
      var all = row.querySelectorAll('.tag-container .tags.active');
      for (var i = 0; i < all.length; i++) {
        if (!all[i].hasAttribute('data-hp-installed')) return (all[i].textContent || '').trim();
      }
      return null;
    }

    var hit = _selectRealTag(targetRow, String(optionLabel));
    if (!hit) {
      return { ok: false, error: 'filter_option_not_found', groupKey: groupKey, optionLabel: optionLabel };
    }

    _vhud('筛选 · ' + category, String(optionLabel), '', 'pending');
    _vflash(hit, 'info', category);
    try { hit.click(); } catch (_) {}
    // 等待该行真实 active 切换到目标选项（确认 Vue 状态机已更新；忽略 HP overlay 的镜像）
    var deadline = Date.now() + 1500;
    var activated = false;
    while (Date.now() < deadline) {
      if (_realActiveText(targetRow) === String(optionLabel)) { activated = true; break; }
      await delay(150);
    }
    await _randomJitter(300, 500);
    _vhud('筛选 · ' + category, String(optionLabel), activated ? 'OK' : '未确认', activated ? 'success' : 'warn');
    return { ok: true, applied: optionLabel, activated: activated };
  }

  async function _closeFilterPanel() {
    try { document.body.click(); } catch (_) {}
    await _randomJitter(800, 1200);
    await _waitForFeeds(6000);
    return { ok: true };
  }

  // ----- 同 tab + back 串行抽取详情 -----
  // 详情抽取直接复用 #noteContainer 子树，字段命名与 note-bridge.dom_getNote 对齐：
  // title / description / content / image_urls / stats / xsec_token / noteId
  function _extractFromNoteContainer() {
    // 实测：xhs 点开搜索结果常走「新 route /explore/<id>」而非模态；container 可能是
    // `#noteContainer`（部分账号 / A/B test）也可能是 `.note-container`。两者都要兼容。
    var container = document.querySelector('#noteContainer')
      || document.querySelector('.note-container')
      || document.querySelector('.note-content');
    if (!container) {
      return { ok: false, error: 'no_note_container' };
    }
    var meta = parseNoteMeta();
    function pickText(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = container.querySelector(selectors[i]) || document.querySelector(selectors[i]);
        if (el) {
          var t = (el.textContent || '').trim();
          if (t) return t;
        }
      }
      return '';
    }
    function pickCount(selectors) {
      var raw = pickText(selectors);
      return parseCountText(raw);
    }
    var title = pickText(['#detail-title', '.note-content .title', 'h1.title', 'h1', '.title']) || meta.title;
    // 描述：先取详情段落（不带 .desc 嵌套限制），再退化到 meta description
    var content = pickText(['#detail-desc', '.note-content .desc', '.note-content', '.note-text', '.desc']) || meta.description;
    // 互动栏数字：在 container 内（不是全局 document）找，避免命中外部 likeWrapper（如作者卡片小组件）
    var likes = pickCount([
      '.engage-bar .like-wrapper .count',
      '.like-wrapper.like-active .count',
      '.like-wrapper .count',
    ]);
    var collects = pickCount([
      '.engage-bar .collect-wrapper .count',
      '.collect-wrapper .count',
    ]);
    var comments = pickCount([
      '.engage-bar .chat-wrapper .count',
      '.chat-wrapper .count',
      '.comments-container .total',
    ]);
    // meta 的 og:xhs:note_like/comment/collect 通常更可信，作为兜底
    if (likes == null) likes = parseCountText(meta.note_like);
    if (collects == null) collects = parseCountText(meta.note_collect);
    if (comments == null) comments = parseCountText(meta.note_comment);
    var imgUrls = pickMediaFromNote(container);
    if (imgUrls.length === 0 && meta.image_urls.length) imgUrls = meta.image_urls;
    var authorName = pickText([
      '.author-container .username',
      '.username',
      '.author-container .author-name',
      '.user-name',
    ]);
    var authorLink = container.querySelector('a[href*="/user/profile/"]')
      || document.querySelector('a[href*="/user/profile/"]');
    var authorId = null;
    if (authorLink) {
      var am = (authorLink.getAttribute('href') || '').match(/\/user\/profile\/([^?#]+)/);
      if (am) authorId = am[1];
    }
    var noteRef = parseNoteIdFromHref(location.href) || {};
    return {
      ok: true,
      noteId: noteRef.noteId || null,
      xsec_token: noteRef.xsec_token || '',
      title: title,
      description: content,
      content: content,
      image_urls: imgUrls,
      stats: { likes: likes, comments: comments, collects: collects },
      note_like: meta.note_like,
      note_comment: meta.note_comment,
      note_collect: meta.note_collect,
      author: { nickname: authorName || null, userId: authorId },
    };
  }

  function _findCardAnchor(noteId) {
    // 重新在当前 DOM 找指定 noteId 的卡片中带 xsec_token 的 <a>
    var nodes = document.querySelectorAll('.feeds-container section.note-item, section.note-item');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var anchors = node.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]');
      var fallback = null;
      for (var j = 0; j < anchors.length; j++) {
        var h = readReactHref(anchors[j]) || anchors[j].getAttribute('href') || '';
        if (h.indexOf(noteId) === -1) continue;
        if (h.indexOf('xsec_token=') >= 0) return anchors[j];
        if (!fallback) fallback = anchors[j];
      }
      if (fallback) return fallback;
    }
    return null;
  }

  async function _backToList() {
    // 优先点关闭按钮（模态详情），失败再用 history.back
    var close = document.querySelector('.close-circle .close')
      || document.querySelector('.close-mask-dark .close')
      || document.querySelector('[class*="close-circle"] [class*="close"]');
    var routeMode = !/\/search_result/.test(location.pathname);
    if (close && !routeMode) {
      try { close.click(); } catch (_) {}
    } else {
      // 路由模式（已跳到 /explore/<id>）必须用 history.back，点关闭按钮无效
      try { window.history.back(); } catch (_) {}
    }
    await _randomJitter(800, 1200);
    // 路由模式后退到搜索页可能比模态更慢，给更长 timeout
    var feeds = await _waitForFeeds(routeMode ? 10000 : 6000);
    return !!feeds;
  }

  async function _extractDetailInline(note, progress) {
    var label = progress ? ('详情 ' + progress.i + '/' + progress.total) : '详情';
    // 1. 找卡片 anchor 并滚动到位 + 点击
    var anchor = _findCardAnchor(note.noteId);
    if (!anchor) {
      _vhud(label, note.noteId || '', 'anchor not found', 'error');
      return Object.assign({}, note, { detail: { ok: false, error: 'card_anchor_not_found' } });
    }
    _vhud(label, note.noteId || '', '点开', 'pending');
    _vflash(anchor, 'info', '点开');
    try { anchor.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
    await delay(250);
    try { anchor.click(); } catch (e) {
      _vhud(label, note.noteId || '', 'click failed', 'error');
      return Object.assign({}, note, { detail: { ok: false, error: 'click_failed', message: String(e && e.message || e) } });
    }
    // 2. 等 #noteContainer 或 .note-container（实测 xhs 常走新 route 而非模态）
    var container = await _waitFor('#noteContainer, .note-container, .note-content', 8000);
    if (!container) {
      // 路由跳走但容器没出现：回退一步并标记
      var routedAway = !/\/search_result/.test(location.pathname);
      try { window.history.back(); } catch (_) {}
      await _waitForFeeds(6000);
      return Object.assign({}, note, {
        detail: { ok: false, error: routedAway ? 'route_navigated' : 'no_note_container' },
      });
    }
    // 2.5 进一步等互动栏出现（这才是 stats / desc 真正稳定的标志）
    _vhud(label, note.noteId || '', '等互动栏', 'pending');
    await _waitFor('.engage-bar .like-wrapper, .like-wrapper .count', 3000);
    // 3. 抽取
    await _randomJitter(600, 1000);
    var extracted = _extractFromNoteContainer();
    var detailDetail = (extracted && extracted.ok)
      ? ('imgs=' + ((extracted.image_urls || []).length) + ' likes=' + ((extracted.stats && extracted.stats.likes) || 0))
      : 'extract_failed';
    _vhud(label, note.noteId || '', detailDetail, extracted && extracted.ok ? 'success' : 'warn');
    // 4. 关闭弹窗 / back
    _vhud(label, note.noteId || '', '回列表', 'pending');
    var backOk = await _backToList();
    if (!backOk) {
      _vhud(label, note.noteId || '', 'feeds 未恢复', 'warn');
      return Object.assign({}, note, {
        detail: Object.assign({}, extracted, { backWarning: 'feeds_not_restored' }),
      });
    }
    return Object.assign({}, note, { detail: extracted });
  }

  // ----- 主入口 -----

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

    // 1. 频道 Tab
    var ch = await _switchChannel(args.channelType || '全部');
    appliedFilters.channelType = ch.applied || (args.channelType || '全部');
    if (ch.error) appliedFilters.channelType_error = ch.error;

    // 2. 筛选面板（仅当任一筛选项需要）
    var needsPanel = !!(args.sortBy || args.contentType || args.timeRange || args.searchScope);
    var panelOpened = false;
    if (needsPanel) {
      var openRes = await _openFilterPanel();
      if (openRes.ok) {
        panelOpened = true;
        var groups = ['sortBy', 'contentType', 'timeRange', 'searchScope'];
        for (var fi = 0; fi < groups.length; fi++) {
          var gk = groups[fi];
          var fr = await _applyFilter(gk, args[gk]);
          appliedFilters[gk] = fr.applied || null;
          if (fr.error && args[gk]) appliedFilters[gk + '_error'] = fr.error;
          // 暴露 React 是否真的把 active 切到目标值（false-positive 排查用）
          if (args[gk] && fr.activated === false) appliedFilters[gk + '_activated'] = false;
        }
        await _closeFilterPanel();
      } else {
        appliedFilters.filterPanel_error = openRes.error || 'open_failed';
      }
    }

    await delay(800);

    // 3. 滚动收集
    var notes = await _scrollAndCollect(limit, 3);
    if (!notes.length) {
      return errResult('dom_extract_failed', { reason: 'no_notes', appliedFilters: appliedFilters });
    }

    // 4. extractDetails：同 tab + back 串行
    var detailsStats = null;
    if (args.extractDetails) {
      var detailsLimit = clampLimit(args.detailsLimit, notes.length, 20);
      detailsLimit = Math.min(detailsLimit, notes.length);
      var requested = detailsLimit;
      var succeeded = 0;
      var failed = 0;
      var enriched = [];
      for (var di = 0; di < notes.length; di++) {
        if (di >= detailsLimit) {
          enriched.push(notes[di]);
          continue;
        }
        var withDetail = await _extractDetailInline(notes[di], { i: di + 1, total: detailsLimit });
        enriched.push(withDetail);
        if (withDetail.detail && withDetail.detail.ok) succeeded++;
        else failed++;
        // 反爬抖动
        await _randomJitter(700, 1400);
      }
      notes = enriched;
      detailsStats = { requested: requested, succeeded: succeeded, failed: failed };
    }

    // 历史字段保形（小红书 SPA 实测：搜索结果页无独立 tab 切换器；联想/相关搜索 selector 易碎）
    var suggestKeywords = [];
    var relatedSearchKeywords = [];
    var searchTabs = [];

    return okResult({
      keyword: keyword,
      total: notes.length,
      notes: notes,
      searchTabs: searchTabs,
      suggestKeywords: suggestKeywords,
      relatedSearchKeywords: relatedSearchKeywords,
      appliedFilters: appliedFilters,
      filterPanelUsed: panelOpened,
      details: detailsStats,
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
