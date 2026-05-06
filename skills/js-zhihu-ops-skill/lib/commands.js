'use strict';

const { PAGE_PROFILES, DEFAULT_PAGE } = require('./config');
const targets = require('./toolTargets');

const READ_CMD_DEF = {
  answer: { methodBase: 'getAnswer', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  article: { methodBase: 'getArticle', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  questionAnswers: { methodBase: 'getQuestionAnswers', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  search: { methodBase: 'search', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  user: { methodBase: 'getUser', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  userAnswers: { methodBase: 'getUserAnswers', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
  userArticles: { methodBase: 'getUserArticles', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
};

const COMMANDS = {
  doctor: {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '连通性 + bridge 注入 + state 汇总（多 profile 诊断）',
  },
  records: {
    kind: 'special',
    argSpec: [],
    pages: [],
    defaultPage: null,
    help: '查看最近的 records：records [--last N] [--tool zhihu_get_answer]',
  },
  monitor: {
    kind: 'special',
    argSpec: [],
    pages: [],
    defaultPage: null,
    help: '知乎用户/问题/搜索监控：init/add/remove/list/status/test',
  },
  'session-state': {
    kind: 'tool',
    toolName: 'zhihu_session_state',
    api: 'sessionState',
    pages: ['home'],
    defaultPage: 'home',
    cmdDef: { legacyOnly: true },
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取知乎登录态与页面阻断状态',
  },
  answer: {
    kind: 'tool',
    toolName: 'zhihu_get_answer',
    api: 'getAnswer',
    cmdDef: READ_CMD_DEF.answer,
    pages: ['answer'],
    defaultPage: 'answer',
    argSpec: [{ name: 'url', required: true }],
    toArgs: (opts, positional) => [{ url: positional[0] }],
    targetUrl: (_opts, positional) => targets.answerUrl({ url: positional[0] }),
    help: '回答详情：answer <url>',
  },
  article: {
    kind: 'tool',
    toolName: 'zhihu_get_article',
    api: 'getArticle',
    cmdDef: READ_CMD_DEF.article,
    pages: ['article'],
    defaultPage: 'article',
    argSpec: [{ name: 'url', required: true }],
    toArgs: (opts, positional) => [{ url: positional[0] }],
    targetUrl: (_opts, positional) => targets.articleUrl({ url: positional[0] }),
    help: '专栏详情：article <url>',
  },
  'question-answers': {
    kind: 'tool',
    toolName: 'zhihu_get_question_answers',
    api: 'getQuestionAnswers',
    cmdDef: READ_CMD_DEF.questionAnswers,
    pages: ['question'],
    defaultPage: 'question',
    argSpec: [{ name: 'urlOrQuestionId', required: true }],
    toArgs: (opts, positional) => [{
      url: /^https?:/i.test(positional[0]) ? positional[0] : undefined,
      questionId: /^https?:/i.test(positional[0]) ? undefined : positional[0],
      limit: opts.limit ? Number(opts.limit) : 10,
      maxPages: opts.maxPages ? Number(opts.maxPages) : 1,
    }],
    targetUrl: (_opts, positional) => /^https?:/i.test(positional[0])
      ? targets.questionUrl({ url: positional[0] })
      : targets.questionUrl({ questionId: positional[0] }),
    help: '问题回答列表：question-answers <url|questionId> [--limit N]',
  },
  search: {
    kind: 'tool',
    toolName: 'zhihu_search',
    api: 'search',
    cmdDef: READ_CMD_DEF.search,
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: true }],
    toArgs: (opts, positional) => [{ keyword: positional[0], type: opts.type || undefined, limit: opts.limit ? Number(opts.limit) : 10 }],
    targetUrl: (opts, positional) => targets.searchUrl({ keyword: positional[0], type: opts.type || undefined }),
    help: '搜索：search <keyword> [--type content|people|topic] [--limit N]',
  },
  user: {
    kind: 'tool',
    toolName: 'zhihu_get_user',
    api: 'getUser',
    cmdDef: READ_CMD_DEF.user,
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'urlOrSlug', required: true }],
    toArgs: (_opts, positional) => [{ url: /^https?:/i.test(positional[0]) ? positional[0] : undefined, userSlug: /^https?:/i.test(positional[0]) ? undefined : positional[0] }],
    targetUrl: (_opts, positional) => /^https?:/i.test(positional[0]) ? targets.userUrl({ url: positional[0] }) : targets.userUrl({ userSlug: positional[0] }),
    help: '用户主页：user <url|slug>',
  },
  'user-answers': {
    kind: 'tool',
    toolName: 'zhihu_get_user_answers',
    api: 'getUserAnswers',
    cmdDef: READ_CMD_DEF.userAnswers,
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'urlOrSlug', required: true }],
    toArgs: (opts, positional) => [{ url: /^https?:/i.test(positional[0]) ? positional[0] : undefined, userSlug: /^https?:/i.test(positional[0]) ? undefined : positional[0], limit: opts.limit ? Number(opts.limit) : 10 }],
    targetUrl: (_opts, positional) => /^https?:/i.test(positional[0]) ? targets.userUrl({ url: positional[0] }) : targets.userUrl({ userSlug: positional[0] }),
    help: '用户回答列表：user-answers <url|slug> [--limit N]',
  },
  'user-articles': {
    kind: 'tool',
    toolName: 'zhihu_get_user_articles',
    api: 'getUserArticles',
    cmdDef: READ_CMD_DEF.userArticles,
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'urlOrSlug', required: true }],
    toArgs: (opts, positional) => [{ url: /^https?:/i.test(positional[0]) ? positional[0] : undefined, userSlug: /^https?:/i.test(positional[0]) ? undefined : positional[0], limit: opts.limit ? Number(opts.limit) : 10 }],
    targetUrl: (_opts, positional) => /^https?:/i.test(positional[0]) ? targets.userUrl({ url: positional[0] }) : targets.userUrl({ userSlug: positional[0] }),
    help: '用户文章列表：user-articles <url|slug> [--limit N]',
  },
  'navigate-answer': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_answer',
    api: 'navigateAnswer',
    pages: ['answer'],
    defaultPage: 'answer',
    argSpec: [{ name: 'url', required: true }],
    toNavArgs: (_opts, positional) => ({ url: positional[0] }),
    help: '导航到知乎回答：navigate-answer <url>',
  },
  'navigate-article': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_article',
    api: 'navigateArticle',
    pages: ['article'],
    defaultPage: 'article',
    argSpec: [{ name: 'url', required: true }],
    toNavArgs: (_opts, positional) => ({ url: positional[0] }),
    help: '导航到知乎专栏：navigate-article <url>',
  },
  'navigate-question': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_question',
    api: 'navigateQuestion',
    pages: ['question'],
    defaultPage: 'question',
    argSpec: [{ name: 'urlOrQuestionId', required: true }],
    toNavArgs: (_opts, positional) => /^https?:/i.test(positional[0]) ? { url: positional[0] } : { questionId: positional[0] },
    help: '导航到知乎问题：navigate-question <url|questionId>',
  },
  'navigate-search': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_search',
    api: 'navigateSearch',
    pages: ['search'],
    defaultPage: 'search',
    argSpec: [{ name: 'keyword', required: false }],
    toNavArgs: (opts, positional) => ({ keyword: positional[0], type: opts.type || undefined }),
    help: '导航到知乎搜索：navigate-search [keyword]',
  },
  'navigate-user': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_user',
    api: 'navigateUser',
    pages: ['user'],
    defaultPage: 'user',
    argSpec: [{ name: 'urlOrSlug', required: true }],
    toNavArgs: (_opts, positional) => /^https?:/i.test(positional[0]) ? { url: positional[0] } : { userSlug: positional[0] },
    help: '导航到知乎用户：navigate-user <url|slug>',
  },
  'navigate-home': {
    kind: 'navigate',
    toolName: 'zhihu_navigate_home',
    api: 'navigateHome',
    pages: ['home'],
    defaultPage: 'home',
    argSpec: [],
    toNavArgs: () => ({}),
    help: '导航到知乎首页',
  },
};

