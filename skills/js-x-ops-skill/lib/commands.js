'use strict';

const { PAGE_PROFILES, DEFAULT_PAGE } = require('./config');
const targets = require('./toolTargets');

const READ_CMD_DEF = {
  search: {
    methodBase: 'search',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
  },
  profile: {
    methodBase: 'getProfile',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
  },
  post: {
    methodBase: 'getPost',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
  },
  home: {
    methodBase: 'getHome',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
  },
};

/**
 * COMMANDS 表（声明式）
 *
 * kind:
 *   - 'special':  在 cli/index.js 单独处理（doctor / dom-dump / xhr-log / 写操作 post）
 *   - 'call':     直接翻译为 `session.callApi(api, toArgs(opts, positional))`（不进 history）
 *   - 'tool':     走 lib/runTool.js（READ 档位，进 history + debug bundle）
 *   - 'navigate': INTERACTIVE 档位（仅 location.assign，不模拟点击）
 *
 * pages:        允许的 page profile 列表
 * defaultPage:  未显式 --page 时默认使用
 * toolName:     kind='tool' 时进 history 的工具名（也是 createRunContext.scrapeType）
 * targetUrl(opts, positional): kind='tool'/'navigate' 构造目标 URL
 */
const COMMANDS = {
  // ------------------------------------------------------------------
  // 特殊命令：在 cli/index.js 自己处理
  // ------------------------------------------------------------------
  doctor: {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '连通性 + 登录态 + bridge 注入 + probe + state 汇总（4 profile 一站诊断）',
  },
  'dom-dump': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] 当前 X 页面关键节点 outline（article[data-testid=tweet] / [data-testid=*]）；--anchors 附 a[href]',
  },
  'xhr-log': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] performance.getEntriesByType("resource") 中匹配 i/api/graphql 的请求；--filter <regex>',
  },

  // monitor 有独立 sub-arg parser（lib/monitor/dispatcher.js），在 cli/index.js 早于 parseArgv 分派
  monitor: {
    kind: 'special',
    argSpec: [],
    pages: [],
    defaultPage: null,
    help: 'X.com 账号监控：init/add/remove/list/status/test/check（详细 subcommand: `monitor --help`）',
  },

  // 写操作 post 入口（v2 行为，spawn scripts/x-post.js）
  // 当 positional[0] 是 URL/ID 且无写参数时，直接走 READ kind=tool 路径（见下面 post）。
  // 当带 --reply/--post/--quote/--thread/--media 等写参数时，cli/index.js 透传给 scripts/x-post.js。

  // ------------------------------------------------------------------
  // call: probe / state（开发者用，不进 history）
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // tool: READ 档位（进 history，AI 工具表会暴露）
  // ------------------------------------------------------------------
  'session-state': {
    kind: 'tool',
    toolName: 'x_session_state',
    api: 'sessionState',
    pages: ['home'],
    defaultPage: 'home',
    cmdDef: { legacyOnly: true },
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取 X 登录态（home-bridge.sessionState；未登录回 {loggedIn:false}）',
  },
  search: {
    kind: 'tool',
    toolName: 'x_search_tweets',
    api: 'search',
    cmdDef: READ_CMD_DEF.search,
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: true }],
    toArgs: (opts, positional) => [{
      keyword: positional[0],
      sort: opts.sort || 'top',
      readMode: opts.readMode || undefined,
      maxPages: opts.maxPages ? Number(opts.maxPages) : 1,
      lang: opts.lang || undefined,
      from: opts.from || undefined,
      since: opts.since || undefined,
      until: opts.until || undefined,
      minLikes: opts.minLikes ? Number(opts.minLikes) : 0,
      minRetweets: opts.minRetweets ? Number(opts.minRetweets) : 0,
      minReplies: opts.minReplies ? Number(opts.minReplies) : 0,
      excludeReplies: !!opts.excludeReplies,
      excludeRetweets: !!opts.excludeRetweets,
      hasLinks: !!opts.hasLinks,
    }],
    targetUrl: (opts, positional) => targets.searchUrl({ keyword: positional[0], sort: opts.sort }),
    help: '搜索：search <keyword> [--sort top|latest|media] [--max-pages N] [--lang ...] [--from <user>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--min-likes N] [--exclude-replies] [--exclude-retweets]',
  },
  profile: {
    kind: 'tool',
    toolName: 'x_get_profile',
    api: 'getProfile',
    cmdDef: READ_CMD_DEF.profile,
    pages: ['profile'],
    defaultPage: 'profile',
    argSpec: [{ name: 'username', required: true }],
    toArgs: (opts, positional) => [{
      username: positional[0],
      readMode: opts.readMode || undefined,
      maxPages: opts.maxPages ? Number(opts.maxPages) : 50,
      maxTweets: opts.maxTweets ? Number(opts.maxTweets) : 0,
      since: opts.since || undefined,
      until: opts.until || undefined,
      includeReplies: !!opts.includeReplies,
      includeRetweets: !!opts.includeRetweets,
      minLikes: opts.minLikes ? Number(opts.minLikes) : 0,
      minRetweets: opts.minRetweets ? Number(opts.minRetweets) : 0,
    }],
    targetUrl: (opts, positional) => targets.profileUrl({ username: positional[0] }),
    help: '用户主页：profile <username> [--max-pages N] [--max-tweets N] [--include-replies] [--include-retweets] [--min-likes N] [--since ...] [--until ...]',
  },
  post: {
    kind: 'tool',
    toolName: 'x_get_post',
    api: 'getPost',
    cmdDef: READ_CMD_DEF.post,
    pages: ['post'],
    defaultPage: 'post',
    // argSpec 只强约束 index 0；CLI 层额外接受 1..N 个 positional 转交给
    // lib/api.js::getPost(browser, tweetInputs, options)（它本就支持数组批量）。
    argSpec: [{ name: 'tweetUrl', required: true }],
    toArgs: (opts, positional) => [{
      url: positional[0],
      readMode: opts.readMode || undefined,
      withThread: !!opts.withThread,
      withReplies: opts.withReplies ? Number(opts.withReplies) : 0,
    }],
    targetUrl: (opts, positional) => targets.postUrl({ url: positional[0] }),
    help: '推文详情：post <tweetUrl|tweetId> [<tweetUrl|tweetId> ...] [--with-thread] [--with-replies N]（多个 id 批量，单条走 bridge；写操作 --reply/--post/--quote/--thread 走 v2 路径）',
  },
  home: {
    kind: 'tool',
    toolName: 'x_get_home_feed',
    api: 'getHome',
    cmdDef: READ_CMD_DEF.home,
    pages: ['home'],
    defaultPage: 'home',
    argSpec: [],
    toArgs: (opts) => [{
      feed: opts.feed || 'foryou',
      readMode: opts.readMode || undefined,
      maxPages: opts.maxPages ? Number(opts.maxPages) : 5,
      maxTweets: opts.maxTweets ? Number(opts.maxTweets) : 0,
      minLikes: opts.minLikes ? Number(opts.minLikes) : 0,
      minRetweets: opts.minRetweets ? Number(opts.minRetweets) : 0,
      excludeReplies: !!opts.excludeReplies,
      excludeRetweets: !!opts.excludeRetweets,
    }],
    targetUrl: () => targets.homeUrl(),
    help: '首页 Feed：home [--feed foryou|following] [--max-pages N] [--max-tweets N] [--min-likes N] [--exclude-replies] [--exclude-retweets]',
  },

  // ------------------------------------------------------------------
  // navigate: INTERACTIVE 档位（仅改 location，不模拟点击）
  // ------------------------------------------------------------------
  'navigate-search': {
    kind: 'navigate',
    toolName: 'x_navigate_search',
    api: 'navigateSearch',
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: false }],
    toNavArgs: (opts, positional) => ({
      keyword: positional[0],
      sort: opts.sort || undefined,
      lang: opts.lang || undefined,
    }),
    help: '导航到 X 搜索页：navigate-search <keyword> [--sort top|latest|media] [--lang ...]',
  },
  'navigate-profile': {
    kind: 'navigate',
    toolName: 'x_navigate_profile',
    api: 'navigateProfile',
    pages: ['profile'],
    defaultPage: 'profile',
    argSpec: [{ name: 'username', required: true }],
    toNavArgs: (opts, positional) => ({
      username: positional[0],
      tab: opts.userTab || undefined,
    }),
    help: '导航到 X 用户主页：navigate-profile <username> [--user-tab tweets|with_replies|media|likes|highlights]',
  },
  'navigate-post': {
    kind: 'navigate',
    toolName: 'x_navigate_post',
    api: 'navigatePost',
    pages: ['post'],
    defaultPage: 'post',
    argSpec: [{ name: 'tweetUrl', required: true }],
    toNavArgs: (opts, positional) => ({ url: positional[0] }),
    help: '导航到 X 推文详情：navigate-post <tweetUrl|tweetId>',
  },
  'navigate-home': {
    kind: 'navigate',
    toolName: 'x_navigate_home',
    api: 'navigateHome',
    pages: ['home'],
    defaultPage: 'home',
    argSpec: [],
    toNavArgs: (opts) => ({ feed: opts.feed || 'foryou' }),
    help: '导航到 X 首页：navigate-home [--feed foryou|following]',
  },
};

