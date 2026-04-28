---
name: js-github-ops-skill
description: GitHub 仓库与 Issues 只读 + 浏览器导航 skill（REST + PAGE_PROFILES + bridges）。
version: 0.1.0
metadata:
  openclaw:
    emoji: "\u2699"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
    platforms:
      - github.com
---

# js-github-ops-skill

面向 **github.com** 的只读 + **仅改浏览器 URL**（`location.assign`）的 JS Eyes 扩展技能。READ 数据走官方 **GitHub REST API**（`https://api.github.com`）：浏览器内 `fetch` 支持匿名访问**公开**仓库；与 GitHub 网页**不同源**，但 CORS 对只读公开 API 可用，且不携带浏览器 Cookie（`credentials: 'omit'`）。登录态探测仅使用页面内 `meta[name="user-login"]`。

## 依赖

- **JS Eyes Server** 已启动；扩展已连接。
- **宿主 + 扩展**双侧 `allowRawEval`（注入 bridge），参见根目录 JS Eyes 部署说明。
- 浏览器内至少打开一个 **github.com** tab（READ 默认不切走当前 tab；无 tab 时可 `createIfMissing` 打开示例页）。

## 安全档位

| 档位 | 说明 |
|------|------|
| READ | `fetch` api.github.com + JSON 解析；不改 DOM / URL |
| INTERACTIVE | 仅 `location.assign` 到 `*.github.com` |
| DESTRUCTIVE | **不做**（不 star / comment / PR / 写 API） |

## AI 工具（`skill.contract.js`）

| 工具 | 说明 |
|------|------|
| `github_session_state` | 登录态（meta） |
| `github_get_repo` | 仓库元数据 |
| `github_list_issues` | Issues 列表（默认排除 PR） |
| `github_get_issue` | 单条 Issue |
| `github_navigate_*` | 仅导航 |

## CLI

```bash
cd skills/js-github-ops-skill && npm install

node index.js doctor
node index.js get-repo octocat/Hello-World --pretty
node index.js list-issues octocat/Hello-World --limit 10
node index.js get-issue octocat/Hello-World 1347

node index.js navigate-repo octocat/Hello-World
node index.js navigate-issues octocat/Hello-World
node index.js navigate-issue octocat/Hello-World 1347

node index.js dom-dump --anchors
node index.js xhr-log --filter 'github\\.com|api\\.github\\.com'
```

## 启用

```bash
js-eyes skills link /path/to/js-eyes/skills/js-github-ops-skill
js-eyes skills reload
```

## Page profiles

| profile | bridge |
|---------|--------|
| `repo` | `__jse_github_repo__` |
| `issues` | `__jse_github_issues__` |
| `issue` | `__jse_github_issue__` |

## 故障排查

| 现象 | 处理 |
|------|------|
| `E_NO_TAB` | 打开任意 github.com 页面 |
| `RAW_EVAL_DISABLED` | 打开宿主与扩展的 raw eval |
| `fetch_failed` 403/404 | 私有库或未授权；公开库请检查 owner/repo |
| 429 | API 速率限制；稍后重试 |

## Recording

跟随 `js-eyes` 全局 `recording` 配置；落盘目录：`~/.js-eyes/skill-records/js-github-ops-skill/`。

## 合规

仅个人自动化用途；遵守 [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) 与 [REST API 文档](https://docs.github.com/en/rest)。
