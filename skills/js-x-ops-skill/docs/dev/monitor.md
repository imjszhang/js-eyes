# monitor（X.com 账号监控）

`js-x-ops-skill` 内置的监控子系统，复用 skill 的 v3 GraphQL 数据层，独立做：**定时拉时间线 + 去重 + webhook 通知**。

不依赖 OpenClaw，不依赖 `openclaw cron` / `openclaw_send_message`；调度有两种模式（外部 cron 单次 / 本地 daemon），通知走内置 webhook adapter（feishu / discord / generic_webhook）。

## 目录与文件

```
~/.js-eyes/skill-data/js-x-ops-skill/monitor/
├── config.json                 # 配置（accounts / channels / scheduling / deduplication）
├── state/<username>.json       # 每个账号的去重状态 + lastCheck
├── logs/check-YYYYMMDD.log     # 按日滚动的 JSONL：daemon 生命周期 + 通知失败
└── daemon.pid                  # daemon 活进程 pid（启动写，退出删）
```

目录解析优先级：
1. API 调用方显式传入的 `{ home }` / `{ stateHome }` 参数（第三方库化复用，见下方"库化 API"）
2. `JS_X_MONITOR_HOME` 环境变量（测试 / CI 用）
3. 默认 `~/.js-eyes/skill-data/js-x-ops-skill/monitor/`

## 配置文件 schema

```json
{
  "$schemaVersion": 1,
  "accounts": [
    {
      "username": "karpathy",
      "enabled": true,
      "addedAt": "2026-05-01T00:00:00Z",
      "channels": ["feishu"],
      "maxPagesPerCheck": 1,
      "includeReplies": false,
      "includeRetweets": false
    }
  ],
  "defaults": {
    "includeRetweets": false,
    "includeReplies": false,
    "summaryLength": 100,
    "maxPagesPerCheck": 1,
    "minLikes": 0
  },
  "deduplication": {
    "method": "id_and_hash",
    "historyDays": 30
  },
  "scheduling": {
    "intervalSec": 3600
  },
  "channels": [
    { "name": "feishu",   "type": "feishu",          "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "secret": "xxx" },
    { "name": "discord",  "type": "discord",         "url": "https://discord.com/api/webhooks/..." },
    { "name": "internal", "type": "generic_webhook", "url": "https://your.endpoint/x-event", "headers": { "Authorization": "Bearer xxx" } }
  ]
}
```

### 字段说明

| 字段 | 含义 | 默认 |
|---|---|---|
| `$schemaVersion` | 版本号，后续迁移用 | 必填，当前 `1` |
| `accounts[].username` | X 账号（不带 @） | 必填 |
| `accounts[].enabled` | 是否启用 | `true` |
| `accounts[].channels` | 账号级通知 channel 名单；为空则继承全局 `channels` 全量 | 继承 |
| `accounts[].includeReplies/includeRetweets/maxPagesPerCheck/minLikes/summaryLength` | 账号级覆盖 defaults | 继承 |
| `deduplication.method` | `id_only` / `hash_only` / `id_and_hash` | `id_and_hash` |
| `deduplication.historyDays` | state 里保留的历史推文天数，超出会被 prune | `30` |
| `scheduling.intervalSec` | daemon 循环间隔秒；最小 30 | `3600` |

### 通知 channel 类型

- `feishu` - 飞书自定义机器人，`secret` 可选，开启即自动计算 `timestamp + sign`
- `discord` - Discord webhook，成功返回 204
- `generic_webhook` - 任意 JSON POST；可通过 `headers` 自定义 HTTP 头（加 Authorization 等）
- `console` - 落 stderr，默认 fallback（当 `channels` 为空时自动走这路）

所有 channel 发送失败 **不阻塞主循环**，失败会落到 `logs/check-YYYYMMDD.log`。

## CLI 参考

```bash
# 初始化（创建目录 + 空 config.json）
node index.js monitor init [--force]

# 账号管理
node index.js monitor add <username> [--channels feishu,discord]
node index.js monitor remove <username>
node index.js monitor list [--pretty]

# 状态
node index.js monitor status [--pretty]        # 汇总 lastCheck + daemon 存活态

# 测试 / 真实 check
node index.js monitor test <username>          # 拉一次，不写 state、不发通知
node index.js monitor check [username]         # 真实 check（写 state + 发通知）
node index.js monitor check --dry-notify       # 写 state 但通知仅 console 打印
node index.js monitor check --dry-state        # 发通知但不写 state（联调用）

# daemon
node index.js monitor daemon [--interval 3600]
node index.js monitor stop                     # 发 SIGTERM；daemon 做完当前 check 才退出
```