function parseArgv(argv) {
  const opts = {
    tab: null,
    page: null,
    output: null,
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
    maxPages: null,
    maxTweets: null,
    sort: null,
    lang: null,
    from: null,
    since: null,
    until: null,
    feed: null,
    userTab: null,
    minLikes: null,
    minRetweets: null,
    minReplies: null,
    excludeReplies: false,
    excludeRetweets: false,
    includeReplies: false,
    includeRetweets: false,
    hasLinks: false,
    withThread: false,
    withReplies: null,
    anchors: false,
    filter: null,
    limit: null,
    readMode: null,
    visual: undefined,
    visualDetail: null,
    visualMs: null,
    visualFlashMs: null,
    visualLingerMs: null,
    visualPinnedHold: null,
    visualErrorPin: undefined,
    visualScrollSettleMs: null,
    visualStaggerFadein: undefined,
    visualHud: undefined,
    visualFlash: undefined,
    visualMode: null,
    visualTrace: null,
    visualRecord: undefined,
    visualListStride: null,
    visualPrefix: null,
    noFrames: false,
    hiDpi: false,
    maxFrames: null,
    visualRecordFrames: null,
    visualFramesThrottle: null,
    redactRect: null,
    redactConfig: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (key) => { opts[key] = argv[++i]; };
    const eatEq = (key, prefix) => { opts[key] = a.slice(prefix.length); };
    if (a === '--json') opts.json = true;
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '--output') eat('output');
    else if (a.startsWith('--output=')) eatEq('output', '--output=');
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--debug-recording') opts.debugRecording = true;
    else if (a === '--no-cache') opts.noCache = true;
    else if (a === '--exclude-replies') opts.excludeReplies = true;
    else if (a === '--exclude-retweets') opts.excludeRetweets = true;
    else if (a === '--include-replies') opts.includeReplies = true;
    else if (a === '--include-retweets') opts.includeRetweets = true;
    else if (a === '--has-links') opts.hasLinks = true;
    else if (a === '--with-thread') opts.withThread = true;
    else if (a === '--anchors') opts.anchors = true;
    else if (a === '--filter') eat('filter');
    else if (a.startsWith('--filter=')) eatEq('filter', '--filter=');
    else if (a === '--read-mode') eat('readMode');
    else if (a.startsWith('--read-mode=')) eatEq('readMode', '--read-mode=');
    else if (a === '--mode' || a.startsWith('--mode=')) {
      // v3.2 BREAKING：runTool 路径选择 flag 重命名为 --read-mode（与 visual 的 --visual-* 解耦）。
      const err = new Error('--mode 已在 v3.2 重命名为 --read-mode（避免与 --visual-mode 概念混淆）');
      err.code = 'E_BAD_ARG';
      throw err;
    }
    else if (a === '--visual') opts.visual = true;
    else if (a === '--no-visual') opts.visual = false;
    else if (a === '--visual-detail') eat('visualDetail');
    else if (a.startsWith('--visual-detail=')) eatEq('visualDetail', '--visual-detail=');
    else if (a === '--visual-ms') eat('visualMs');
    else if (a.startsWith('--visual-ms=')) eatEq('visualMs', '--visual-ms=');
    // v0.7: 新 lifetime 旋钮
    else if (a === '--visual-flash-ms') eat('visualFlashMs');
    else if (a.startsWith('--visual-flash-ms=')) eatEq('visualFlashMs', '--visual-flash-ms=');
    else if (a === '--visual-linger-ms') eat('visualLingerMs');
    else if (a.startsWith('--visual-linger-ms=')) eatEq('visualLingerMs', '--visual-linger-ms=');
    else if (a === '--visual-pinned-hold') eat('visualPinnedHold');
    else if (a.startsWith('--visual-pinned-hold=')) eatEq('visualPinnedHold', '--visual-pinned-hold=');
    else if (a === '--visual-no-error-pin') opts.visualErrorPin = false;
    else if (a === '--visual-error-pin') opts.visualErrorPin = true;
    else if (a === '--visual-scroll-settle-ms') eat('visualScrollSettleMs');
    else if (a.startsWith('--visual-scroll-settle-ms=')) eatEq('visualScrollSettleMs', '--visual-scroll-settle-ms=');
    else if (a === '--visual-stagger-fadein') opts.visualStaggerFadein = true;
    else if (a === '--no-visual-stagger-fadein') opts.visualStaggerFadein = false;
    else if (a === '--visual-hud') opts.visualHud = true;
    else if (a === '--no-visual-hud') opts.visualHud = false;
    else if (a === '--visual-flash') opts.visualFlash = true;
    else if (a === '--no-visual-flash') opts.visualFlash = false;
    // v0.6.0 BREAKING：--visual-mode 仍记录到 opts，让 parseVisualFlags 进 deprecatedFlags
    // 走 stderr 一次性告警；不再下发到 bridge config。
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
    else if (a === '--no-frames') opts.noFrames = true;
    else if (a === '--hi-dpi') opts.hiDpi = true;
    else if (a === '--max-frames') eat('maxFrames');
    else if (a.startsWith('--max-frames=')) eatEq('maxFrames', '--max-frames=');
    else if (a === '--visual-list-stride') eat('visualListStride');
    else if (a.startsWith('--visual-list-stride=')) eatEq('visualListStride', '--visual-list-stride=');
    else if (a === '--visual-prefix') eat('visualPrefix');
    else if (a.startsWith('--visual-prefix=')) eatEq('visualPrefix', '--visual-prefix=');
    else if (a === '--visual-record-frames') opts.visualRecordFrames = true;
    else if (a === '--no-visual-record-frames') opts.visualRecordFrames = false;
    else if (a === '--visual-frames-throttle') eat('visualFramesThrottle');
    else if (a.startsWith('--visual-frames-throttle=')) eatEq('visualFramesThrottle', '--visual-frames-throttle=');
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
    else if (a === '--max-pages') eat('maxPages');
    else if (a.startsWith('--max-pages=')) eatEq('maxPages', '--max-pages=');
    else if (a === '--max-tweets') eat('maxTweets');
    else if (a.startsWith('--max-tweets=')) eatEq('maxTweets', '--max-tweets=');
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--sort') eat('sort');
    else if (a.startsWith('--sort=')) eatEq('sort', '--sort=');
    else if (a === '--lang') eat('lang');
    else if (a.startsWith('--lang=')) eatEq('lang', '--lang=');
    else if (a === '--from') eat('from');
    else if (a.startsWith('--from=')) eatEq('from', '--from=');
    else if (a === '--since') eat('since');
    else if (a.startsWith('--since=')) eatEq('since', '--since=');
    else if (a === '--until') eat('until');
    else if (a.startsWith('--until=')) eatEq('until', '--until=');
    else if (a === '--feed') eat('feed');
    else if (a.startsWith('--feed=')) eatEq('feed', '--feed=');
    else if (a === '--user-tab') eat('userTab');
    else if (a.startsWith('--user-tab=')) eatEq('userTab', '--user-tab=');
    else if (a === '--min-likes') eat('minLikes');
    else if (a.startsWith('--min-likes=')) eatEq('minLikes', '--min-likes=');
    else if (a === '--min-retweets') eat('minRetweets');
    else if (a.startsWith('--min-retweets=')) eatEq('minRetweets', '--min-retweets=');
    else if (a === '--min-replies') eat('minReplies');
    else if (a.startsWith('--min-replies=')) eatEq('minReplies', '--min-replies=');
    else if (a === '--with-replies') eat('withReplies');
    else if (a.startsWith('--with-replies=')) eatEq('withReplies', '--with-replies=');
    else if (a.startsWith('-')) {
      // 未知 option（写操作的 --reply/--post/--quote/--thread/--media/--dry-run/--confirm 走 v2 path 在 cli/index.js 直接 spawn）
      const err = new Error(`unknown option: ${a}（运行 \`node index.js --help\` 查看）`);
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
    'js-x-ops-skill - X.com (Twitter) 内容读取工具（READ + INTERACTIVE，写帖留 v3.1）',
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
    lines.push(`  ${name.padEnd(18)} ${args.padEnd(14)} ${(def.help || '') + pageHint}`);
  }
  lines.push(
    '',
    'Options:',
    `  --page <name>            page profile (${pageList}; 默认按 command 推导，fallback 到 ${DEFAULT_PAGE})`,
    '  --tab <id>               强制指定浏览器 tab id（默认按 page profile 评分匹配）',
    '  --max-pages <n>          翻页数上限',
    '  --max-tweets <n>         返回推文数上限（0 = 不限）',
    '  --sort <name>            搜索排序 top|latest|media',
    '  --feed <name>            首页 feed foryou|following',
    '  --user-tab <name>        用户子页 tweets|with_replies|media|likes|highlights',
    '  --since/--until YYYY-MM-DD   日期范围',
    '  --lang <code>            语言过滤',
    '  --from <user>            指定作者',
    '  --min-likes/--min-retweets/--min-replies <n>  互动数过滤',
    '  --exclude-replies/--exclude-retweets/--include-replies/--include-retweets',
    '  --with-thread / --with-replies <n>            post 命令选项',
    '  --read-mode auto|graphql|dom   READ：auto=GraphQL 优先再 DOM（v3.2 由 --mode 重命名而来，与 visual-* 解耦）',
    '  --visual / --no-visual / --visual-hud / --visual-flash / --visual-record / --visual-trace …  见 visual-bridge-kit',
    '  --pretty                 JSON 缩进 2 空格输出',
    '  --output <file>          同时将 JSON 结果写入文件（与 stdout 内容一致；目录不存在会自动创建）',
    '  -v, --verbose            session 流转日志输出到 stderr',
    '  --server <ws-url>        js-eyes WS endpoint（默认 ws://localhost:18080）',
    '  --recording-mode <mode>  off|history|standard|debug',
    '  --debug-recording        强制写 debug bundle',
    '  -h, --help               显示帮助',
    '',
    '示例:',
    '  node index.js search "AI agent" --sort top --max-pages 1',
    '  node index.js profile elonmusk --max-pages 2 --include-replies',
    '  node index.js post https://x.com/user/status/123',
    '  node index.js home --feed foryou --max-pages 1',
    '  node index.js session-state --pretty',
    '  node index.js doctor --pretty',
    '',
    '  # INTERACTIVE 档（仅改 URL，不模拟点击）',
    '  node index.js navigate-search "AI agent" --sort latest',
    '  node index.js navigate-profile elonmusk --user-tab media',
    '  node index.js navigate-post https://x.com/user/status/123',
    '  node index.js navigate-home --feed following',
    '',
    '  # 写操作（透传 v2 scripts/x-post.js，v3.1 拆 compose-bridge）',
    '  node index.js post --post "hello world" --dry-run',
    '  node index.js post https://x.com/user/status/123 --reply "test" --dry-run',
    '',
    '注意:',
    '  * READ 档不模拟点击 / 不改 DOM；INTERACTIVE 档只通过 location.assign 改 URL',
    '  * 写操作（--reply/--post/--quote/--thread/--media）会透传到 scripts/x-post.js（v2 行为）',
    '  * 设 JS_X_DISABLE_BRIDGE=1 强制走老路径；JS_X_DISABLE_FALLBACK=1 让 bridge 失败直接抛错',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

// 写操作识别（用于在 cli/index.js 决定是否透传给 scripts/x-post.js）
const WRITE_FLAGS = new Set([
  '--reply', '--post', '--quote', '--thread', '--media',
  '--dry-run', '--confirm',
]);

function hasWriteFlags(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (WRITE_FLAGS.has(a)) return true;
    for (const f of WRITE_FLAGS) {
      if (a.startsWith(f + '=')) return true;
    }
  }
  return false;
}

module.exports = { COMMANDS, READ_CMD_DEF, parseArgv, printHelp, hasWriteFlags };
