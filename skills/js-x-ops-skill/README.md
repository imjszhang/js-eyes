# JS X Ops Skill: X 平台内容操作

基于 JS-Eyes SDK 的 X.com (Twitter) 内容操作技能，面向 X 平台内的多类常见操作，覆盖搜索发现、用户主页浏览、帖子详情读取、首页 Feed 浏览，以及回复、新帖、Quote Tweet、串帖等发布流程，便于后续继续向更广泛的平台能力扩展。

## 能力范围

| 命令 | 说明 | 数据来源/方式 |
|------|------|---------|
| `search <keyword>` | 按关键词搜索帖子，支持高级筛选 | DOM 提取（GraphQL 已实现但未启用） |
| `profile <username>` | 浏览指定用户主页与时间线内容 | UserTweets GraphQL API，DOM fallback |
| `post <url_or_id>` | 读取帖子详情，支持对话线程、回复与引用信息 | TweetDetail GraphQL API，DOM fallback |
| `post --reply/--post/--quote/--thread` | 执行回复、发新帖、Quote Tweet、串帖等发布操作 | 见下方说明 |
| `home` | 浏览首页 Feed（For You / Following） | HomeTimeline GraphQL API，DOM fallback |

## 前提条件

1. **JS-Eyes Server** 运行中（默认 `ws://localhost:18080`）
2. **浏览器扩展** 已安装并连接到 Server
3. 浏览器中已**登录 X.com**

## 安装

```bash
# 在 js-eyes 根目录安装依赖（ws 模块）
cd skills/js-x-ops-skill
npm install
```

## 使用

```bash
# 搜索
node index.js search "AI agent" --max-pages 3
node index.js search "机器学习" --lang zh --sort latest

# 用户时间线
node index.js profile elonmusk --max-pages 10

# 推文详情
node index.js post https://x.com/user/status/1234567890 --with-thread
node index.js post https://x.com/user/status/1234567890 --with-replies 50

# 回复推文
node index.js post https://x.com/user/status/1234567890 --reply "回复内容"

# 发新帖 / 串推 / 引用帖
node index.js post --post "新帖内容"
node index.js post --post "看看这张图" --image path/to/image.png
node index.js post --post "评论" --quote https://x.com/user/status/1234567890
node index.js post --thread "段1" "段2" "段3" --thread-delay 2000

# 首页推荐
node index.js home --feed following --max-pages 5
```

## 定位

这不是一个只做搜索的技能，而是一组围绕 X 平台内容流转设计的操作能力：

1. **发现内容**：通过搜索和首页 Feed 找到目标内容
2. **浏览内容**：查看用户主页、时间线和帖子详情
3. **分析内容**：提取结构化 JSON，便于后续程序处理
4. **发布内容**：执行回复、新帖、引用帖和串帖

## 工作原理

本技能通过 JS-Eyes SDK（`lib/js-eyes-client.js`）与浏览器交互：

1. **Tab 复用**：文件锁 tab 注册表（`work_dir/cache/tab_registry.json`），同域名跨进程复用，30 分钟超时自动清理
2. **GraphQL API**：动态扫描 JS bundle 发现 queryId（带 24h 缓存），在浏览器上下文中调用 X.com GraphQL API
3. **DOM 提取兜底**：当 GraphQL API 不可用时，回退到 DOM 解析方式
4. **断点续传**：search/profile/home 支持 `--resume`，边抓边保存
5. **Rate Limit 保护**：429 自动退避，连续 3 次后暂停 5 分钟；queryId 400/404 自动重新发现

### 发布能力实现方式

| 操作 | 实际实现 |
|------|----------|
| `--reply` | 优先 **GraphQL CreateTweet**（可靠返回 reply ID），失败 fallback 到 Intent URL（`reply` 风格）或 DOM（`thread` 风格） |
| `--post` | 首页 DOM composer，**不使用 GraphQL** |
| `--post --quote` | **GraphQL CreateTweet** + `attachment_url`，失败则 DOM fallback |
| `--thread` | 第一条 DOM 新帖 + 后续逐条在上一条页面 DOM 回复，**不使用 GraphQL** |

发帖成功后输出 `__RESULT_JSON__:{"success":true,"replyTweetId":"..."}` 或 `quoteTweetId`。Intent/DOM fallback 模式也会尝试从页面 URL 或 DOM 中捕获 reply ID。

### 使用的 JS-Eyes API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { searchTweets, getProfileTweets, getPost, getHomeFeed } = require('./lib/api');

const browser = new BrowserAutomation('ws://localhost:18080');

// 编程 API — 推荐用法
const result = await searchTweets(browser, 'AI agent', { maxPages: 3 });
const profile = await getProfileTweets(browser, 'elonmusk', { maxPages: 10 });
const post = await getPost(browser, 'https://x.com/user/status/123', { withThread: true });
const feed = await getHomeFeed(browser, { feed: 'foryou', maxPages: 5 });

// 底层 JS-Eyes SDK 能力
const tabs = await browser.getTabs();
const tabId = await browser.openUrl('https://x.com/home');
const data = await browser.executeScript(tabId, `
  // 此代码在浏览器上下文中执行，可访问页面 DOM 和 API
  const response = await fetch('/graphql/...', { headers: ... });
  return await response.json();
`);
await browser.closeTab(tabId);
```

## 输出

结果保存为 JSON 文件：

```
work_dir/scrape/
├── x_com_search/{keyword}_{timestamp}/data.json
├── x_com_profile/{username}_{timestamp}/data.json
├── x_com_post/{tweetId}_{timestamp}/data.json
└── x_com_home/{feed}_{timestamp}/data.json
```

## 免责声明

本示例仅供学习和个人研究使用。请遵守 X.com 的服务条款和使用政策。
