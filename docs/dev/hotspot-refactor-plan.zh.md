# 代码热点拆分实施计划

> 状态：实施中（阶段一、二已完成）
>
> 更新日期：2026-07-19

## 1. 目标

在不改变用户行为、协议、配置格式和发布产物的前提下，拆分当前仍然承担多类职责的大文件，降低修改冲突、回归范围和后续测试成本。

本轮完成后，希望达到以下结果：

- 命令行、OpenClaw、构建器和扩展入口只负责组装与路由。
- 浏览器共用实现继续以 `extensions/shared/` 为唯一来源。
- X Skill 中的查询构造、DOM 注入脚本、写操作和 API 编排形成明确边界。
- 新模块拥有就近测试；原有测试、覆盖率和发布门禁不降低。
- 普通职责模块尽量控制在 700 行以内，入口文件尽量控制在 300 行以内。

行数只用于发现异常聚合，不作为机械拆文件的唯一标准。内嵌浏览器脚本、声明式数据和生成副本应按职责与运行边界判断。

## 2. 拆分前基线

| 热点 | 当前规模 | 主要问题 | 优先级 |
| --- | ---: | --- | --- |
| `apps/cli/src/cli.js` | 约 1900 行 | 参数、输出、服务、诊断、技能和 Native Host 命令聚合 | P0 |
| `openclaw-plugin/index.mjs` | 约 1350 行 | 生命周期、共享服务、Action 注册、watcher 聚合 | P0 |
| `packages/devtools/lib/builder.js` | 约 980 行 | Skill、站点、扩展构建和版本同步聚合 | P1 |
| `extensions/*/background/background.js` | 约 2000 行 | 连接状态、消息路由、浏览器操作和权限校验聚合 | P1 |
| `skills/js-x-ops-skill/scripts/x-post.js` | 约 3000 行 | CLI、查询构造、DOM 写操作和主流程聚合 | P2 |
| `skills/js-x-ops-skill/lib/api.js` | 约 2000 行 | 四类读取流程、Bridge 选择和 fallback 聚合 | P2 |

扩展目录中的 `browser-control-methods.js` 和 `utils.js` 存在 Chrome、Firefox 副本，但它们由 `extensions/shared/` 同步生成，不作为独立重复实现处理。

## 3. 实施约束

每个阶段遵循同一套约束：

1. 先增加或确认行为契约，再移动实现。
2. 优先使用“提取并转发”，不在同一提交中重写算法。
3. 对外导出、错误文本、退出码、日志级别和 JSON 结果保持兼容。
4. 不修改协议字段、默认配置、安全策略和扩展权限。
5. 不引入新的运行时依赖，不进行版本升级或发布配置变更。
6. 每次提交只处理一个职责边界，并保持可独立回退。
7. 每阶段完成后执行该模块测试；合并前执行完整门禁。

## 4. PR 与提交组织

热点跨度较大，不放入一个不可审阅的超大 PR。采用以下串行 PR：

1. `refactor(cli)`：计划文档、CLI 拆分。
2. `refactor(openclaw)`：OpenClaw 插件入口拆分。
3. `refactor(devtools)`：构建器拆分。
4. `refactor(extension)`：扩展后台编排层拆分。
5. `refactor(x-skill)`：X Skill 热点拆分。
6. `test(refactor)`：仅在前述阶段仍有契约缺口时补最终测试；否则省略。

后续 PR 基于前一项合并后的 `main` 创建，避免长期堆叠分支。每个 PR 使用独立、可回滚的提交，并在描述中记录拆分前后行数与验证结果。

## 5. 阶段一：CLI 拆分

### 5.1 目标结构

```text
apps/cli/src/
├── cli.js
├── lib/
│   ├── args.js
│   ├── output.js
│   ├── process.js
│   └── versions.js
└── commands/
    ├── audit.js
    ├── config.js
    ├── consent.js
    ├── doctor.js
    ├── egress.js
    ├── extension.js
    ├── native-host.js
    ├── security.js
    ├── server.js
    ├── skill.js
    └── skills/
        ├── index.js
        ├── install.js
        ├── update.js
        ├── verify.js
        └── links.js
```

实际文件可根据共享依赖适当合并，避免为了行数制造过小模块。

### 5.2 实施顺序