function parseArgv(argv) {
  const opts = {
    page: null,
    tab: null,
    pretty: false,
    json: false,
    verbose: false,
    help: false,
    wsEndpoint: null,
    recordingMode: null,
    recordingBaseDir: null,
    runId: null,
    debugRecording: false,
    noCache: false,
    readMode: null,
    limit: null,
    maxPages: null,
    type: null,
    timeoutMs: null,
    quiet: false,
    last: null,
    tool: null,
    visual: undefined,
    visualTrace: null,
    visualRecord: null,
    rateLimit: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (key) => { opts[key] = argv[++i]; };
    const eatEq = (key, prefix) => { opts[key] = a.slice(prefix.length); };
    if (a === '--pretty') opts.pretty = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--debug-recording') opts.debugRecording = true;
    else if (a === '--no-cache') opts.noCache = true;
    else if (a === '--rate-limit') opts.rateLimit = true;
    else if (a === '--visual') opts.visual = true;
    else if (a === '--no-visual') opts.visual = false;
    else if (a === '--visual-trace') {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) { opts.visualTrace = next; i += 1; } else opts.visualTrace = true;
    } else if (a.startsWith('--visual-trace=')) eatEq('visualTrace', '--visual-trace=');
    else if (a === '--visual-record') {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) { opts.visualRecord = next; i += 1; } else opts.visualRecord = true;
    } else if (a.startsWith('--visual-record=')) eatEq('visualRecord', '--visual-record=');
    else if (a === '--page') eat('page');
    else if (a.startsWith('--page=')) eatEq('page', '--page=');
    else if (a === '--tab') eat('tab');
    else if (a.startsWith('--tab=')) eatEq('tab', '--tab=');
    else if (a === '--server' || a === '--ws-endpoint' || a === '--browser-server') eat('wsEndpoint');
    else if (a.startsWith('--server=') || a.startsWith('--ws-endpoint=') || a.startsWith('--browser-server=')) opts.wsEndpoint = a.slice(a.indexOf('=') + 1);
    else if (a === '--recording-mode') eat('recordingMode');
    else if (a.startsWith('--recording-mode=')) eatEq('recordingMode', '--recording-mode=');
    else if (a === '--recording-base-dir') eat('recordingBaseDir');
    else if (a.startsWith('--recording-base-dir=')) eatEq('recordingBaseDir', '--recording-base-dir=');
    else if (a === '--run-id') eat('runId');
    else if (a.startsWith('--run-id=')) eatEq('runId', '--run-id=');
    else if (a === '--read-mode') eat('readMode');
    else if (a.startsWith('--read-mode=')) eatEq('readMode', '--read-mode=');
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--max-pages') eat('maxPages');
    else if (a.startsWith('--max-pages=')) eatEq('maxPages', '--max-pages=');
    else if (a === '--type') eat('type');
    else if (a.startsWith('--type=')) eatEq('type', '--type=');
    else if (a === '--timeout-ms') eat('timeoutMs');
    else if (a.startsWith('--timeout-ms=')) eatEq('timeoutMs', '--timeout-ms=');
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--last') eat('last');
    else if (a.startsWith('--last=')) eatEq('last', '--last=');
    else if (a === '--tool') eat('tool');
    else if (a.startsWith('--tool=')) eatEq('tool', '--tool=');
    else if (a.startsWith('-')) {
      const err = new Error(`unknown option: ${a}`);
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
    'js-zhihu-ops-skill - 知乎内容读取工具（READ + INTERACTIVE）',
    '',
    'Usage: node index.js <command> [args] [options]',
    '',
    'Commands:',
  ];
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = (def.argSpec || []).map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`)).join(' ');
    lines.push(`  ${name.padEnd(18)} ${args.padEnd(18)} ${def.help || ''}`);
  }
  lines.push(
    '',
    'Options:',
    `  --page <name>            page profile (${pageList})`,
    '  --tab <id>               强制指定浏览器 tab id',
    '  --read-mode auto|dom|api  READ 调度模式（知乎当前默认 dom）',
    '  --limit / --max-pages / --timeout-ms',
    '  --pretty / --json / -v',
    '  --server <ws-url>        js-eyes WS endpoint（默认 ws://localhost:18080）',
    '  --recording-mode <mode>  off|history|standard|debug',
    '  --debug-recording / --no-cache / --recording-base-dir / --run-id',
    '  --visual / --visual-trace [path] / --visual-record [dir]',
    '  -h, --help               显示帮助',
    '',
    '注意:',
    '  * READ 档不模拟点击 / 不改 DOM；INTERACTIVE 档只通过 location.assign 改 URL',
    '  * 设 JS_ZHIHU_DISABLE_BRIDGE=1 可让 answer/article 走旧脚本 fallback',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, READ_CMD_DEF, parseArgv, printHelp };