## 调度部署

### 方案 A：外部 cron（推荐）
```cron
0 * * * * cd /path/to/js-eyes/skills/js-x-ops-skill && /usr/bin/node scripts/monitor/check.js >> /var/log/x-monitor.log 2>&1
```
`scripts/monitor/check.js` 是 `node index.js monitor check` 的薄壳，退出码一致。

### 方案 B：systemd timer
```ini
# /etc/systemd/system/x-monitor-check.service
[Service]
Type=oneshot
ExecStart=/usr/bin/node /path/to/skills/js-x-ops-skill/scripts/monitor/check.js
Environment=JS_EYES_WS_URL=ws://localhost:18080

# /etc/systemd/system/x-monitor-check.timer
[Timer]
OnCalendar=*:0/30
Unit=x-monitor-check.service
```

### 方案 C：本地 daemon（需前台进程宿主）
```bash
nohup node index.js monitor daemon --interval 3600 > /var/log/x-monitor.log 2>&1 &
# 退出：node index.js monitor stop
```

## 库化 API（第三方复用 monitor 状态机）

PR-2 之后 monitor 暴露三个编程入口，允许外部项目（例如 `js-moltbook` 的
`KolPatrolCollector`）直接复用 ops-skill 的"抓 + 去重 + state 持久化"能力，
而不触发内置通知。

```js
const {
  validateConfig,
} = require('js-x-ops-skill/lib/monitor/config');
const {
  runCheckCore,
} = require('js-x-ops-skill/lib/monitor/runCheck');
const {
  loadState,
  saveState,
} = require('js-x-ops-skill/lib/monitor/state');
```

### validateConfig(raw)

与 `loadConfig` 类似，但**不读文件、不抛错**，把校验结果以 `{ ok, errors, config }`
返回。适合在调用方拼好内存 config 后立刻跑 schema 校验。

### runCheckCore({ config, browser, options })

runCheck 的瘦身版，只做抓取 + 去重 + state 读写，**不发通知**。
返回 `{ ok, accounts: [{ username, fresh, freshEntries, seen, state, ... }], totals }`。

`options`:
- `stateHome?`: string。覆盖默认 monitor home 基目录（`state/` 等子目录都会基于它展开）。
- `writeState?`: 默认 true。设为 false 可由调用方自行决定何时 `saveState`。
- `singleUsername?`: 只跑指定账号。
- `debugSteps?`: 外部提供的数组，runCheckCore 会 push `check_start`/`fetch_start`/`fetch_done`/`dedup`/`check_core_end` 五种阶段事件，便于调用方记录。
- `logger?` / `recording?`: 透传给 `fetchAccount`。

### 示例

```js
const { runCheckCore } = require('js-x-ops-skill/lib/monitor/runCheck');
const { validateConfig } = require('js-x-ops-skill/lib/monitor/config');

const cfg = validateConfig({
  $schemaVersion: 1,
  accounts: [{ username: 'imjszhang' }, { username: 'karpathy' }],
  channels: [], // 走库化 API，外部自己分发通知
  deduplication: { method: 'id_and_hash', historyDays: 14 },
}).config;

const { accounts } = await runCheckCore({
  config: cfg,
  browser,
  options: { stateHome: '/tmp/my-monitor-state' },
});
for (const acct of accounts) {
  for (const { tweet } of acct.freshEntries) {
    // 业务逻辑，比如写到自己的队列
  }
}
```

## AI 工具（受控暴露）

只暴露 5 个「不会触发外部通知」的工具；会产生通知副作用的动作（`check` / `daemon`）**永远只走 CLI**。

| 工具 | 对 X | 对本地 | 对第三方 |
|---|---|---|---|
| `x_monitor_list_accounts` | 无 | 读 config | 无 |
| `x_monitor_get_status` | 无 | 读 state + pid | 无 |
| `x_monitor_add_account` | 无 | **写 config** | 无 |
| `x_monitor_remove_account` | 无 | **写 config** | 无 |
| `x_monitor_test_account` | READ | 无 | **无（不发通知）** |