1. 为命令路由、帮助文本、错误出口和公开导出补充契约断言。
2. 提取无副作用的参数、版本、路径和输出辅助函数。
3. 逐个提取体量较小的命令处理器。
4. 将 `commandSkills` 按安装、更新、校验、启停和外部目录管理拆分。
5. 将 `cli.js` 收敛为解析、路由和顶层错误处理。
6. 更新导入边界检查，禁止命令模块反向依赖 CLI 入口。

### 5.3 验收

- `cli.js` 不超过约 300 行。
- 原有 CommonJS 导出保持兼容。
- `--help`、`doctor --json`、服务管理和 Skills 命令输出保持兼容。
- `test/npm-cli.test.js`、`test/doctor-json.test.js`、`test/skill-update.test.js` 全部通过。

### 5.4 实施结果

- `cli.js` 从约 1900 行收敛为 96 行，只保留命令路由与兼容导出。
- 公共辅助函数移入 `lib/`，跨命令运行依赖集中在 168 行的组合上下文中。
- 普通命令处理器已按领域拆分；Skills 命令继续拆为 7 个子模块。
- 最大命令模块约 474 行，所有命令模块均低于 700 行。
- 新增结构契约，约束入口规模、公开导出、帮助路由、未知命令错误和反向依赖。

## 6. 阶段二：OpenClaw 插件拆分

### 6.1 目标结构

```text
openclaw-plugin/
├── index.mjs
├── lifecycle.mjs
├── shared-server.mjs
├── registration-context.mjs
├── watchers.mjs
└── actions/
    ├── core.mjs
    ├── browser.mjs
    ├── security.mjs
    └── skills.mjs
```

### 6.2 实施顺序

1. 记录注册工具名称、schema、服务与 CLI 注册数量的契约快照。
2. 提取共享服务器的 acquire/release 状态机。
3. 提取 watcher、debounce、内容指纹和 teardown。
4. 按领域移动 Action 定义，保留统一的注册包装器。
5. 提取 registration context，集中持有生命周期资源。
6. 将 `index.mjs` 收敛为配置解析、上下文创建和注册调用。

### 6.3 验收

- 重复 `register()`、交叉 teardown 和共享端口复用行为不变。
- 工具名称、输入 schema、描述和返回结构不变。
- `index.mjs` 不超过约 300 行。
- 生命周期、单工具注册和 Native Host 相关测试全部通过。

### 6.4 实施结果

- `index.mjs` 从约 1350 行收敛为 255 行，只保留配置解析和模块组装。
- Browser、Skills 和管理 Action 已按领域拆分，并锁定完整 action 名称与 schema 基线。
- 共享服务器、注册生命周期、sidecar 上下文、服务、CLI、watcher、策略和单工具路由均形成独立模块。
- 新增共享服务器引用计数测试和模块反向依赖/规模约束。

## 7. 阶段三：构建器拆分

### 7.1 目标结构

```text
packages/devtools/lib/build/
├── filesystem.js
├── skill-bundle.js
├── skills-registry.js
├── site.js
├── extensions.js
└── versioning.js
```

`packages/devtools/lib/builder.js` 继续作为稳定门面，重新导出原有函数。

### 7.2 实施顺序

1. 提取纯文件系统与散列辅助函数。
2. 分离主 Skill 包、子 Skill 包和注册表生成。
3. 分离站点构建与下载资产裁剪。
4. 分离 Chrome/Firefox 构建和签名封装。
5. 分离版本文件收集、依赖同步和 badge 更新。
6. 为关键产物清单、版本同步和未签名默认行为补契约测试。

### 7.3 验收

- `builder.js` 仅为兼容门面。
- ZIP/XPI、注册表、SHA sidecar 和站点文件名不变。
- 默认构建仍不签名，Firefox 签名参数仍不会出现在日志中。
- Skill、Chrome、Firefox 开发版和站点构建全部通过。

## 8. 阶段四：扩展后台编排层拆分

### 8.1 原则

Chrome MV3 与 Firefox MV2 的加载机制不同。拆分首先发生在 `extensions/shared/`，再通过现有同步检查生成浏览器副本，不手工维护两套逻辑。

建议的共享职责：

