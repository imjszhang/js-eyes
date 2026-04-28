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
    toolName: 'github_session_state',
    api: 'sessionState',
    pages: ['repo'],
    defaultPage: 'repo',
    argSpec: [],
    toArgs: () => [{}],
    targetUrl: () => null,
    help: '读取登录态（meta user-login）',
  },
  'get-repo': {
    kind: 'tool',
    toolName: 'github_get_repo',
    api: 'getRepo',
    pages: ['repo'],
    defaultPage: 'repo',
    argSpec: [{ name: 'slug', required: true }],
    toArgs: (opts, positional) => {
      const slug = positional[0] || '';
      const { owner, repo } = targets.parseSlug(slug);
      return [{ owner, repo, slug: slug || undefined }];
    },
    targetUrl: (opts, positional) => targets.repoRootUrl({ slug: positional[0] }),
    help: '读取仓库元数据（REST）：get-repo <owner/repo>',
  },
  'list-issues': {
    kind: 'tool',
    toolName: 'github_list_issues',
    api: 'listIssues',
    pages: ['issues'],
    defaultPage: 'issues',
    argSpec: [{ name: 'slug', required: true }],
    toArgs: (opts, positional) => {
      const slug = positional[0] || '';
      const { owner, repo } = targets.parseSlug(slug);
      return [{
        owner,
        repo,
        slug: slug || undefined,
        state: opts.state || undefined,
        perPage: opts.limit ? Number(opts.limit) : undefined,
        page: opts.pageNum ? Number(opts.pageNum) : undefined,
        excludePulls: opts.includePulls === true ? false : true,
      }];
    },
    targetUrl: (opts, positional) => targets.issuesListUrl({ slug: positional[0], q: opts.q }),
    help: '列出 Issues：list-issues <owner/repo> [--state open|closed|all] [--limit N] [--page-num N] [--include-pulls]；无 tab 时 createUrl 可加 --q',
  },
  'get-issue': {
    kind: 'tool',
    toolName: 'github_get_issue',
    api: 'getIssue',
    pages: ['issue'],
    defaultPage: 'issue',
    argSpec: [{ name: 'slug', required: true }, { name: 'number', required: true }],
    toArgs: (opts, positional) => {
      const slug = positional[0] || '';
      const { owner, repo } = targets.parseSlug(slug);
      const num = positional[1] != null ? Number(positional[1]) : NaN;
      return [{
        owner,
        repo,
        number: num,
        bodyMaxLen: opts.bodyMaxLen ? Number(opts.bodyMaxLen) : undefined,
      }];
    },
    targetUrl: (opts, positional) => targets.issueDetailUrl({
      slug: positional[0],
      number: positional[1] != null ? Number(positional[1]) : undefined,
    }),
    help: '读取单条 Issue：get-issue <owner/repo> <number> [--body-max-len N]',
  },
  'navigate-repo': {
    kind: 'navigate',
    toolName: 'github_navigate_repo',
    api: 'navigateRepo',
    pages: ['repo'],
    defaultPage: 'repo',
    argSpec: [{ name: 'slug', required: true }],
    toNavArgs: (opts, positional) => {
      const slug = positional[0] || '';
      return targets.parseSlug(slug);
    },
    help: '导航到仓库根：navigate-repo <owner/repo>',
  },
  'navigate-issues': {
    kind: 'navigate',
    toolName: 'github_navigate_issues',
    api: 'navigateIssues',
    pages: ['issues'],
    defaultPage: 'issues',
    argSpec: [{ name: 'slug', required: true }],
    toNavArgs: (opts, positional) => Object.assign(targets.parseSlug(positional[0] || ''), { q: opts.q || undefined }),
    help: '导航到 Issues 列表：navigate-issues <owner/repo> [--q query]',
  },
  'navigate-issue': {
    kind: 'navigate',
    toolName: 'github_navigate_issue',
    api: 'navigateIssue',
    pages: ['issue'],
    defaultPage: 'issue',
    argSpec: [{ name: 'slug', required: true }, { name: 'number', required: true }],
    toNavArgs: (opts, positional) => Object.assign(
      targets.parseSlug(positional[0] || ''),
      { number: positional[1] != null ? Number(positional[1]) : undefined },
    ),
    help: '导航到 Issue：navigate-issue <owner/repo> <number>',
  },

  'dom-dump': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] 当前 GitHub 页面关键节点 outline',
  },
  'xhr-log': {
    kind: 'special',
    argSpec: [],
    pages: Object.keys(PAGE_PROFILES),
    defaultPage: DEFAULT_PAGE,
    help: '[内部] performance resource 中含 github.com / api.github.com 的请求',
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
    state: null,
    limit: null,
    pageNum: null,
    q: null,
    bodyMaxLen: null,
    includePulls: false,
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
    else if (a === '--include-pulls') opts.includePulls = true;
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
    else if (a === '--limit') eat('limit');
    else if (a.startsWith('--limit=')) eatEq('limit', '--limit=');
    else if (a === '--page-num') eat('pageNum');
    else if (a.startsWith('--page-num=')) eatEq('pageNum', '--page-num=');
    else if (a === '--state') eat('state');
    else if (a.startsWith('--state=')) eatEq('state', '--state=');
    else if (a === '--q') eat('q');
    else if (a.startsWith('--q=')) eatEq('q', '--q=');
    else if (a === '--body-max-len') eat('bodyMaxLen');
    else if (a.startsWith('--body-max-len=')) eatEq('bodyMaxLen', '--body-max-len=');
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
    'js-github-ops-skill - GitHub 仓库 / Issues 只读 + 浏览器导航（READ + INTERACTIVE）',
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
    `  --page <name>            page profile (${pageList}；默认按 command)`,
    '  --tab <id>               强制指定浏览器 tab id',
    '  --limit <n>              list-issues 的 per_page（默认 25，最大 100）',
    '  --page-num <n>           list-issues 的页码',
    '  --state <open|closed|all>',
    '  --q <string>             无 github tab 时的 createUrl（navigate-issues；list-issues 仅影响兜底打开页）',
    '  --body-max-len <n>       get-issue 正文最大字符',
    '  --include-pulls          list-issues 保留 PR 条目',
    '  --pretty                 JSON 缩进',
    '  -v, --verbose            session 日志',
    '  --server <ws-url>        js-eyes WS（可用 JS_EYES_SERVER_URL）',
    '  --recording-mode <mode>   off|history|standard|debug',
    '  --anchors                 dom-dump 附加 a[href]',
    '  --filter <regex>          xhr-log 过滤（默认 github\\.com|api\\.github\\.com）',
    '',
    '示例:',
    '  node index.js get-repo octocat/Hello-World --pretty',
    '  node index.js list-issues octocat/Hello-World --state open --limit 10',
    '  node index.js get-issue octocat/Hello-World 1347',
    '  node index.js doctor',
    '',
    '注意: READ 使用 api.github.com（公开库匿名可访问）；私有库可能 404；遵守 GitHub API 速率限制。',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { COMMANDS, parseArgv, printHelp };
