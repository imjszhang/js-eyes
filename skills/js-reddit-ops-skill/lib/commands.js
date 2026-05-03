'use strict';

const { PAGE_PROFILES, DEFAULT_PAGE } = require('./config');
const targets = require('./toolTargets');

/**
 * COMMANDS 表
 *
 * kind:
 *   - 'special': 在 cli/index.js 单独处理（post / doctor / 后续 navigate 系列）
 *   - 'call':    直接翻译为 `session.callApi(api, toArgs(opts, positional))`
 *   - 'tool':    走 lib/runTool.js，进 history + debug bundle
 *
 * `pages`: 该命令允许的 page profile 列表
 * `defaultPage`: 未显式 --page 时默认使用的 page profile
 * `toolName`: kind='tool' 时进 history 的工具名（也是 createRunContext.scrapeType）
 * `targetUrl(opts, positional)`: kind='tool' 时构造目标 URL（用于 createUrl 兜底；
 *      默认 navigateOnReuse=false，所以现有 reddit tab 不会被切走）
 */
const COMMANDS = {
  post: {
    kind: 'special',
    argSpec: [{ name: 'url', required: true }],
    pages: ['post'],
    defaultPage: 'post',
    help: '读取 Reddit 帖子详情（bridge 主路径，DOM 兜底）',
  },
  doctor: {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    help: '连通性 + 登录态 + bridge 注入 + probe + state 汇总（诊断）',
  },
  probe: {
    kind: 'call',
    api: 'probe',
    argSpec: [],
    toArgs: () => [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '采集页面指纹（按 page profile）',
  },
  state: {
    kind: 'call',
    api: 'state',
    argSpec: [],
    toArgs: () => [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '读取当前 page profile 状态',
  },
  'session-state': {
    kind: 'tool',
    toolName: 'reddit_session_state',
    api: 'sessionState',
    pages: ['home'],
    defaultPage: 'home',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取登录态（/api/v1/me.json，未登录回 {loggedIn:false}）',
  },
  'list-subreddit': {
    kind: 'tool',
    toolName: 'reddit_list_subreddit',
    api: 'listSubreddit',
    pages: ['subreddit'],
    defaultPage: 'subreddit',
    // v3.7.0 dom-first：bridge 同时暴露 dom_listSubreddit / api_listSubreddit
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [{ name: 'sub', required: true }],
    toArgs: (opts, positional) => [{
      sub: positional[0],
      sort: opts.sort || 'hot',
      t: opts.timeRange || undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      after: opts.after || undefined,
    }],
    targetUrl: (opts, positional) => targets.listSubredditUrl({ sub: positional[0], sort: opts.sort }),
    help: '列出 subreddit 内帖子：list-subreddit <sub> [--sort hot|new|top|rising] [--time-range day|week|...] [--limit N] [--after t3_xxx]',
  },
  'get-post': {
    kind: 'tool',
    toolName: 'reddit_get_post',
    api: 'getPost',
    pages: ['post'],
    defaultPage: 'post',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [{ name: 'url', required: true }],
    toArgs: (opts, positional) => [{
      url: positional[0],
      permalink: opts.permalink || undefined,
      depth: opts.depth ? Number(opts.depth) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      sort: opts.sort || undefined,
    }],
    targetUrl: (opts, positional) => targets.postUrl({
      url: positional[0],
      permalink: opts.permalink,
    }),
    help: '帖子详情（v3.7.0 dom-first 入口，走 runTool dispatch + --mode）：get-post <url> [--depth N] [--limit N] [--sort top|...] [--mode dom|api|auto]',
  },
  'subreddit-about': {
    kind: 'tool',
    toolName: 'reddit_subreddit_about',
    api: 'subredditAbout',
    pages: ['subreddit'],
    defaultPage: 'subreddit',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [{ name: 'sub', required: true }],
    toArgs: (opts, positional) => [{ sub: positional[0] }],
    targetUrl: (opts, positional) => targets.subredditAboutUrl({ sub: positional[0] }),
    help: '读取 subreddit 元信息：subreddit-about <sub>',
  },
  search: {
    kind: 'tool',
    toolName: 'reddit_search',
    api: 'search',
    pages: ['search'],
    defaultPage: 'search',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [{ name: 'q', required: true }],
    toArgs: (opts, positional) => [{
      q: positional[0],
      sort: opts.sort || 'relevance',
      t: opts.timeRange || 'all',
      type: opts.searchType || 'link',
      restrictSr: !!opts.sub,
      sub: opts.sub || undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      after: opts.after || undefined,
    }],
    targetUrl: (opts, positional) => targets.searchUrl({
      q: positional[0],
      sort: opts.sort,
      t: opts.timeRange,
      sub: opts.sub,
      restrictSr: !!opts.sub,
    }),
    help: '搜索：search <q> [--sort relevance|hot|top|new|comments] [--time-range hour|day|...] [--search-type link|sr|user] [--sub <sub>] [--limit N] [--after ...]',
  },
  'user-profile': {
    kind: 'tool',
    toolName: 'reddit_user_profile',
    api: 'userProfile',
    pages: ['user'],
    defaultPage: 'user',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [{ name: 'name', required: true }],
    toArgs: (opts, positional) => [{
      name: positional[0],
      tab: opts.userTab || 'overview',
      sort: opts.sort || 'new',
      t: opts.timeRange || 'all',
      limit: opts.limit ? Number(opts.limit) : undefined,
      after: opts.after || undefined,
    }],
    targetUrl: (opts, positional) => targets.userProfileUrl({ name: positional[0], tab: opts.userTab }),
    help: '读取 user 页：user-profile <name> [--user-tab overview|submitted|comments|saved|upvoted|downvoted|hidden] [--sort ...] [--limit N]',
  },
  'inbox-list': {
    kind: 'tool',
    toolName: 'reddit_inbox_list',
    api: 'inboxList',
    pages: ['inbox'],
    defaultPage: 'inbox',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [],
    toArgs: (opts) => [{
      box: opts.box || 'inbox',
      limit: opts.limit ? Number(opts.limit) : undefined,
      after: opts.after || undefined,
    }],
    targetUrl: (opts) => targets.inboxListUrl({ box: opts.box }),
    help: '读取私信/通知（必须已登录）：inbox-list [--box inbox|unread|messages|mentions|sent] [--limit N]',
  },
  'my-feed': {
    kind: 'tool',
    toolName: 'reddit_my_feed',
    api: 'myFeed',
    pages: ['home'],
    defaultPage: 'home',
    domSupported: true,
    apiSupported: true,
    defaultMode: 'auto',
    argSpec: [],
    toArgs: (opts) => [{
      feed: opts.feed || 'home',
      sort: opts.sort || 'best',
      t: opts.timeRange || undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      after: opts.after || undefined,
    }],
    targetUrl: (opts) => targets.myFeedUrl({ feed: opts.feed, sort: opts.sort }),
    help: '主 feed：my-feed [--feed home|popular|all] [--sort best|hot|new|top|rising] [--time-range ...] [--limit N]',
  },
  'expand-more': {
    kind: 'tool',
    toolName: 'reddit_expand_more',
    api: 'expandMore',
    pages: ['post'],
    defaultPage: 'post',
    argSpec: [
      { name: 'linkId', required: true },
      { name: 'children', required: true },
    ],
    toArgs: (opts, positional) => [{
      linkId: positional[0],
      children: positional[1],
      sort: opts.sort || 'top',
      depth: opts.depth ? Number(opts.depth) : undefined,
      limitChildren: opts.limit ? Number(opts.limit) : undefined,
    }],
    targetUrl: () => null,
    help: '展开评论树 more 节点：expand-more <t3_linkId> <child_ids,csv> [--sort top|best|...] [--depth N] [--limit N]',
  },

  'navigate-post': {
    kind: 'navigate',
    toolName: 'reddit_navigate_post',
    api: 'navigatePost',
    pages: ['post'],
    defaultPage: 'post',
    argSpec: [{ name: 'url', required: true }],
    toNavArgs: (opts, positional) => ({ url: positional[0] }),
    help: '导航到 Reddit 帖子（仅 location.assign）：navigate-post <url>',
  },
  'navigate-subreddit': {
    kind: 'navigate',
    toolName: 'reddit_navigate_subreddit',
    api: 'navigateSubreddit',
    pages: ['subreddit'],
    defaultPage: 'subreddit',
    argSpec: [{ name: 'sub', required: true }],
    toNavArgs: (opts, positional) => ({ sub: positional[0], sort: opts.sort, t: opts.timeRange, about: !!opts.about }),
    help: '导航到 subreddit：navigate-subreddit <sub> [--sort hot|...] [--time-range ...] [--about]',
  },
  'navigate-search': {
    kind: 'navigate',
    toolName: 'reddit_navigate_search',
    api: 'navigateSearch',
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'q', required: false }],
    toNavArgs: (opts, positional) => ({
      q: positional[0],
      sort: opts.sort,
      t: opts.timeRange,
      type: opts.searchType,
      sub: opts.sub,
      restrictSr: !!opts.sub,
      clear: opts.clear === true,
    }),
    help: '导航到 search 页：navigate-search <q> [--sort ...] [--time-range ...] [--search-type ...] [--sub <sub>] [--clear]',
  },
  'navigate-user': {
    kind: 'navigate',
    toolName: 'reddit_navigate_user',
    api: 'navigateUser',
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'name', required: true }],
    toNavArgs: (opts, positional) => ({ name: positional[0], tab: opts.userTab }),
    help: '导航到 user 页：navigate-user <name> [--user-tab overview|submitted|...]',
  },
  'navigate-inbox': {
    kind: 'navigate',
    toolName: 'reddit_navigate_inbox',
    api: 'navigateInbox',
    pages: ['inbox'],
    defaultPage: 'inbox',
    argSpec: [],
    toNavArgs: (opts) => ({ box: opts.box || 'inbox' }),
    help: '导航到收件箱：navigate-inbox [--box inbox|unread|messages|mentions|sent]',
  },
  'navigate-home': {
    kind: 'navigate',
    toolName: 'reddit_navigate_home',
    api: 'navigateHome',
    pages: ['home'],
    defaultPage: 'home',
    argSpec: [],
    toNavArgs: (opts) => ({ feed: opts.feed || 'home', sort: opts.sort, t: opts.timeRange }),
    help: '导航到 home / popular / all：navigate-home [--feed home|popular|all] [--sort ...]',
  },

  // ---- 内部踩点 CLI（不进 TOOL_DEFINITIONS，不暴露给 AI 直接调用）----
  'dom-dump': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] 当前 reddit 页面关键节点 outline（[data-testid] / shreddit-post / [id^=thing_] / a[href]）；--anchors 附 a[href]',
  },
  'xhr-log': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] performance.getEntriesByType("resource") 中匹配 reddit.com 的请求；--filter <regex> 自定义过滤',
  },
};

