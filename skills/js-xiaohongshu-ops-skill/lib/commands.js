'use strict';

const { PAGE_PROFILES, DEFAULT_PAGE } = require('./config');
const targets = require('./toolTargets');

const READ_CMD_DEF = {
  note: {
    methodBase: 'getNote',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
  },
  comments: {
    methodBase: 'getComments',
    domSupported: false,
    apiSupported: true,
    defaultReadMode: 'api',
  },
  search: {
    methodBase: 'search',
    domSupported: true,
    apiSupported: false,
    defaultReadMode: 'dom',
  },
  user: {
    methodBase: 'getUser',
    domSupported: true,
    apiSupported: false,
    defaultReadMode: 'dom',
  },
  userNotes: {
    methodBase: 'getUserNotes',
    domSupported: true,
    apiSupported: false,
    defaultReadMode: 'dom',
  },
};

/**
 * COMMANDS 表（声明式）
 *   - 'special':  在 cli/index.js 单独处理（doctor / dom-dump / xhr-log / monitor）
 *   - 'call':     直接 `session.callApi(api, toArgs(opts, positional))`（不进 history）
 *   - 'tool':     走 lib/runTool.js（READ 档位，进 history + debug bundle）
 *   - 'navigate': INTERACTIVE 档位（仅 location.assign，不模拟点击）
 */
