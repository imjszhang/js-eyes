# JS Eyes

<div align="center">

**AI Agent 浏览器自动化**

让 AI 智能体拥有浏览器的真实视角 — 基于 WebSocket 的自动化控制，原生支持 OpenClaw

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-imjszhang%2Fjs--eyes-181717?logo=github)](https://github.com/imjszhang/js-eyes)
[![Website](https://img.shields.io/badge/Website-js--eyes.com-FCD228?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjE2IiBmaWxsPSIjRkNEMjI4Ii8+PHRleHQgeD0iNjQiIHk9IjY0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI3MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzM3MzQyRiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkpTPC90ZXh0Pjwvc3ZnPg==)](https://js-eyes.com)
[![X (Twitter)](https://img.shields.io/badge/X-@imjszhang-000000?logo=x)](https://x.com/imjszhang)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Firefox](https://img.shields.io/badge/Firefox-Manifest%20V2-FF7139?logo=firefox)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

[English](../README.md) | [中文文档](#一键安装)

</div>

---

## 一键安装

**Linux / macOS:**

```bash
curl -fsSL https://js-eyes.com/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://js-eyes.com/install.ps1 | iex
```

自动下载技能包、安装依赖，并输出 OpenClaw 插件注册路径。标准 ClawHub/OpenClaw 路径要求 Node.js 22+ 才能启用插件模式。其他安装方式见[手动安装](#手动安装)。

---

## 简介

JS Eyes 是一个浏览器扩展 + WebSocket 服务器，为 AI 智能体提供完整的浏览器自动化能力。它连接 AI Agent 框架（OpenClaw、DeepSeek Cowork 或自定义），提供标签页管理、内容提取、脚本执行、Cookie 访问等工具。

```
浏览器扩展  <── WebSocket ──>  JS-Eyes 服务器  <── WebSocket ──>  AI Agent (OpenClaw)
(Chrome/Edge/FF)               (Node.js)                         (插件: index.mjs)
```

### 支持的 Agent 框架

| 框架 | 说明 |
|------|------|
| [js-eyes/server](../server) | 内置轻量版服务器（HTTP+WS 共用端口，无认证） |
| [OpenClaw](https://openclaw.ai/)（插件） | 注册为 OpenClaw 插件 — 9 个 AI 工具、后台服务、CLI 命令 |
| [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork) | 完整版 Agent 框架（独立 WS 端口、HMAC 认证、SSE、限流） |

## 功能特性

- **实时 WebSocket 通信** — 与服务器建立持久连接
- **自动服务器探测** — 自动发现服务器能力和端点配置
- **标签页管理** — 自动同步标签页信息到服务器
- **远程控制** — 支持远程打开/关闭标签页、执行脚本
- **内容获取** — 获取页面 HTML、文本、链接
- **Cookie 管理** — 自动获取和同步页面 cookies
- **代码注入** — JavaScript 执行和 CSS 注入
- **健康检查与熔断** — 服务健康监控，自动熔断保护
- **SSE 降级** — WebSocket 连接失败时自动降级到 SSE
- **限流与去重** — 请求速率限制和去重，提升稳定性
- **自适应认证** — 自动检测服务器认证要求（HMAC-SHA256 或免认证）
- **扩展技能** — 发现并安装高级技能（如 X.com 搜索），基于基础自动化之上构建

## 支持的浏览器

| 浏览器 | 版本要求 | Manifest 版本 |
|--------|----------|---------------|
| Chrome | 88+ | V3 |
| Edge | 88+ | V3 |
| Firefox | 58+ | V2 |

## 下载

从 [GitHub Releases](https://github.com/imjszhang/js-eyes/releases/latest) 下载最新版本：

- **Chrome/Edge 扩展**: 发布资产 `js-eyes-chrome-v<version>.zip`
- **Firefox 扩展**: 发布资产 `js-eyes-firefox-v<version>.xpi`

或直接从 [js-eyes.com](https://js-eyes.com) 下载。网站中的 Chrome 和 Firefox 下载按钮都会打开最新的 GitHub Release，始终指向当前已发布资产。

## 手动安装

### 浏览器扩展

#### Chrome / Edge

1. 打开浏览器，访问 `chrome://extensions/`（Edge 访问 `edge://extensions/`）
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extensions/chrome` 文件夹

#### Firefox

**已签名 XPI**（推荐）：将 `.xpi` 文件拖拽到 Firefox 窗口中。

**临时安装**（开发模式）：打开 `about:debugging` > 此 Firefox > 临时载入附加组件 > 选择 `extensions/firefox/manifest.json`。

### OpenClaw 技能包

如果不使用[一键安装](#一键安装)，也可以手动安装：

1. 从 [js-eyes.com](https://js-eyes.com/js-eyes-skill.zip) 或 [GitHub Releases](https://github.com/imjszhang/js-eyes/releases/latest) 下载 `js-eyes-skill.zip`
2. 解压到目录（如 `./skills/js-eyes`）
3. 使用 Node.js 22+ 在解压目录中执行 `npm install`
4. 在解析后的 OpenClaw 配置文件中注册插件（见 [OpenClaw 插件](#openclaw-插件)）

### npm link 开发模式

如果你想保持公开包的 `js-eyes` 命令形态，同时把实际执行逻辑指向当前源码仓库，适合使用 `npm link`：

```bash
cd /path/to/your/js-eyes-repo
npm install

cd apps/cli
npm link
```

完成后，全局 `js-eyes` 命令会链接到本地 `apps/cli` workspace，因此你对 `apps/cli` 以及 `packages/*` 中运行时代码的修改都会立即生效。

如果是在 Windows 上验证命令位置，请把 `which js-eyes` 替换成 `where js-eyes`。

```bash
which js-eyes
js-eyes --help
js-eyes doctor
```

如果你还希望这个已链接的 CLI 直接读取当前仓库里的技能源码，而不是默认运行时目录下的技能目录，可以额外设置 `skillsDir`：

```bash
js-eyes config set skillsDir "/absolute/path/to/js-eyes/skills"
js-eyes skills enable js-x-ops-skill
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

如果后续想切回普通的全局安装方式：

```bash
cd /path/to/your/js-eyes-repo/apps/cli
npm unlink
npm uninstall -g js-eyes
```

## 使用说明

### 1. 启动兼容的服务器

**方式 A** — 内置轻量版服务器：
```bash
npm run server
# 在 http://localhost:18080 启动（HTTP + WebSocket）
```

**方式 B** — 作为 [OpenClaw](https://openclaw.ai/) 插件使用（参见下方 [OpenClaw 插件](#openclaw-插件) 章节）。

**方式 C** — 使用支持的 Agent 框架，如 [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork)。

### 2. 配置连接

1. 点击浏览器工具栏中的扩展图标
2. 输入服务器 HTTP 地址（如 `http://localhost:18080`）
3. 点击"Connect"— 扩展会自动探测 WebSocket 端点和服务器能力
4. 如果服务器需要认证，在安全设置中配置认证密钥

**自动连接：** 扩展启动时自动连接，断线后指数退避自动重连。

### 3. 验证连接

```bash
openclaw js-eyes status
```

输出显示服务器运行时间、已连接扩展数和标签页数。

### 4. 通过 CLI 管理技能

现在 `js-eyes` 也可以作为扩展技能宿主：

```bash
# 查看远端注册表和本地已安装技能
js-eyes skills list

# 安装并启用技能
js-eyes skills install js-x-ops-skill
js-eyes skills enable js-x-ops-skill

# 通过 js-eyes 宿主执行技能命令
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

技能的安装状态由 CLI 运行时目录维护，而 OpenClaw 仍可继续通过同一份技能目录中的 `openclaw-plugin` 进行加载。

### CLI 运行时目录

现在发布版 `js-eyes` CLI 默认会把配置、日志、下载、缓存和已安装技能统一存放到 `~/.js-eyes`。

- macOS: `~/.js-eyes`
- Linux: `~/.js-eyes`
- Windows: `%USERPROFILE%/.js-eyes`

如果检测到旧版本仍在使用历史平台目录，`js-eyes` 会在首次运行时自动迁移内容：

- macOS: `~/Library/Application Support/js-eyes`
- Linux: `$XDG_CONFIG_HOME/js-eyes` 或 `~/.config/js-eyes`
- Windows: `%APPDATA%/js-eyes`

如果设置了 `JS_EYES_HOME`，则仍然优先使用该自定义目录，并跳过自动迁移。

## OpenClaw 插件

JS Eyes 注册为 [OpenClaw](https://openclaw.ai/) 插件，为 AI Agent 直接提供浏览器自动化工具。

作为 native plugin 被 OpenClaw 加载时，请遵循 OpenClaw 对外部插件运行时的要求（ESM + Node 22+）。

### 提供的能力

- **后台服务** — 自动启动/停止内置 WebSocket 服务器
- **9 个 AI 工具** — 浏览器自动化 + 技能发现与安装（见下表）
- **CLI 命令** — `openclaw js-eyes status`、`openclaw js-eyes tabs`、`openclaw js-eyes server start/stop`

| 工具 | 说明 |
|------|------|
| `js_eyes_get_tabs` | 获取所有打开的标签页列表（ID、URL、标题） |
| `js_eyes_list_clients` | 获取已连接的浏览器扩展客户端列表 |
| `js_eyes_open_url` | 在新标签页或已有标签页中打开 URL |
| `js_eyes_close_tab` | 关闭指定 ID 的标签页 |
| `js_eyes_get_html` | 获取标签页的完整 HTML 内容 |
| `js_eyes_execute_script` | 在标签页中执行 JavaScript 并返回结果 |
| `js_eyes_get_cookies` | 获取标签页对应域名的所有 Cookie |
| `js_eyes_discover_skills` | 查询技能注册表，列出可安装的扩展技能 |
| `js_eyes_install_skill` | 下载、解压并注册一个扩展技能 |

### 配置方法

标准 ClawHub/OpenClaw 安装路径建议按下面顺序执行：

1. 在浏览器中安装 JS Eyes 扩展（步骤同上）
2. 在技能根目录执行 `npm install`，并确保 Node.js 版本为 22+
3. 先解析 OpenClaw 配置文件路径，优先级如下：
   - `OPENCLAW_CONFIG_PATH`
   - `OPENCLAW_STATE_DIR/openclaw.json`
   - `OPENCLAW_HOME/.openclaw/openclaw.json`
   - 默认 `~/.openclaw/openclaw.json`
4. 在解析后的 OpenClaw 配置文件中添加插件：

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/skills/js-eyes/openclaw-plugin"]
    },
    "entries": {
      "js-eyes": {
        "enabled": true,
        "config": {
          "serverPort": 18080,
          "autoStartServer": true
        }
      }
    }
  }
}
```

5. 重启或刷新 OpenClaw — 服务器自动启动，AI Agent 可通过注册的工具控制浏览器。

### 插件配置项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `serverHost` | string | `"localhost"` | 服务器监听地址 |
| `serverPort` | number | `18080` | 服务器端口 |
| `autoStartServer` | boolean | `true` | 插件加载时自动启动服务器 |
| `requestTimeout` | number | `60` | 请求超时秒数 |
| `skillsRegistryUrl` | string | `"https://js-eyes.com/skills.json"` | 扩展技能注册表 URL |
| `skillsDir` | string | `""` | 技能安装目录（空值则自动使用技能包内的 `skills/` 目录） |

## 扩展技能

JS Eyes 支持**扩展技能** — 基于基础浏览器自动化构建的高级能力。主 ClawHub bundle 刻意保持最小运行时，**不会预装子技能**。每个技能添加新的 AI 工具，可在基础栈跑通后独立安装。

每个技能现在同时支持两种宿主方式：
- 扩展 `js-eyes` CLI 的技能命令
- 通过技能自带的 native `openclaw-plugin` 暴露给 OpenClaw

| 技能 | 说明 | 工具 |
|------|------|------|
| [js-x-ops-skill](../skills/js-x-ops-skill/) | X.com (Twitter) 内容操作 — 搜索内容、浏览时间线与首页 Feed、读取帖子详情并处理发帖流程 | `x_search_tweets`、`x_get_profile`、`x_get_post`、`x_get_home_feed` |

### 发现技能

AI Agent 可以自动发现可用技能：

```
# 通过 AI 工具
js_eyes_discover_skills

# 通过技能注册表
https://js-eyes.com/skills.json
```

### 安装扩展技能

**一键安装：**

```bash
# Linux / macOS（方式一：参数）
curl -fsSL https://js-eyes.com/install.sh | bash -s -- js-x-ops-skill

# Linux / macOS（方式二：环境变量，与 PowerShell 一致）
curl -fsSL https://js-eyes.com/install.sh | JS_EYES_SKILL=js-x-ops-skill bash

# Windows PowerShell
$env:JS_EYES_SKILL="js-x-ops-skill"; irm https://js-eyes.com/install.ps1 | iex
```

**通过 AI Agent：** Agent 调用 `js_eyes_install_skill`，传入技能 ID — 自动下载、解压、安装依赖，并按解析后的 OpenClaw 配置路径注册插件。

**通过 js-eyes CLI：**

```bash
js-eyes skills install js-x-ops-skill
js-eyes skills enable js-x-ops-skill
js-eyes skill run js-x-ops-skill search "AI agent" --max-pages 2
```

**手动安装：** 从 [js-eyes.com/skills/js-x-ops-skill/](https://js-eyes.com/skills/js-x-ops-skill/js-x-ops-skill-skill.zip) 下载技能 zip，解压到 `skills/js-eyes/skills/js-x-ops-skill/`，执行 `npm install`，然后在 `openclaw.json` 中添加插件路径。

## 构建与发布

### 前置条件

- Node.js >= 22
- 在项目根目录执行 `npm install`
- `npm run build:firefox` 需要 `AMO_API_KEY` 和 `AMO_API_SECRET`。仓库已通过 `npm install` 本地安装 `web-ext`，不再要求额外全局安装。

### 构建命令

```bash
# 仅构建主 ClawHub/OpenClaw 技能包
npm run build:skill

# 构建站点 (docs/) + 技能包 + skills.json 注册表
npm run build:site

# 一次性构建全部正式发布产物
npm run build

# 仅打包 Chrome 扩展
npm run build:chrome

# 打包并签名 Firefox 扩展
npm run build:firefox

# 同步版本号到所有 manifest
npm run bump -- 1.5.1
```

输出文件保存在 `dist/` 目录。主技能包会 stage 到 `dist/skill-bundle/js-eyes/`，并生成版本化 zip：`dist/js-eyes-skill-v<version>.zip`。

发布到 ClawHub 时，建议直接使用构建产物（`dist/skill-bundle/js-eyes/` 或 `dist/` 中的版本化 zip），不要直接从 monorepo 根目录发布。

维护者发布检查清单（`develop` -> `main`、npm CLI、GitHub Release、Firefox 已签名 XPI、AMO 提审）见 [RELEASE.md](../RELEASE.md)。

## Smoke Test

完成一次全新的 ClawHub 安装后，建议按下面的清单验证：

1. `cd ./skills/js-eyes && npm install`
2. 确认解析后的 `openclaw.json` 包含：
   - `plugins.load.paths` -> 指向 `./skills/js-eyes/openclaw-plugin` 的绝对路径
   - `plugins.entries["js-eyes"].enabled` -> `true`
3. 重启或刷新 OpenClaw
4. 执行 `openclaw js-eyes status`
5. 安装浏览器扩展，连接到 `http://localhost:18080`，然后执行 `openclaw js-eyes tabs`
6. 让 Agent 调用 `js_eyes_get_tabs`
7. 让 Agent 调用 `js_eyes_discover_skills`
8. 用 `js_eyes_install_skill` 安装一个子技能，并确认它的插件路径被写入解析后的 OpenClaw 配置

## 故障排除

| 症状 | 解决方法 |
|------|----------|
| 扩展显示 "Disconnected" | 执行 `openclaw js-eyes status` 检查；确认 `autoStartServer` 为 `true` |
| `js_eyes_get_tabs` 返回空 | 点击扩展图标，确认地址正确，点击 Connect |
| `Cannot find module 'ws'` | 在技能根目录执行 `npm install` |
| 工具未出现在 OpenClaw 中 | 确认 `plugins.load.paths` 指向 `openclaw-plugin` 子目录 |
| Windows 路径找不到 | JSON 中使用正斜杠，如 `C:/Users/you/skills/js-eyes/openclaw-plugin` |

## 相关项目

- [OpenClaw](https://openclaw.ai/) — 可扩展插件系统的 AI Agent 框架
- [DeepSeek Cowork](https://github.com/imjszhang/deepseek-cowork) — 支持浏览器自动化的 AI Agent 框架

## 贡献

欢迎贡献！请随时提交 Pull Request。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](../LICENSE) 文件。

## 作者

由 **[@imjszhang](https://x.com/imjszhang)** 创建

---

<div align="center">

**为任何 AI Agent 框架提供浏览器自动化能力**

[js-eyes.com](https://js-eyes.com) | [GitHub](https://github.com/imjszhang/js-eyes) | [@imjszhang](https://x.com/imjszhang)

</div>