function parseArgv(argv) {
  const opts = {
    tab: null,
    page: null,
    json: false,
    pretty: false,
    verbose: false,
    help: false,
    wsEndpoint: null,
    recordingMode: null,
    recordingBaseDir: null,
    runId: null,
    debugRecording: false,
    noCache: false,
    depth: null,
    limit: null,
    sort: null,
    timeRange: null,
    after: null,
    sub: null,
    box: null,
    feed: null,
    userTab: null,
    searchType: null,
    about: false,
    clear: false,
    anchors: false,
    filter: null,
    visual: undefined,
    visualDetail: null,
    visualMs: null,
    visualMode: null,
    visualTrace: null,
    visualListStride: null,
    visualPrefix: null,
    // v3.7.0 dom-first：dom|api|auto；null 时落入 cmdDef.defaultMode || 'auto'
    mode: null,
    // deprecated（post-2.7.0 architecture pivot）：仍解析但不下发，CLI 启动时通过
    // cliVisualFlags.warnDeprecatedFlagsOnce 打一次告警。
    redactRect: null,
    redactSelector: null,
    redactConfig: null,
    visualRecordFrames: null,
    visualFramesThrottle: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (key) => { opts[key] = argv[++i]; };
    const eatEq = (key, prefix) => { opts[key] = a.slice(prefix.length); };
    if (a === '--json') opts.json = true;
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--debug-recording') opts.debugRecording = true;
    else if (a === '--no-cache') opts.noCache = true;
    else if (a === '--about') opts.about = true;
    else if (a === '--clear') opts.clear = true;
    else if (a === '--anchors') opts.anchors = true;
    else if (a === '--filter') eat('filter');
    else if (a.startsWith('--filter=')) eatEq('filter', '--filter=');
    else if (a === '--tab') eat('tab');
    else if (a.startsWith('--tab=')) eatEq('tab', '--tab=');
    else if (a === '--page') eat('page');
    else if (a.startsWith('--page=')) eatEq('page', '--page=');
    else if (a === '--server' || a === '--ws-endpoint' || a === '--browser-server') eat('wsEndpoint');
    else if (a.startsWith('--server=') || a.startsWith('--ws-endpoint=') || a.startsWith('--browser-server=')) {
      opts.wsEndpoint = a.slice(a.indexOf('=') + 1);
    } else if (a === '--recording-mode') eat('recordingMode');
    else if (a.startsWith('--recording-mode=')) eatEq('recordingMode', '--recording-mode=');
    else if (a === '--recording-base-dir') eat('recordingBaseDir');
    else if (a.startsWith('--recording-base-dir=')) eatEq('recordingBaseDir', '--recording-base-dir=');
    else if (a === '--run-id') eat('runId');
    else if (a.startsWith('--run-id=')) eatEq('runId', '--run-id=');
    else if (a === '--depth') eat('depth');
    else if (a.startsWith('--depth=')) eatEq('depth', '--depth=');
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--sort') eat('sort');
    else if (a.startsWith('--sort=')) eatEq('sort', '--sort=');
    else if (a === '--time-range' || a === '--t') eat('timeRange');
    else if (a.startsWith('--time-range=')) eatEq('timeRange', '--time-range=');
    else if (a === '--after') eat('after');
    else if (a.startsWith('--after=')) eatEq('after', '--after=');
    else if (a === '--sub') eat('sub');
    else if (a.startsWith('--sub=')) eatEq('sub', '--sub=');
    else if (a === '--box') eat('box');
    else if (a.startsWith('--box=')) eatEq('box', '--box=');
    else if (a === '--feed') eat('feed');
    else if (a.startsWith('--feed=')) eatEq('feed', '--feed=');
    else if (a === '--user-tab') eat('userTab');
    else if (a.startsWith('--user-tab=')) eatEq('userTab', '--user-tab=');
    else if (a === '--search-type') eat('searchType');
    else if (a.startsWith('--search-type=')) eatEq('searchType', '--search-type=');
    else if (a === '--visual') opts.visual = true;
    else if (a === '--no-visual') opts.visual = false;
    else if (a === '--visual-detail') eat('visualDetail');
    else if (a.startsWith('--visual-detail=')) eatEq('visualDetail', '--visual-detail=');
    else if (a === '--visual-ms') eat('visualMs');
    else if (a.startsWith('--visual-ms=')) eatEq('visualMs', '--visual-ms=');
    else if (a === '--visual-mode') eat('visualMode');
    else if (a.startsWith('--visual-mode=')) eatEq('visualMode', '--visual-mode=');
    else if (a === '--visual-trace') eat('visualTrace');
    else if (a.startsWith('--visual-trace=')) eatEq('visualTrace', '--visual-trace=');
    else if (a === '--visual-record') {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) { opts.visualRecord = next; i += 1; }
      else { opts.visualRecord = true; }
    }
    else if (a.startsWith('--visual-record=')) eatEq('visualRecord', '--visual-record=');
    else if (a === '--no-visual-record') opts.visualRecord = false;
    else if (a === '--visual-list-stride') eat('visualListStride');
    else if (a.startsWith('--visual-list-stride=')) eatEq('visualListStride', '--visual-list-stride=');
    else if (a === '--visual-prefix') eat('visualPrefix');
    else if (a.startsWith('--visual-prefix=')) eatEq('visualPrefix', '--visual-prefix=');
    else if (a === '--mode') eat('mode');
    else if (a.startsWith('--mode=')) eatEq('mode', '--mode=');
    else if (a === '--redact-rect') {
      opts.redactRect = opts.redactRect || [];
      opts.redactRect.push(argv[++i]);
    }
    else if (a.startsWith('--redact-rect=')) {
      opts.redactRect = opts.redactRect || [];
      opts.redactRect.push(a.slice('--redact-rect='.length));
    }
    else if (a === '--redact-selector') {
      opts.redactSelector = opts.redactSelector || [];
      opts.redactSelector.push(argv[++i]);
    }
    else if (a.startsWith('--redact-selector=')) {
      opts.redactSelector = opts.redactSelector || [];
      opts.redactSelector.push(a.slice('--redact-selector='.length));
    }
    else if (a === '--redact-config') eat('redactConfig');
    else if (a.startsWith('--redact-config=')) eatEq('redactConfig', '--redact-config=');
    // deprecated PNG-mode toggles：仍解析以兼容历史脚本（不报 unknown option）
    else if (a === '--visual-record-frames') opts.visualRecordFrames = true;
    else if (a === '--no-visual-record-frames') opts.visualRecordFrames = false;
    else if (a === '--visual-frames-throttle') eat('visualFramesThrottle');
    else if (a.startsWith('--visual-frames-throttle=')) eatEq('visualFramesThrottle', '--visual-frames-throttle=');
    else if (a.startsWith('-')) {
      const err = new Error(
        `unknown option: ${a}（运行 \`node index.js --help\` 查看可用选项）`,
      );
      err.code = 'E_BAD_ARG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function printHelp() {
  const pageList = Object.keys(PAGE_PROFILES).join(' | ');
  const lines = [
    'js-reddit-ops-skill - Reddit 内容读取工具（READ + INTERACTIVE，不写任何业务数据）',
    '',
    'Usage: node index.js <command> [args] [options]',
    '',
    'Commands:',
  ];
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = (def.argSpec || []).map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`)).join(' ');
    const pageHint = def.defaultPage
      ? ` [page=${def.defaultPage}]`
      : (def.pages && def.pages.length === 1 ? ` [page=${def.pages[0]}]` : '');
    lines.push(`  ${name.padEnd(16)} ${args.padEnd(12)} ${(def.help || '') + pageHint}`);
  }
  lines.push(
    '',
    'Options:',
    `  --page <name>            page profile (${pageList}; 默认按 command 推导，fallback 到 ${DEFAULT_PAGE})`,
    '  --tab <id>               强制指定浏览器 tab id（默认按 page profile 评分匹配）',
    '  --depth <n>              评论深度（post 命令）',
    '  --limit <n>              列表/评论条数上限',
    '  --after <fullname>       列表分页游标（如 t3_xxx）',
    '  --sort <name>            排序：post 评论 top|best|new|...; listing hot|new|top|...',
    '  --time-range <t>         hour|day|week|month|year|all (top/controversial 排序生效)',
    '  --sub <name>             subreddit 名（用于 search 限定）',
    '  --search-type <t>        link|sr|user (search 命令)',
    '  --box <name>             inbox|unread|messages|mentions|sent (inbox-list)',
    '  --feed <name>            home|popular|all (my-feed)',
    '  --user-tab <name>        overview|submitted|comments|saved|upvoted|downvoted|hidden',
    '  --pretty                 JSON 缩进 2 空格输出',
    '  -v, --verbose            session 流转日志输出到 stderr',
    '  --visual                 开启页面内视觉反馈（默认开）',
    '  --no-visual              关闭页面内视觉反馈',
    '  --visual-detail <lvl>    compact | staged（默认 staged）',
    '  --visual-ms <n>          flash 持续时长 ms（默认 420）',
    '  --visual-mode <m>        auto | dom | hud | both | off（默认 auto）',
    '  --visual-trace <file>    把视觉事件写入 jsonl（每次工具调用追加一行）',
    '  --visual-record [dir]    把事件落到会话包目录（meta+events+frames，给 hyperframes 渲视频）',
    '  --no-visual-record       显式关闭会话包',
    '  --visual-list-stride <ms> 列表呼吸感步进 ms（默认 90）',
    '  --visual-prefix <p>      DOM id 前缀（默认 __jse_reddit_visual_）',
    '  --mode <dom|api|auto>    执行模式（默认 auto：dom 优先，失败回退 api）；仅在 bridge 暴露 dom_<name> 时生效',
    '',
    '  # post-2.7.0 architecture pivot：以下 flag 已废弃（仍接受，不报错也不生效）',
    '  --redact-rect / --redact-selector / --redact-config <path>',
    '  --visual-record-frames / --visual-frames-throttle <n>',
    '  --server <ws-url>        js-eyes WS endpoint（默认 ws://localhost:18080，可用 JS_EYES_SERVER_URL 覆盖）',
    '  --recording-mode <mode>  off|history|standard|debug',
    '  --debug-recording        强制写 debug bundle',
    '  --no-cache               禁用 cache 命中（仅 post 命令；其它工具默认无 cache）',
    '  -h, --help               显示帮助',
    '',
    '示例:',
    '  node index.js post https://www.reddit.com/r/programming/comments/abc/title/',
    '  node index.js expand-more t3_abcd "child1,child2,child3" --sort top',
    '  node index.js list-subreddit programming --sort hot --limit 25',
    '  node index.js subreddit-about programming',
    '  node index.js search "node.js" --sort top --time-range week --limit 25',
    '  node index.js user-profile spez --user-tab overview',
    '  node index.js inbox-list --box unread',
    '  node index.js my-feed --feed popular --sort hot',
    '  node index.js session-state',
    '  node index.js doctor',
    '',
    '  # INTERACTIVE 档（仅改浏览器 URL，不模拟点击）',
    '  node index.js navigate-subreddit programming --sort top --time-range week',
    '  node index.js navigate-post https://www.reddit.com/r/programming/comments/abc/title/',
    '  node index.js navigate-search "node.js" --sub programming',
    '  node index.js navigate-user spez --user-tab overview',
    '  node index.js navigate-inbox --box unread',
    '  node index.js navigate-home --feed popular',
    '',
    '注意:',
    '  * READ 档不模拟点击 / 不改 DOM；INTERACTIVE 档只通过 location.assign 改 URL',
    '  * 永不执行 vote / submit / comment / edit / delete / save / subscribe / send_message / report',
    '  * 设 JS_REDDIT_DISABLE_BRIDGE=1 强制走 DOM 兜底；JS_REDDIT_DISABLE_FALLBACK=1 让 bridge 失败直接抛错',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, parseArgv, printHelp };
