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
    toolName: 'google_session_state',
    api: 'sessionState',
    pages: ['search'],
    defaultPage: 'search',
    forceNewTab: false,
    reuseAnyGoogleTab: true,
    closeCreatedTab: true,
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取当前 Google tab 登录态（不返回邮箱/cookie）',
  },
  search: {
    kind: 'tool',
    toolName: 'google_search',
    api: 'extractPage',
    pages: ['search'],
    defaultPage: 'search',
    forceNewTab: true,
    argSpec: [{ name: 'query', required: true }],
    toArgs: (opts, positional) => [targets.searchArgsFromCli(opts, positional, 'web')],
    targetUrl: (opts, positional) => targets.searchUrl(targets.searchArgsFromCli(opts, positional, 'web')),
    help: '网页搜索：search <query> [--limit N] [--max-pages N] [--language hl] [--region gl]',
  },
  news: {
    kind: 'tool',
    toolName: 'google_search_news',
    api: 'extractPage',
    pages: ['search'],
    defaultPage: 'search',
    forceNewTab: true,
    argSpec: [{ name: 'query', required: true }],
    toArgs: (opts, positional) => [targets.searchArgsFromCli(opts, positional, 'news')],
    targetUrl: (opts, positional) => targets.searchUrl(targets.searchArgsFromCli(opts, positional, 'news')),
    help: '新闻搜索：news <query> [--time-range h|d|w|m|y]',
  },
  images: {
    kind: 'tool',
    toolName: 'google_search_images',
    api: 'extractPage',
    pages: ['search'],
    defaultPage: 'search',
    forceNewTab: true,
    argSpec: [{ name: 'query', required: true }],
    toArgs: (opts, positional) => [targets.searchArgsFromCli(opts, positional, 'images')],
    targetUrl: (opts, positional) => targets.searchUrl(targets.searchArgsFromCli(opts, positional, 'images')),
    help: '图片搜索：images <query>（只返回可见缩略图与来源页）',
  },
  scholar: {
    kind: 'tool',
    toolName: 'google_search_scholar',
    api: 'extractPage',
    pages: ['scholar'],
    defaultPage: 'scholar',
    forceNewTab: true,
    argSpec: [{ name: 'query', required: true }],
    toArgs: (opts, positional) => [targets.searchArgsFromCli(opts, positional, 'scholar')],
    targetUrl: (opts, positional) => targets.searchUrl(targets.searchArgsFromCli(opts, positional, 'scholar')),
    help: 'Scholar 搜索：scholar <query> [--year-from Y] [--year-to Y] [--sort-by relevance|date]',
  },
  'navigate-search': {
    kind: 'navigate',
    toolName: 'google_navigate_search',
    api: 'navigateSearch',
    pages: ['search', 'scholar'],
    defaultPage: 'search',
    argSpec: [{ name: 'query', required: true }],
    toNavArgs: (opts, positional) => targets.searchArgsFromCli(opts, positional, opts.vertical || 'web'),
    help: '导航搜索页：navigate-search <query> [--vertical web|news|images|scholar]',
  },
  'dom-dump': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] 当前 Google 页关键 DOM outline（截断，不含整页 HTML）',
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
    limit: null,
    maxPages: null,
    language: null,
    region: null,
    safeSearch: null,
    timeRange: null,
    yearFrom: null,
    yearTo: null,
    sortBy: null,
    vertical: null,
    query: null,
    q: null,
    anchors: false,
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
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--max-pages') eat('maxPages');
    else if (a.startsWith('--max-pages=')) eatEq('maxPages', '--max-pages=');
    else if (a === '--language' || a === '--hl') eat('language');
    else if (a.startsWith('--language=')) eatEq('language', '--language=');
    else if (a.startsWith('--hl=')) eatEq('language', '--hl=');
    else if (a === '--region' || a === '--gl') eat('region');
    else if (a.startsWith('--region=')) eatEq('region', '--region=');
    else if (a.startsWith('--gl=')) eatEq('region', '--gl=');
    else if (a === '--safe-search') eat('safeSearch');
    else if (a.startsWith('--safe-search=')) eatEq('safeSearch', '--safe-search=');
    else if (a === '--time-range') eat('timeRange');
    else if (a.startsWith('--time-range=')) eatEq('timeRange', '--time-range=');
    else if (a === '--year-from') eat('yearFrom');
    else if (a.startsWith('--year-from=')) eatEq('yearFrom', '--year-from=');
    else if (a === '--year-to') eat('yearTo');
    else if (a.startsWith('--year-to=')) eatEq('yearTo', '--year-to=');
    else if (a === '--sort-by') eat('sortBy');
    else if (a.startsWith('--sort-by=')) eatEq('sortBy', '--sort-by=');
    else if (a === '--vertical') eat('vertical');
    else if (a.startsWith('--vertical=')) eatEq('vertical', '--vertical=');
    else if (a === '--q' || a === '--query') eat('query');
    else if (a.startsWith('--q=')) eatEq('query', '--q=');
    else if (a.startsWith('--query=')) eatEq('query', '--query=');
    else if (a.startsWith('-')) {
      const err = new Error(`unknown option: ${a}（运行 \`node index.js --help\` 查看可用选项）`);
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
    'js-google-ops-skill - Google Search 只读 + 浏览器导航（READ + INTERACTIVE）',
    '',
    'Usage: node index.js <command> [args] [options]',
    '',
    'Commands:',
  ];
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = (def.argSpec || []).map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`)).join(' ');
    lines.push(`  ${name.padEnd(18)} ${args.padEnd(14)} ${def.help || ''}`);
  }
  lines.push(
    '',
    'Options:',
    `  --page <name>            page profile (${pageList})`,
    '  --tab <id>               强制指定浏览器 tab id（不会被关闭）',
    '  --limit <n>              结果数，默认 10，最大 50',
    '  --max-pages <n>          最大页数，默认 1，最大 5',
    '  --language / --hl',
    '  --region / --gl',
    '  --safe-search active|off',
    '  --time-range h|d|w|m|y   仅 news',
    '  --year-from / --year-to  仅 scholar',
    '  --sort-by relevance|date 仅 scholar',
    '  --vertical web|news|images|scholar',
    '  --pretty',
    '  -v, --verbose',
    '  --server <ws-url>',
    '',
    'READ 搜索默认开临时标签页，结束后关闭。navigate-search 会保留页面。',
    '',
    '示例:',
    '  node index.js search "nodejs" --limit 5 --pretty',
    '  node index.js news "openai" --time-range d',
    '  node index.js images "cat" --limit 8',
    '  node index.js scholar "attention is all you need" --year-from 2017',
    '  node index.js navigate-search "nodejs" --vertical web',
    '  node index.js doctor',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, parseArgv, printHelp };