const COMMANDS = {
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
    help: '[内部] 当前 xhs 页面关键节点 outline（#noteContainer / .feeds-container 等）',
  },
  monitor: {
    kind: 'special',
    argSpec: [],
    pages: [],
    defaultPage: null,
    help: '小红书账号/关键词监控：init/add/remove/list/status/test/check/daemon/stop',
  },
  login: {
    kind: 'special',
    argSpec: [],
    pages: ['home'],
    defaultPage: 'home',
    help: '引导登录：navigate 到登录页 + 等待 web_session cookie 出现（仅 CLI，不进 AI tool）',
  },
  records: {
    kind: 'special',
    argSpec: [],
    pages: [],
    defaultPage: null,
    help: '查看最近的 records：records [--last N] [--tool xhs_get_note]',
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

  // ------------- READ 档位 -------------
  'session-state': {
    kind: 'tool',
    toolName: 'xhs_session_state',
    api: 'sessionState',
    pages: ['home'],
    defaultPage: 'home',
    cmdDef: { legacyOnly: true },
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取 xhs 登录态（home-bridge.sessionState）',
  },
  note: {
    kind: 'tool',
    toolName: 'xhs_get_note',
    api: 'getNote',
    cmdDef: READ_CMD_DEF.note,
    pages: ['note'],
    defaultPage: 'note',
    argSpec: [{ name: 'urlOrId', required: true }],
    toArgs: (opts, positional) => [{
      url: positional[0],
      readMode: opts.readMode || undefined,
      withComments: !!opts.withComments,
      maxCommentPages: opts.maxCommentPages ? Number(opts.maxCommentPages) : 0,
    }],
    targetUrl: (opts, positional) => targets.noteUrl({ url: positional[0] }),
    help: '笔记详情：note <url|id> [--with-comments] [--max-comment-pages N]',
  },
  comments: {
    kind: 'tool',
    toolName: 'xhs_get_note_comments',
    api: 'getComments',
    cmdDef: READ_CMD_DEF.comments,
    pages: ['note'],
    defaultPage: 'note',
    argSpec: [{ name: 'urlOrId', required: true }],
    toArgs: (opts, positional) => [{
      url: positional[0],
      maxCommentPages: opts.maxCommentPages ? Number(opts.maxCommentPages) : 1,
    }],
    targetUrl: (opts, positional) => targets.noteUrl({ url: positional[0] }),
    help: '评论分页：comments <url|id> [--max-comment-pages N]',
  },
  search: {
    kind: 'tool',
    toolName: 'xhs_search_notes',
    api: 'search',
    cmdDef: READ_CMD_DEF.search,
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: true }],
    toArgs: (opts, positional) => [{
      keyword: positional[0],
      limit: opts.limit ? Number(opts.limit) : 10,
      channelType: opts.channelType || '全部',
      sortBy: opts.sortBy || undefined,
      contentType: opts.contentType || undefined,
      timeRange: opts.timeRange || undefined,
      searchScope: opts.searchScope || undefined,
      extractDetails: !!opts.extractDetails,
      detailsLimit: opts.detailsLimit ? Number(opts.detailsLimit) : undefined,
      readMode: opts.readMode || undefined,
    }],
    targetUrl: (opts, positional) => targets.searchUrl({ keyword: positional[0] }),
    help: '搜索：search <keyword> [--limit N] [--channel-type 全部|图文|视频|用户] [--sort-by ...] [--extract-details [--details-limit N]]',
  },
  user: {
    kind: 'tool',
    toolName: 'xhs_get_user',
    api: 'getUser',
    cmdDef: READ_CMD_DEF.user,
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'userId', required: true }],
    toArgs: (opts, positional) => [{ userId: positional[0] }],
    targetUrl: (opts, positional) => targets.userUrl({ userId: positional[0] }),
    help: '用户主页：user <userId>',
  },
  'user-notes': {
    kind: 'tool',
    toolName: 'xhs_get_user_notes',
    api: 'getUserNotes',
    cmdDef: READ_CMD_DEF.userNotes,
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'userId', required: true }],
    toArgs: (opts, positional) => [{
      userId: positional[0],
      maxPages: opts.maxPages ? Number(opts.maxPages) : 3,
    }],
    targetUrl: (opts, positional) => targets.userUrl({ userId: positional[0] }),
    help: '用户笔记列表：user-notes <userId> [--max-pages N]',
  },

  // ------------- INTERACTIVE 档位 -------------
  'navigate-note': {
    kind: 'navigate',
    toolName: 'xhs_navigate_note',
    api: 'navigateNote',
    pages: ['note'],
    defaultPage: 'note',
    argSpec: [{ name: 'urlOrId', required: true }],
    toNavArgs: (opts, positional) => ({ url: positional[0] }),
    help: '导航到 xhs 笔记详情：navigate-note <url|id>',
  },
  'navigate-search': {
    kind: 'navigate',
    toolName: 'xhs_navigate_search',
    api: 'navigateSearch',
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: false }],
    toNavArgs: (opts, positional) => ({ keyword: positional[0] }),
    help: '导航到 xhs 搜索页：navigate-search <keyword>',
  },
  'navigate-user': {
    kind: 'navigate',
    toolName: 'xhs_navigate_user',
    api: 'navigateUser',
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'userId', required: true }],
    toNavArgs: (opts, positional) => ({ userId: positional[0] }),
    help: '导航到 xhs 用户主页：navigate-user <userId>',
  },
  'navigate-home': {
    kind: 'navigate',
    toolName: 'xhs_navigate_home',
    api: 'navigateHome',
    pages: ['home'],
    defaultPage: 'home',
    argSpec: [],
    toNavArgs: () => ({}),
    help: '导航到 xhs 首页（探索流）：navigate-home',
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
    readMode: null,
    maxPages: null,
    maxCommentPages: null,
    withComments: false,
    limit: null,
    channelType: null,
    sortBy: null,
    contentType: null,
    timeRange: null,
    searchScope: null,
    extractDetails: false,
    detailsLimit: null,
    visual: undefined,
    visualHud: undefined,
    visualFlash: undefined,
    visualTrace: null,
    visualRecord: undefined,
    timeoutMs: null,
    quiet: false,
    last: null,
    tool: null,
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
    else if (a === '--with-comments') opts.withComments = true;
    else if (a === '--extract-details') opts.extractDetails = true;
    else if (a === '--details-limit') eat('detailsLimit');
    else if (a.startsWith('--details-limit=')) eatEq('detailsLimit', '--details-limit=');
    else if (a === '--visual') opts.visual = true;
    else if (a === '--no-visual') opts.visual = false;
    else if (a === '--visual-hud') opts.visualHud = true;
    else if (a === '--no-visual-hud') opts.visualHud = false;
    else if (a === '--visual-flash') opts.visualFlash = true;
    else if (a === '--no-visual-flash') opts.visualFlash = false;
    else if (a === '--visual-trace') eat('visualTrace');
    else if (a.startsWith('--visual-trace=')) eatEq('visualTrace', '--visual-trace=');
    else if (a === '--visual-record') {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) { opts.visualRecord = next; i += 1; }
      else { opts.visualRecord = true; }
    }
    else if (a.startsWith('--visual-record=')) eatEq('visualRecord', '--visual-record=');
    else if (a === '--no-visual-record') opts.visualRecord = false;
    else if (a === '--read-mode') eat('readMode');
    else if (a.startsWith('--read-mode=')) eatEq('readMode', '--read-mode=');
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
    else if (a === '--max-comment-pages') eat('maxCommentPages');
    else if (a.startsWith('--max-comment-pages=')) eatEq('maxCommentPages', '--max-comment-pages=');
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--channel-type') eat('channelType');
    else if (a.startsWith('--channel-type=')) eatEq('channelType', '--channel-type=');
    else if (a === '--sort-by') eat('sortBy');
    else if (a.startsWith('--sort-by=')) eatEq('sortBy', '--sort-by=');
    else if (a === '--content-type') eat('contentType');
    else if (a.startsWith('--content-type=')) eatEq('contentType', '--content-type=');
    else if (a === '--time-range') eat('timeRange');
    else if (a.startsWith('--time-range=')) eatEq('timeRange', '--time-range=');
    else if (a === '--search-scope') eat('searchScope');
    else if (a.startsWith('--search-scope=')) eatEq('searchScope', '--search-scope=');
    else if (a === '--timeout-ms') eat('timeoutMs');
    else if (a.startsWith('--timeout-ms=')) eatEq('timeoutMs', '--timeout-ms=');
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--last') eat('last');
    else if (a.startsWith('--last=')) eatEq('last', '--last=');
    else if (a === '--tool') eat('tool');
    else if (a.startsWith('--tool=')) eatEq('tool', '--tool=');
    else if (a.startsWith('-')) {
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
    'js-xiaohongshu-ops-skill - 小红书内容读取工具（READ + INTERACTIVE）',
    '',
    'Usage: node index.js <command> [args] [options]',
    '',
    'Commands:',
  ];
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = (def.argSpec || []).map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`)).join(' ');
    const pageHint = def.defaultPage ? ` [page=${def.defaultPage}]`
      : (def.pages && def.pages.length === 1 ? ` [page=${def.pages[0]}]` : '');
    lines.push(`  ${name.padEnd(18)} ${args.padEnd(18)} ${(def.help || '') + pageHint}`);
  }
  lines.push(
    '',
    'Options:',
    `  --page <name>            page profile (${pageList}; 默认按 command 推导，fallback 到 ${DEFAULT_PAGE})`,
    '  --tab <id>               强制指定浏览器 tab id',
    '  --read-mode auto|dom|api  READ：auto=DOM 优先 + API 兜底（与 X 取反）',
    '  --max-pages / --max-comment-pages / --limit / --extract-details',
    '  --pretty / --json / -v',
    '  --server <ws-url>        js-eyes WS endpoint（默认 ws://localhost:18080）',
    '  --recording-mode <mode>  off|history|standard|debug',
    '  --debug-recording / --no-cache / --recording-base-dir / --run-id',
    '  -h, --help               显示帮助',
    '',
    '示例:',
    '  node index.js note https://www.xiaohongshu.com/explore/xxxx --with-comments --max-comment-pages 2',
    '  node index.js search "穿搭" --limit 20 --extract-details',
    '  node index.js navigate-note https://www.xiaohongshu.com/explore/xxxx',
    '  node index.js session-state --pretty',
    '',
    '注意:',
    '  * READ 档不模拟点击 / 不改 DOM；INTERACTIVE 档只通过 location.assign 改 URL',
    '  * 设 JS_XHS_DISABLE_BRIDGE=1 强制走老路径 scripts/xhs-note.js',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, READ_CMD_DEF, parseArgv, printHelp };
