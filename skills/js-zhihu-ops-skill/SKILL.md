---
name: js-zhihu-ops-skill
description: 知乎内容读取 skill，提供回答与专栏详情读取能力。
version: 3.0.0
metadata:
  openclaw:
    emoji: "\U0001F4D8"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-zhihu-ops-skill

面向知乎内容读取的 skill。v3.0 起按 `PAGE_PROFILES + Bridges + Session` 架构升级，支持回答、专栏、问题、搜索、用户、首页多个 profile，并保留 `JS_ZHIHU_DISABLE_BRIDGE=1` 旧脚本 fallback。

## 安全分级

- **READ**：`zhihu_get_answer`、`zhihu_get_article`、`zhihu_session_state`、`zhihu_get_question_answers`、`zhihu_search`、`zhihu_get_user`、`zhihu_get_user_answers`、`zhihu_get_user_articles`。
- **INTERACTIVE**：`zhihu_navigate_*`。仅 `location.assign` 导航，不模拟点击、不改 DOM。
- **DESTRUCTIVE**：不引入。本文档不提供回答发布、评论、点赞、收藏、关注等能力。

## 提供的 AI 工具

| 工具 | 类型 | 说明 |
|------|------|------|
| `zhihu_get_answer` | READ | 读取知乎回答详情 |
| `zhihu_get_article` | READ | 读取知乎专栏详情 |
| `zhihu_session_state` | READ | 读取登录态、cookie 标记、登录墙/验证码状态 |
| `zhihu_get_question_answers` | READ | 读取问题页标题、描述和回答摘要列表 |
| `zhihu_search` | READ | 读取搜索结果 |
| `zhihu_get_user` | READ | 读取用户主页资料 |
| `zhihu_get_user_answers` | READ | 读取用户回答列表摘要 |
| `zhihu_get_user_articles` | READ | 读取用户文章列表摘要 |
| `zhihu_navigate_*` | INTERACTIVE | answer / article / question / search / user / home 导航 |
| `zhihu_monitor_*` | READ | list/status/add/remove/test 监控配置工具 |

## CLI

```bash
node skills/js-zhihu-ops-skill/index.js answer "https://www.zhihu.com/question/1/answer/2" --pretty
node skills/js-zhihu-ops-skill/index.js article "https://zhuanlan.zhihu.com/p/123456" --pretty
node skills/js-zhihu-ops-skill/index.js session-state --pretty
node skills/js-zhihu-ops-skill/index.js doctor --pretty
node skills/js-zhihu-ops-skill/index.js records --last 5 --pretty
node skills/js-zhihu-ops-skill/index.js question-answers "https://www.zhihu.com/question/1" --limit 10 --pretty
node skills/js-zhihu-ops-skill/index.js search "大模型" --limit 10 --pretty
node skills/js-zhihu-ops-skill/index.js user "people-slug" --pretty
node skills/js-zhihu-ops-skill/index.js monitor init --pretty
node skills/js-zhihu-ops-skill/index.js monitor add search "大模型" --limit 10 --pretty
```

## READ 调度

知乎当前以 DOM 抽取为主，`readMode` 支持 `auto|dom|api`，默认 `dom`。`api` 暂不作为主路径，后续若接入稳定公开数据源再启用。

每次 READ 返回顶层包含 `run`、`metrics`、`result`、`triedMethods`、`usedMethod`、`readMode`、`requestedReadMode`、`fallback`、`antiCrawlState`。`antiCrawlState` 会区分 `login_required`、`captcha_required` 等页面阻断。

## Recording

`js-zhihu-ops-skill` 现已接入统一的 skill recording 底座，支持调用历史、结果缓存和调试记录。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-zhihu-ops-skill/`，其中包含：

- `history/`：按月滚动的调用历史 `jsonl`
- `cache/<toolName>`：按工具维度区分的结构化缓存
- `debug/`：调试模式下的页面步骤、DOM 统计和结果快照

v3.0 新增 `records` 子命令，可查看最近 history 行。缓存命名空间改为工具名维度，旧 `answer/article` 脚本仍可通过 `JS_ZHIHU_DISABLE_BRIDGE=1` 使用。

## Visual / 治理

CLI 支持 `--visual`、`--visual-trace [path]`、`--visual-record [dir]`，当前返回统一 `visual` 元数据字段。知乎版治理包含：

- 登录墙、验证码、空白页、页面结构漂移的阻断识别。
- `--rate-limit` 或 `JS_ZHIHU_RATE_LIMIT=1` 启用单进程限流。
- 批量工具保守限制 `limit` / `maxPages` / `timeoutMs`，避免长跑触发风控。

## Monitor 子系统

监控配置落在 `~/.js-eyes/skill-data/js-zhihu-ops-skill/monitor/config.json`，可用 `JS_ZHIHU_MONITOR_HOME` 覆盖。支持 `users`、`questions`、`searches` 三类 target。

AI 工具只开放 `list/status/add/remove/test`，其中 `add/remove` 仅写 config，不发通知；`test` 是 URL dry-run，不写 state。长跑 daemon、主动通知和 webhook 发送不进入 AI 工具列表。

## 架构

```
skills/js-zhihu-ops-skill/
  SKILL.md
  package.json
  index.js                     委托 cli/index.js
  skill.contract.js            工厂化 + AI 工具表
  cli/index.js                 dispatcher（读 lib/commands.js）
  lib/
    config.js                  PAGE_PROFILES（answer/article/question/search/user/home）
    session.js                 主调度器（tab 选择 + bridge 注入）
    runTool.js                 READ 主管道（readMode + audit + history/cache/debug）
    commands.js                CLI 声明式映射
    toolTargets.js             工具参数 → URL
    runMonitor.js              monitor 工具定义与配置操作
    monitor/
      config.js
      dispatcher.js
      paths.js
    runtimeConfig.js           server/recording 配置
    js-eyes-client.js          BrowserAutomation
    zhihuUtils.js              旧脚本 fallback 抽取器
  bridges/
    common.js                  DOM helpers + sessionState + blocker detect
    answer-bridge.js
    article-bridge.js
    question-bridge.js
    search-bridge.js
    user-bridge.js
    home-bridge.js
  scripts/
    zhihu-answer.js            fallback（JS_ZHIHU_DISABLE_BRIDGE=1）
    zhihu-article.js           fallback（JS_ZHIHU_DISABLE_BRIDGE=1）
  tests/                       node --test
```
