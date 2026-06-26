# Native Messaging Token 自动注入

> 最后更新: 2026-04-24（2.6.2 安全卫生版本：将本地 launcher 提升为首选安装路径）

JS Eyes 2.4+ 通过浏览器 Native Messaging 协议，让扩展自动从本机读取 `server.token`
并注入到扩展存储，消除用户手工复制 token 的环节。

## 工作原理

```
Chrome / Firefox 扩展
  ├─ chrome.runtime.connectNative('com.js_eyes.native_host')
  │     └─ 发送 {"type":"get-config"}
  ↓
js-eyes-native-host (Node 进程, stdio 4-byte-length 帧)
  ├─ 读取 ~/.js-eyes/runtime/server.token
  ├─ 读取 ~/.js-eyes/config/config.json（服务监听主机/端口）
  └─ 返回 {"ok":true,"serverToken":"...","serverUrl":"ws://127.0.0.1:18080","httpUrl":"http://127.0.0.1:18080"}
```

Native host 进程仅在收到连接请求时由浏览器拉起，返回配置后立即退出。

## 安装

**推荐（本地 launcher，零网络）：** 在已克隆或本地 `npm install` 过 `js-eyes` 的机器上，
使用仓库自带的一行包装脚本即可，不会命中 npm registry：

```bash
# macOS / Linux
bin/js-eyes-native-host-install.sh --browser all

# Windows (PowerShell)
./bin/js-eyes-native-host-install.ps1 -Browser all
```

等价于直接调用 `node apps/cli/bin/js-eyes.js native-host install --browser all`。

**Fallback（npx，依赖 npm registry 可达）：**

```bash
npx js-eyes native-host install --browser all
```

`npx` 路径仅在你已全局安装 `js-eyes` 并且信任 npm 注册表时再使用；首次执行会从远端
解析/下载 `js-eyes` 包。

可选目标: `chrome` / `chrome-canary` / `chromium` / `edge` / `brave` / `firefox` / `chromium` / `all`。

### 作为独立 npm 包使用（可选）

自 2.4.0 起，native host 代码也以独立 scope 包的形式发布到 npm：
[`@js-eyes/native-host`](https://www.npmjs.com/package/@js-eyes/native-host)。该包主要用于
自定义集成场景——例如你自己的部署脚本想编程式地注册/卸载浏览器 manifest，或在不引入完整
`js-eyes` CLI 的容器里运行 host 进程。

```js
// 编程式调用 installer / manifest / paths
const { installBrowsers, uninstallBrowsers, statusBrowsers } = require('@js-eyes/native-host');

installBrowsers('all');
```

包内 `js-eyes-native-host` 可执行文件对应浏览器连接时拉起的 host 进程本身（stdio 4-byte-length
帧协议），而非安装命令。对普通用户来说，一次性运行仓库自带的本地 launcher
（`bin/js-eyes-native-host-install.sh` / `.ps1`，等价于 `node apps/cli/bin/js-eyes.js native-host install`）
仍然是推荐路径，避免命中 npm 注册表；只有当你明确希望把 native host 与 CLI 发行节奏解耦时才用这个独立包。

### 安装物路径

- macOS
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.js_eyes.native_host.json`
  - Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/...`
  - Edge: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/...`
  - Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/...`
  - Firefox: `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.js_eyes.native_host.json`
  - 启动脚本: `~/.js-eyes/native-host/js-eyes-native-host`
- Linux
  - Chrome: `~/.config/google-chrome/NativeMessagingHosts/`
  - Chromium: `~/.config/chromium/NativeMessagingHosts/`
  - Firefox: `~/.mozilla/native-messaging-hosts/`
- Windows
  - JSON 清单: `%LOCALAPPDATA%\js-eyes\native-host\com.js_eyes.native_host.json`（Chromium 家族）或 `%APPDATA%\js-eyes\native-host\...`（Firefox）
  - 注册表: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.js_eyes.native_host`，默认值指向 JSON 清单
  - 启动脚本: `%LOCALAPPDATA%\js-eyes\native-host\js-eyes-native-host.bat`

## 卸载

推荐（本地 launcher）：

```bash
node apps/cli/bin/js-eyes.js native-host uninstall --browser all
```

Fallback：

```bash
npx js-eyes native-host uninstall --browser all
```

## 查看状态

推荐（本地 launcher）：

```bash
node apps/cli/bin/js-eyes.js native-host status
```

Fallback：

```bash
npx js-eyes native-host status
```

`js-eyes doctor` 输出的末尾也会包含一个 "Native messaging host" 小节。

## 扩展侧行为

- Chrome/Firefox 扩展会在 `init()` 阶段调用 `trySyncFromNativeHost({ silent: true })`，失败静默忽略，不影响原有的手工输入路径。
- 成功时把返回的 `serverToken` 写入 `chrome.storage.local.serverToken`，如果本地没有手工配置 `serverUrl`，也会写入 host 返回的 `httpUrl`。
- Popup 上新增「从本机同步 Token / Sync Token From Host」按钮，调用同一路径并展示结果。

## 威胁模型

**本功能保护范围: 外部网页 / 跨域攻击者，不包括本机已被攻破的情况。**

- 浏览器 Native Messaging 协议把 `allowed_extensions`（Firefox）/
  `allowed_origins`（Chrome）列入清单；仅被白名单的扩展能拉起 host 并取到 token。
- Host 只读取固定路径 `~/.js-eyes/runtime/server.token`，不接受任何参数或命令。
- 协议只有 `ping` 和 `get-config`，无副作用。
- 扩展不会把 token 通过 `externally_connectable` 暴露给任意网页。
- **不覆盖**: 如果本机已被攻破（恶意进程、root、本机上的恶意扩展被用户手动加载）则攻击者本身已经具有读取 `~/.js-eyes/runtime/server.token` 的能力，token 保护失效——这属于本功能不承诺的场景。

## 协议细节

- stdio 帧: 4 字节小端长度 + UTF-8 JSON；单条消息上限 1 MiB。
- 输入:
  - `{"type":"ping"}` -> `{"ok":true,"type":"pong","version":"2.6.2"}`
  - `{"type":"get-config"}` -> `{"ok":true,"serverHost":"localhost","serverPort":18080,"serverUrl":"ws://...","httpUrl":"http://...","serverToken":"..."}`
- 失败: `{"ok":false,"error":"token-missing"}` 等。

## 排障

- **扩展连接失败**: 打开扩展的后台控制台，检查 `[native-host]` 前缀日志；常见原因是未运行 `native-host install` 或 token 文件缺失。
- **安装后没生效**: Chrome 需要重启扩展；Firefox 需要重启浏览器或禁用/启用扩展。
- **token 文件丢失**: 先运行 `js-eyes server token init` 生成新的 token。
- **日志**: Host 进程把关键事件追加到 `~/.js-eyes/logs/native-host.log`（仅事件类型与时间戳，不记录 token）。

## 手动验收清单

- [ ] macOS + Chrome: `install` -> 扩展 popup「从本机同步 Token」-> 连接成功
- [ ] macOS + Firefox: 同上
- [ ] Linux + Chrome / Chromium
- [ ] Linux + Firefox
- [ ] Windows + Chrome
- [ ] Windows + Firefox
- [ ] `server.token` 缺失时 `get-config` 返回 `token-missing`，扩展回退到手工输入
- [ ] `uninstall` 后 `status` 输出 `missing`
