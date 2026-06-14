'use strict';

const { PAGE_PROFILES, DEFAULT_PAGE } = require('./config');
const targets = require('./toolTargets');

const COMMANDS = {
  doctor: {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    help: '连通性 + bridge 注入 + probe + state 汇总',
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
    toolName: 'hn_session_state',
    api: 'sessionState',
    pages: ['front'],
    defaultPage: 'front',
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取登录态',
  },
  front: {
    kind: 'tool',
    toolName: 'hn_get_front_page',
    api: 'getFrontPage',
    pages: ['front'],
    defaultPage: 'front',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
    argSpec: [],
    toArgs: (opts) => [{
      feed: opts.feed || undefined,
      page: opts.pageNum ? Number(opts.pageNum) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      readMode: opts.readMode || undefined,
    }],
    targetUrl: (opts) => targets.frontUrl({ feed: opts.feed, page: opts.pageNum }),
    help: '首页列表：front [--feed top|new|best|ask|show|job] [--page-num N] [--limit N]',
  },
  item: {
    kind: 'tool',
    toolName: 'hn_get_item',
    api: 'getItem',
    pages: ['item'],
    defaultPage: 'item',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
    argSpec: [{ name: 'itemId', required: true }],
    toArgs: (opts, positional) => {
      const itemId = positional[0] != null ? Number(positional[0]) : NaN;
      return [{
        itemId: Number.isFinite(itemId) ? itemId : undefined,
        depth: opts.depth ? Number(opts.depth) : undefined,
        commentLimit: opts.commentLimit ? Number(opts.commentLimit) : (opts.limit ? Number(opts.limit) : undefined),
        readMode: opts.readMode || undefined,
      }];
    },
    targetUrl: (opts, positional) => targets.itemUrl({ itemId: positional[0] }),
    help: '帖子详情：item <id> [--depth N] [--comment-limit N] [--read-mode auto|api|dom]',
  },
  user: {
    kind: 'tool',
    toolName: 'hn_get_user',
    api: 'getUser',
    pages: ['user'],
    defaultPage: 'user',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
    argSpec: [{ name: 'userId', required: true }],
    toArgs: (opts, positional) => [{
      userId: positional[0] || undefined,
      tab: opts.userTab || undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      readMode: opts.readMode || undefined,
    }],
    targetUrl: (opts, positional) => targets.userUrl({ userId: positional[0], tab: opts.userTab }),
    help: '用户页：user <id> [--user-tab submitted|comments] [--limit N]',
  },
  search: {
    kind: 'tool',
    toolName: 'hn_search',
    api: 'search',
    pages: ['search'],
    defaultPage: 'search',
    domSupported: false,
    apiSupported: true,
    defaultReadMode: 'api',
    argSpec: [{ name: 'query', required: true }],
    toArgs: (opts, positional) => [{
      query: positional.join(' ') || opts.q || undefined,
      tags: opts.tags || undefined,
      sort: opts.sort || undefined,
      page: opts.pageNum ? Number(opts.pageNum) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      readMode: opts.readMode || undefined,
    }],
    targetUrl: () => null,
    help: 'Algolia 搜索：search <query> [--tags TAG] [--sort relevance|date] [--page-num N] [--limit N]',
  },
  'navigate-front': {
    kind: 'navigate',
    toolName: 'hn_navigate_front',
    api: 'navigateFront',
    pages: ['front'],
    defaultPage: 'front',
    argSpec: [],
    toNavArgs: (opts) => ({
      feed: opts.feed || undefined,
      page: opts.pageNum ? Number(opts.pageNum) : undefined,
    }),
    help: '导航首页：navigate-front [--feed top|new|...] [--page-num N]',
  },
  'navigate-item': {
    kind: 'navigate',
    toolName: 'hn_navigate_item',
    api: 'navigateItem',
    pages: ['item'],
    defaultPage: 'item',
    argSpec: [{ name: 'itemId', required: true }],
    toNavArgs: (opts, positional) => ({
      itemId: positional[0] != null ? Number(positional[0]) : undefined,
    }),
    help: '导航帖子：navigate-item <id>',
  },
  'navigate-user': {
    kind: 'navigate',
    toolName: 'hn_navigate_user',
    api: 'navigateUser',
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'userId', required: true }],
    toNavArgs: (opts, positional) => ({
      userId: positional[0] || undefined,
      tab: opts.userTab || undefined,
    }),
    help: '导航用户：navigate-user <id> [--user-tab submitted|comments]',
  },
  'navigate-search': {
    kind: 'navigate',
    toolName: 'hn_navigate_search',
    api: 'navigateSearch',
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'query', required: true }],
    toNavArgs: (opts, positional) => ({
      query: positional.join(' ') || opts.q || undefined,
    }),
    help: '导航（无站内搜索页，打开 /news）：navigate-search <query>',
  },
  'dom-dump': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] 当前 HN 页面关键 DOM outline',
  },
  'xhr-log': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] performance resource 中 Firebase / Algolia 请求',
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
    anchors: false,
    filter: null,
    limit: null,
    pageNum: null,
    feed: null,
    userTab: null,
    depth: null,
    commentLimit: null,
    readMode: null,
    tags: null,
    sort: null,
    q: null,
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
    else if (a === '--anchors') opts.anchors = true;
    else if (a === '--filter') eat('filter');
    else if (a.startsWith('--filter=')) eatEq('filter', '--filter=');
    else if (a === '--tab') eat('tab');
    else if (a.startsWith('--tab=')) eatEq('tab', '--tab=');
    else if (a === '--user-tab') eat('userTab');
    else if (a.startsWith('--user-tab=')) eatEq('userTab', '--user-tab=');
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
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--page-num') eat('pageNum');
    else if (a.startsWith('--page-num=')) eatEq('pageNum', '--page-num=');
    else if (a === '--feed') eat('feed');
    else if (a.startsWith('--feed=')) eatEq('feed', '--feed=');
    else if (a === '--depth') eat('depth');
    else if (a.startsWith('--depth=')) eatEq('depth', '--depth=');
    else if (a === '--comment-limit') eat('commentLimit');
    else if (a.startsWith('--comment-limit=')) eatEq('commentLimit', '--comment-limit=');
    else if (a === '--read-mode') eat('readMode');
    else if (a.startsWith('--read-mode=')) eatEq('readMode', '--read-mode=');
    else if (a === '--tags') eat('tags');
    else if (a.startsWith('--tags=')) eatEq('tags', '--tags=');
    else if (a === '--sort') eat('sort');
    else if (a.startsWith('--sort=')) eatEq('sort', '--sort=');
    else if (a === '--q') eat('q');
    else if (a.startsWith('--q=')) eatEq('q', '--q=');
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
    'js-hn-ops-skill - Hacker News 只读 + 浏览器导航（READ + INTERACTIVE）',
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
    `  --page <name>            page profile (${pageList})`,
    '  --tab <id>               强制指定浏览器 tab id',
    '  --user-tab <submitted|comments>',
    '  --feed <top|new|best|ask|show|job>',
    '  --page-num <n>           分页',
    '  --limit <n>',
    '  --depth <n>              item 评论树深度',
    '  --comment-limit <n>      item 评论数量上限',
    '  --read-mode <auto|api|dom>',
    '  --tags <tag>             搜索 tags（Algolia）',
    '  --sort <relevance|date>  搜索排序',
    '  --pretty                 JSON 缩进',
    '  -v, --verbose',
    '  --server <ws-url>',
    '',
    '示例:',
    '  node index.js front --feed top --limit 10 --pretty',
    '  node index.js item 48526661 --depth 4',
    '  node index.js user subset --tab submitted --limit 20',
    '  node index.js search "LLM agent" --limit 10',
    '  node index.js doctor',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, parseArgv, printHelp };
