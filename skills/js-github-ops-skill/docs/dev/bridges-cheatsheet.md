# js-github-ops-skill bridges 速查

## 数据路径

| Bridge | READ 方法 | 数据源 |
|--------|-----------|--------|
| repo | `getRepo` | `GET /repos/{owner}/{repo}` |
| issues | `listIssues` | `GET /repos/{owner}/{repo}/issues?state=&per_page=&page=` |
| issue | `getIssue` | `GET /repos/{owner}/{repo}/issues/{number}` |

- 均在浏览器上下文请求 **`https://api.github.com`**，`Accept: application/vnd.github+json`，`credentials: omit`。
- 公开仓库可匿名；私有仓库通常会 `404`，需另寻带授权的路径（本 skill MVP 不包含）。

## `normalizeOwnerRepoArgs`

参数优先级：`owner` + `repo` 成对；否则解析 `slug` 或 `ownerRepo`（`owner/repo` 字符串）。

## 列表 PR 说明

GitHub 将 PR 也挂在 `/issues` 列表接口中；`listIssues` 默认 `excludePulls=true`，去掉 `pull_request` 字段存在的项。

## INTERACTIVE

`navigateLocation` 仅允许 host 匹配 `*.github.com`。

## 实用工具（`bridges/common.js`）

| 名称 | 用途 |
|------|------|
| `fetchGithubApi` | 统一 fetch + 非 JSON 截断 |
| `parseRepoRootPath` / `parseIssuesListPath` / `parseIssueDetailPath` | 从 `location.pathname` 解析 |
| `readLoginMeta` | `meta[name=user-login]` |
| `navigateLocation` | `location.assign` 白名单 |

## 开发者踩点

- `node index.js xhr-log --filter 'api\\.github\\.com'` 聚合近期 API 请求。
- `node index.js dom-dump` 查看 GitHub 页常用选择器节点。

## 版本

各 bridge 文件顶部 `const VERSION = '0.1.0'`；修改后 bump，`Session::ensureBridge` 会重注。