AI 工具全部 `interactive=false, destructive=false`；副作用在 description 里显式标注。

## 通知 payload 示例

### feishu（interactive card）
```json
{
  "msg_type": "interactive",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": "🐦 @karpathy 新推文" }, "template": "blue" },
    "elements": [{ "tag": "div", "text": { "tag": "lark_md", "content": "**Andrej Karpathy** (@karpathy)\n\nJust shipped a new lecture...\n\n[查看原文](https://x.com/karpathy/status/123)\n⏰ 2026-05-01T00:00:00Z" } }]
  },
  "timestamp": "1746057600",
  "sign": "base64-hmac..."
}
```

### discord（embeds）
```json
{
  "embeds": [{
    "title": "@karpathy 新推文",
    "description": "Just shipped a new lecture...",
    "url": "https://x.com/karpathy/status/123",
    "author": { "name": "Andrej Karpathy (@karpathy)" },
    "timestamp": "2026-05-01T00:00:00Z",
    "fields": [
      { "name": "likes", "value": "100", "inline": true },
      { "name": "retweets", "value": "20", "inline": true },
      { "name": "replies", "value": "5", "inline": true }
    ]
  }]
}
```

### generic_webhook
```json
{
  "event": "x.new_tweet",
  "timestamp": "2026-05-01T00:00:00Z",
  "tweet": {
    "tweetId": "123",
    "url": "https://x.com/karpathy/status/123",
    "content": "Just shipped a new lecture...",
    "contentTruncated": false,
    "publishTime": "2026-05-01T00:00:00Z",
    "lang": "en",
    "author": { "name": "Andrej Karpathy", "username": "karpathy", "isVerified": true },
    "stats": { "likes": 100, "retweets": 20, "replies": 5, "views": 10000, "bookmarks": 8, "quotes": 2 },
    "isRetweet": false,
    "isReply": false,
    "inReplyToTweetId": null
  }
}
```

## Recording 集成

monitor 工具调用和 `check` / `daemon` 都接入 `@js-eyes/skill-recording`：

- `~/.js-eyes/skill-records/js-x-ops-skill/history/*.jsonl` - 每次 monitor 工具 / check 调用记一行
- `~/.js-eyes/skill-records/js-x-ops-skill/debug/*` - `--recording-mode debug` 时写调试 bundle，含：
  - `check_start` / `fetch_start` / `fetch_done` / `dedup` / `notify` / `check_end`
  - 每一步 `ts` 时间戳 + 关键数值

启用：
```bash
node index.js monitor check karpathy --recording-mode debug
node index.js monitor daemon --recording-mode debug --interval 60
```

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `E_MONITOR_NOT_INITIALIZED` | 首次使用 | `node index.js monitor init` |
| `E_MONITOR_CONFIG_INVALID` | config 手工改坏 | 按 error.detail.errors 修；也可删 config.json 重 init |
| `daemon_already_running` | pid 文件未清 | 先 `node index.js monitor stop`；残留用 `monitor daemon --force` |
| 通知不发 / `channels` 为空 | 没配 channels 全局名单 | 编辑 config.json `channels` 字段，或在 account 级 `channels` 指定 |
| feishu 返回 code=19021 | signature 不匹配 | `secret` 错或时钟偏移；签名是 `HMAC-SHA256(key=timestamp+"\n"+secret, msg="")` |
| 推文结构缺字段 | ops-skill bridge schema 退化 | 同 ops-skill 主文档：`JS_X_DISABLE_BRIDGE=1` 走 DOM 兜底；或 diff bridge |
| 连续失败 ≥ 5 次 daemon 退出 | X 登录掉了 / 限流 | 浏览器登录 X；或 `check --dry-notify` 先排查 |

## 明确不做的事

- **不发任何 X 推文 / 不点赞 / 不转推 / 不关注** - 只调 ops-skill 的 READ API
- **不依赖 OpenClaw** - 调度/通知完全独立
- **不内置邮件 / SMS / Slack / Teams** - 需要的话通过 `generic_webhook` + 中转服务
- **不做 UI / Dashboard** - 纯 CLI + AI 工具
- **不做 AI 摘要 / 翻译** - 可以在 `generic_webhook` 收到事件后自行 pipeline