- 连接发现、重连、健康检查和熔断状态。
- 服务端消息分派与响应关联。
- runtime 消息分派和发送者校验。
- HTML、脚本、CSS、上传和截图操作。
- 订阅管理与 Tab 状态同步。
- Native Messaging 配置同步。

### 8.2 实施顺序

1. 固化 shared 同步检查和 Chrome/Firefox 消息契约。
2. 从无浏览器副作用的路由表、校验和状态转换开始提取。
3. 提取连接状态机，保留统一 BrowserControl 外观。
4. 提取浏览器操作处理器，并显式注入 browser API。
5. 提取 runtime 消息入口和敏感操作策略。
6. 重新生成浏览器副本，并验证两种扩展加载。

### 8.3 验收

- `extensions/shared/` 仍为唯一可编辑来源。
- Chrome/Firefox 不新增手写漂移。
- 认证、重连、请求去重、限流、上传和截图行为不变。
- shared 检查、扩展契约测试、Chrome 构建及 Firefox lint/build 通过。

## 9. 阶段五：X Skill 拆分

### 9.1 前置测试

这一阶段先为以下纯行为建立测试：

- 参数解析与互斥选项。
- Tweet ID/URL 归一化。
- GraphQL 查询和 mutation 请求结构。
- Bridge/fallback 路由判断。
- 搜索、Profile、Post、Home 结果封装。
- dry-run 不产生写操作。

浏览器注入脚本至少增加语法编译测试和关键选择器/operationName 契约，不对格式化后的整段源码做脆弱快照。

### 9.2 `x-post.js` 拆分

- `commands/post-options.js`：参数解析与校验。
- `graphql/tweet-detail.js`：详情与分页查询构造。
- `graphql/tweet-write.js`：发帖与回复 mutation。
- `dom/post-read.js`：DOM 读取回退。
- `dom/post-write.js`：回复、发帖和引用操作。
- `media/composer-image.js`：图片注入流程。
- `flows/post.js`：读取与写入编排。

### 9.3 `lib/api.js` 拆分

- `api/search.js`
- `api/profile.js`
- `api/post.js`
- `api/home.js`
- `api/bridge-routing.js`
- `api/run-context.js`

`lib/api.js` 保留公共 API 聚合与兼容导出。

### 9.4 验收

- `x-post.js` 只保留 CLI 启动与顶层流程。
- `lib/api.js` 只保留公共导出。
- 官方 API、Bridge、GraphQL 和 DOM fallback 的优先级不变。
- dry-run、批量读取、线程、回复、引用和图片路径保持兼容。
- X Skill 契约、CLI/API 单测和相关打包检查全部通过。

## 10. 全量验证门槛

每个 PR 至少执行与修改范围相关的测试；最终阶段执行：

```bash
npm run lint
npm run typecheck
npm run check:extension-shared
npm test
npm run test:coverage
npm run scan:security
npm audit --omit=dev
npm audit
npm run package:smoke
npm run build
```

扩展阶段额外执行 Firefox lint 与未签名构建。X Skill 阶段额外执行 Skill bundle 和对应契约测试。

覆盖率不得低于当前门槛；新增的纯路由、状态转换和参数解析模块应由单元测试直接覆盖。

## 11. 停止条件与回滚策略

出现以下任一情况时停止继续拆分，先修复或回滚当前小步：

- 对外输出、协议字段、扩展消息或工具 schema 意外变化。
- 为移动代码而需要新增全局状态或循环依赖。
- Chrome 与 Firefox 无法通过同一 shared 来源表达行为。
- 测试只能依赖真实账号、真实发布凭据或不可重复的线上写操作。
- 单个提交同时包含重构和功能修复，无法独立判断回归来源。

每个阶段以小提交推进，因此回滚以提交为单位，不回退其他已验证阶段。

## 12. 完成定义

本计划在以下条件全部满足后完成：

- 五类热点均完成职责拆分或记录了保留现状的明确理由。
- 所有入口达到薄编排层目标，不再直接承载大段领域实现。
- 新模块边界有测试或明确由既有集成测试覆盖。
- 完整 CI、构建、打包、安全扫描和审计通过。
- 拆分前后用户命令、插件工具、扩展协议和发布产物兼容。
- 发布密钥、Trusted Publisher 和 AMO 配置仍保持在正式新版本发布任务范围之外。
