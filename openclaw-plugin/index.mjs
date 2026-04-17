import { createRequire } from "node:module";

function patchWindowsHide() {
  if (process.platform !== "win32") return;
  try {
    const require = createRequire(import.meta.url);
    const cp = require("node:child_process");

    const _spawn = cp.spawn;
    cp.spawn = function patchedSpawn(cmd, args, opts) {
      if (args && typeof args === "object" && !Array.isArray(args)) {
        if (args.windowsHide === undefined) args.windowsHide = true;
        return _spawn.call(this, cmd, args);
      }
      if (!opts || typeof opts !== "object") opts = {};
      if (opts.windowsHide === undefined) opts.windowsHide = true;
      return _spawn.call(this, cmd, args, opts);
    };

    const _execFile = cp.execFile;
    cp.execFile = function patchedExecFile(file, args, opts, cb) {
      if (typeof args === "function") return _execFile.call(this, file, args);
      if (typeof opts === "function") {
        if (Array.isArray(args)) return _execFile.call(this, file, args, opts);
        if (args && typeof args === "object") {
          if (args.windowsHide === undefined) args.windowsHide = true;
        }
        return _execFile.call(this, file, args, opts);
      }
      if (opts && typeof opts === "object") {
        if (opts.windowsHide === undefined) opts.windowsHide = true;
      }
      return _execFile.call(this, file, args, opts, cb);
    };
  } catch {
    // Best-effort.
  }
}

patchWindowsHide();

const require = createRequire(import.meta.url);
const manifest = require("./openclaw.plugin.json");
const { BrowserAutomation } = require("../packages/client-sdk");
const { loadConfig, setConfigValue } = require("../packages/config");
const { createServer } = require("../packages/server-core");
const { SENSITIVE_TOOL_NAMES, SKILLS_REGISTRY_URL, isLoopbackHost, resolveSecurityConfig } = require("../packages/protocol");
const {
  applySkillInstall,
  discoverLocalSkills,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  isSkillEnabled,
  loadSkillContract,
  planSkillInstall,
  readSkillIntegrity,
  registerOpenClawTools,
  verifySkillIntegrity,
} = require("../packages/protocol/skills");
const { ensureRuntimePaths, getPaths, chmodBestEffort } = require("../packages/runtime-paths");
const { ensureToken, readToken } = require("../packages/runtime-paths/token.js");

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

const PLUGIN_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

function resolveSkillRoot() {
  const pluginDir = process.platform === "win32"
    ? PLUGIN_DIR.replace(/^\//, "")
    : PLUGIN_DIR;

  const candidates = [
    nodePath.resolve(pluginDir, ".."),
    nodePath.resolve(pluginDir, "..", ".."),
    pluginDir,
  ];

  const withSkillsDir = candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "skills")));
  if (withSkillsDir) {
    return withSkillsDir;
  }

  return candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "package.json"))) || pluginDir;
}

const SKILL_ROOT = resolveSkillRoot();
const DEFAULT_REGISTRY = SKILLS_REGISTRY_URL;
const BUILTIN_TOOL_NAMES = [
  "js_eyes_get_tabs",
  "js_eyes_list_clients",
  "js_eyes_open_url",
  "js_eyes_close_tab",
  "js_eyes_get_html",
  "js_eyes_execute_script",
  "js_eyes_get_cookies",
  "js_eyes_inject_css",
  "js_eyes_get_cookies_by_domain",
  "js_eyes_get_page_info",
  "js_eyes_upload_file",
  "js_eyes_discover_skills",
  "js_eyes_install_skill",
];

function resolvePluginEntry(definition) {
  try {
    const sdk = require("openclaw/plugin-sdk/plugin-entry");
    if (typeof sdk.definePluginEntry === "function") {
      return sdk.definePluginEntry(definition);
    }
  } catch {
    // Fallback for local development without the OpenClaw SDK package installed.
  }
  return definition.register;
}

function registerLocalSkills(api, skillsDir, pluginConfig, helpers = {}) {
  const localSkills = discoverLocalSkills(skillsDir);
  if (localSkills.length === 0) {
    api.logger.info(`[js-eyes] No local skills found in ${skillsDir}`);
    return;
  }

  const hostConfig = loadConfig();
  const legacyState = getLegacyOpenClawSkillState({
    skillIds: localSkills.map((skill) => skill.id),
  });
  let firstRunMigrations = 0;
  for (const skill of localSkills) {
    if (!Object.prototype.hasOwnProperty.call(hostConfig.skillsEnabled || {}, skill.id)) {
      const legacyValue = Object.prototype.hasOwnProperty.call(legacyState, skill.id)
        ? legacyState[skill.id]
        : false;
      setConfigValue(`skillsEnabled.${skill.id}`, legacyValue === true);
      firstRunMigrations++;
      if (legacyValue !== true) {
        api.logger.warn(
          `[js-eyes] Skill "${skill.id}" left disabled by default; run \`js-eyes skills enable ${skill.id}\` to opt-in`,
        );
      }
    }
  }
  let effectiveConfig = hostConfig;
  if (firstRunMigrations > 0) {
    effectiveConfig = loadConfig();
  }

  const registeredNames = new Set(BUILTIN_TOOL_NAMES);
  for (const skill of localSkills) {
    if (!isSkillEnabled(effectiveConfig, skill.id, legacyState)) {
      api.logger.info(`[js-eyes] Skipping disabled local skill "${skill.id}"`);
      continue;
    }

    const integrity = verifySkillIntegrity(skill.skillDir);
    if (integrity.hasIntegrity && !integrity.ok) {
      api.logger.warn(
        `[js-eyes] Refusing to load tampered skill "${skill.id}": ${integrity.mismatches.length} mismatched, ${integrity.missing.length} missing`,
      );
      continue;
    }
    if (!integrity.hasIntegrity) {
      api.logger.warn(
        `[js-eyes] Skill "${skill.id}" has no .integrity.json (legacy install); load allowed but consider reinstalling`,
      );
    }

    try {
      const contract = skill.contract || loadSkillContract(skill.skillDir);
      if (!contract || typeof contract.createOpenClawAdapter !== "function") {
        api.logger.warn(`[js-eyes] Skipping local skill "${skill.id}" because createOpenClawAdapter() is missing`);
        continue;
      }

      const adapter = contract.createOpenClawAdapter(pluginConfig, api.logger);
      const installManifest = readSkillIntegrity(skill.skillDir);
      const declaredTools = installManifest?.declaredTools || skill.tools || [];

      const summary = registerOpenClawTools(api, adapter, {
        logger: api.logger,
        registeredNames,
        sourceName: skill.id,
        declaredTools,
        wrapTool: helpers.wrapSensitiveTool || null,
      });

      if (summary.registered.length > 0) {
        api.logger.info(`[js-eyes] Loaded local skill "${skill.id}" with ${summary.registered.length} tool(s)`);
      }
      if (summary.skipped.length > 0 || summary.failed.length > 0) {
        api.logger.warn(`[js-eyes] Local skill "${skill.id}" completed with ${summary.skipped.length} skipped and ${summary.failed.length} failed tool registration(s)`);
      }
    } catch (error) {
      api.logger.warn(`[js-eyes] Failed to load local skill "${skill.id}": ${error.message}`);
    }
  }
}

function register(api) {
  const pluginCfg = api.pluginConfig ?? {};

  const serverHost = pluginCfg.serverHost || "localhost";
  const serverPort = pluginCfg.serverPort || 18080;
  const autoStart = pluginCfg.autoStartServer ?? true;
  const requestTimeout = pluginCfg.requestTimeout || 60;
  const skillsRegistryUrl = pluginCfg.skillsRegistryUrl || DEFAULT_REGISTRY;
  const skillsDir = pluginCfg.skillsDir
    ? nodePath.resolve(pluginCfg.skillsDir)
    : nodePath.join(SKILL_ROOT, "skills");

  const runtimePaths = ensureRuntimePaths();
  const hostConfig = loadConfig();
  const security = resolveSecurityConfig(hostConfig);

  let bot = null;
  let server = null;

  function getServerToken() {
    if (process.env.JS_EYES_SERVER_TOKEN) return process.env.JS_EYES_SERVER_TOKEN;
    return readToken();
  }

  function getLocalRequestHeaders() {
    const headers = {};
    const token = getServerToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (isLoopbackHost(serverHost)) {
      headers.Origin = serverHost === "::1" || serverHost === "[::1]"
        ? "http://[::1]"
        : `http://${serverHost}`;
    }
    return headers;
  }

  function ensureBot() {
    if (!bot) {
      bot = new BrowserAutomation(`ws://${serverHost}:${serverPort}`, {
        defaultTimeout: requestTimeout,
        token: getServerToken(),
        logger: {
          info: (msg) => api.logger.info(msg),
          warn: (msg) => api.logger.warn(msg),
          error: (msg) => api.logger.error(msg),
        },
      });
    }
    return bot;
  }

  const sensitiveToolNames = new Set([
    ...SENSITIVE_TOOL_NAMES,
    ...(Object.keys(security.toolPolicies || {}).filter((name) => security.toolPolicies[name] === 'confirm' || security.toolPolicies[name] === 'deny')),
  ]);

  function summarizeParams(params = {}) {
    try {
      const json = JSON.stringify(params);
      return json.length > 200 ? json.slice(0, 200) + `…(+${json.length - 200})` : json;
    } catch {
      return '[unserializable]';
    }
  }

  function recordConsentDecision(toolName, params, decision) {
    try {
      const id = nodeCrypto.randomBytes(8).toString('hex');
      const filePath = nodePath.join(runtimePaths.consentsDir, `${id}.json`);
      const record = {
        id,
        toolName,
        decision,
        requestedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
        summary: summarizeParams(params),
        status: decision,
      };
      nodeFs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
      chmodBestEffort(filePath, 0o600);
    } catch (error) {
      api.logger.warn(`[js-eyes] Failed to record consent log: ${error.message}`);
    }
  }

  function wrapSensitiveTool(definition, ctx = {}) {
    if (!definition || !definition.name) return definition;
    const policyMap = security.toolPolicies || {};
    const policy = policyMap[definition.name]
      || (sensitiveToolNames.has(definition.name) ? 'confirm' : 'allow');
    if (policy === 'allow') return definition;

    const originalExecute = definition.execute;
    return {
      ...definition,
      async execute(toolCallId, params) {
        if (policy === 'deny') {
          recordConsentDecision(definition.name, params, 'deny');
          api.logger.warn(`[js-eyes] Tool "${definition.name}" denied by policy`);
          return { content: [{ type: 'text', text: `Tool "${definition.name}" denied by JS Eyes policy (security.toolPolicies).` }] };
        }
        // policy === 'confirm'
        recordConsentDecision(definition.name, params, 'auto-confirm');
        api.logger.warn(
          `[js-eyes] Tool "${definition.name}" requires confirmation (policy=confirm). source=${ctx.source || 'core'} params=${summarizeParams(params)}`,
        );
        return originalExecute(toolCallId, params);
      },
    };
  }

  function textResult(text) {
    return { content: [{ type: "text", text }] };
  }

  function registerBuiltin(definition, options) {
    api.registerTool(wrapSensitiveTool(definition, { source: 'builtin' }), options);
  }

  api.registerService({
    id: "js-eyes-server",
    async start(ctx) {
      if (!autoStart) {
        ctx.logger.info("[js-eyes] autoStartServer=false, skipping server start");
        return;
      }
      try {
        const tokenInfo = security.allowAnonymous ? null : ensureToken();
        server = createServer({
          port: serverPort,
          host: serverHost,
          token: tokenInfo?.token || undefined,
          security,
          config: hostConfig,
          auditLogFile: runtimePaths.auditLogFile,
          logger: {
            info: (msg) => ctx.logger.info(msg),
            warn: (msg) => ctx.logger.warn(msg),
            error: (msg) => ctx.logger.error(msg),
          },
        });
        await server.start();
        if (tokenInfo?.path) {
          ctx.logger.info(`[js-eyes] Server token file: ${tokenInfo.path}`);
        }
        ctx.logger.info(`[js-eyes] Server started on ws://${serverHost}:${serverPort}`);
      } catch (err) {
        ctx.logger.error(`[js-eyes] Failed to start server: ${err.message}`);
        server = null;
      }
    },
    async stop(ctx) {
      if (bot) {
        try { bot.disconnect(); } catch {}
        bot = null;
      }
      if (server) {
        try { await server.stop(); } catch {}
        server = null;
      }
      ctx.logger.info("[js-eyes] Service stopped");
    },
  });

  api.registerTool(
    {
      name: "js_eyes_get_tabs",
      label: "JS Eyes: Get Tabs",
      description: "获取浏览器中所有已打开的标签页列表，包含每个标签页的 ID、URL、标题等信息。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "目标浏览器的 clientId 或名称（如 'firefox'、'chrome'）。省略则返回所有浏览器的标签页。",
          },
        },
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const result = await b.getTabs({ target: params.target });
        const lines = [];
        if (result.browsers && result.browsers.length > 0) {
          for (const browser of result.browsers) {
            lines.push(`## ${browser.browserName} (${browser.clientId})`);
            for (const tab of browser.tabs) {
              const active = tab.id === result.activeTabId ? " [ACTIVE]" : "";
              lines.push(`  - [${tab.id}] ${tab.title || "(untitled)"}${active}`);
              lines.push(`    ${tab.url}`);
            }
          }
        } else {
          lines.push("当前没有浏览器扩展连接。");
        }
        return textResult(lines.join("\n"));
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_list_clients",
      label: "JS Eyes: List Clients",
      description: "获取当前已连接到 JS-Eyes 服务器的浏览器扩展客户端列表。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const b = ensureBot();
        const clients = await b.listClients();
        if (clients.length === 0) {
          return textResult("当前没有浏览器扩展连接到服务器。");
        }
        const lines = clients.map(
          (c) => `- ${c.browserName} (clientId: ${c.clientId}, tabs: ${c.tabCount})`,
        );
        return textResult(lines.join("\n"));
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_open_url",
      label: "JS Eyes: Open URL",
      description: "在浏览器中打开指定 URL。可以打开新标签页，也可以在已有标签页中导航。返回标签页 ID。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的 URL" },
          tabId: {
            type: "number",
            description: "已有标签页 ID（传入则在该标签页导航，省略则新开标签页）",
          },
          windowId: {
            type: "number",
            description: "窗口 ID（新开标签页时可指定窗口）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["url"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const tabId = await b.openUrl(
          params.url,
          params.tabId ?? null,
          params.windowId ?? null,
          { target: params.target },
        );
        return textResult(`已打开 ${params.url}，标签页 ID: ${tabId}`);
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_close_tab",
      label: "JS Eyes: Close Tab",
      description: "关闭浏览器中指定 ID 的标签页。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "要关闭的标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        await b.closeTab(params.tabId, { target: params.target });
        return textResult(`已关闭标签页 ${params.tabId}`);
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_get_html",
      label: "JS Eyes: Get HTML",
      description: "获取指定标签页的完整 HTML 内容。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const html = await b.getTabHtml(params.tabId, { target: params.target });
        return textResult(html);
      },
    },
    { optional: true },
  );

  registerBuiltin(
    {
      name: "js_eyes_execute_script",
      label: "JS Eyes: Execute Script",
      description: "在指定标签页中执行 JavaScript 代码并返回执行结果。可用于提取页面数据、操作 DOM 等。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          code: { type: "string", description: "要执行的 JavaScript 代码" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "code"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const result = await b.executeScript(params.tabId, params.code, {
          target: params.target,
        });
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return textResult(text);
      },
    },
    { optional: true },
  );

  registerBuiltin(
    {
      name: "js_eyes_get_cookies",
      label: "JS Eyes: Get Cookies",
      description: "获取指定标签页对应域名的所有 Cookie。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const cookies = await b.getCookies(params.tabId, { target: params.target });
        if (cookies.length === 0) {
          return textResult("该标签页没有 Cookie。");
        }
        return textResult(JSON.stringify(cookies, null, 2));
      },
    },
    { optional: true },
  );

  registerBuiltin(
    {
      name: "js_eyes_inject_css",
      label: "JS Eyes: Inject CSS",
      description: "向指定标签页注入自定义 CSS 样式。可用于隐藏页面元素、调整布局等。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          css: { type: "string", description: "要注入的 CSS 代码" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "css"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        await b.injectCss(params.tabId, params.css, { target: params.target });
        return textResult(`已向标签页 ${params.tabId} 注入 CSS 样式`);
      },
    },
    { optional: true },
  );

  registerBuiltin(
    {
      name: "js_eyes_get_cookies_by_domain",
      label: "JS Eyes: Get Cookies By Domain",
      description: "按域名获取浏览器中的所有 Cookie，无需指定标签页。支持包含子域名。",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "目标域名（如 'example.com'）" },
          includeSubdomains: {
            type: "boolean",
            description: "是否包含子域名的 Cookie（默认 true）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["domain"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const cookies = await b.getCookiesByDomain(params.domain, {
          includeSubdomains: params.includeSubdomains,
          target: params.target,
        });
        if (cookies.length === 0) {
          return textResult(`域名 ${params.domain} 没有 Cookie。`);
        }
        return textResult(JSON.stringify(cookies, null, 2));
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_get_page_info",
      label: "JS Eyes: Get Page Info",
      description: "获取指定标签页的页面信息，包括 URL、标题、状态和图标。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const info = await b.getPageInfo(params.tabId, { target: params.target });
        return textResult(JSON.stringify(info, null, 2));
      },
    },
    { optional: true },
  );

  registerBuiltin(
    {
      name: "js_eyes_upload_file",
      label: "JS Eyes: Upload File",
      description: "向指定标签页的文件上传控件上传文件。文件以 Base64 编码传入，自动设置到页面的 file input 元素。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          files: {
            type: "array",
            description: "要上传的文件列表",
            items: {
              type: "object",
              properties: {
                base64: { type: "string", description: "文件内容的 Base64 编码" },
                name: { type: "string", description: "文件名" },
                type: { type: "string", description: "MIME 类型（如 'image/png'）" },
              },
              required: ["base64", "name", "type"],
            },
          },
          targetSelector: {
            type: "string",
            description: "目标 file input 的 CSS 选择器（默认 'input[type=\"file\"]'）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "files"],
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const result = await b.uploadFileToTab(params.tabId, params.files, {
          targetSelector: params.targetSelector,
          target: params.target,
        });
        return textResult(JSON.stringify({ success: true, uploadedFiles: result }, null, 2));
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "js_eyes_discover_skills",
      label: "JS Eyes: Discover Skills",
      description: "查询 JS Eyes 扩展技能注册表，列出可安装的扩展技能（如 X.com 搜索等）。返回每个技能的 ID、名称、描述、版本、提供的 AI 工具列表和安装命令。",
      parameters: {
        type: "object",
        properties: {
          registryUrl: {
            type: "string",
            description: "自定义注册表 URL（默认使用 js-eyes.com/skills.json）",
          },
        },
      },
      async execute(_toolCallId, params) {
        const url = params.registryUrl || skillsRegistryUrl;
        try {
          const registry = await fetchSkillsRegistry(url);
          const installedSkills = new Set(discoverLocalSkills(skillsDir).map((skill) => skill.id));

          if (!registry.skills || registry.skills.length === 0) {
            return textResult("当前没有可用的扩展技能。");
          }

          const lines = [
            `## JS Eyes 扩展技能 (${registry.skills.length} 个)`,
            `Parent: js-eyes v${registry.parentSkill?.version || "?"}`,
            "",
          ];

          for (const s of registry.skills) {
            const installed = installedSkills.has(s.id);
            const status = installed ? "✓ 已安装" : "○ 未安装";
            lines.push(`### ${s.emoji || ""} ${s.name} (${s.id}) — ${status}`);
            lines.push(`  ${s.description}`);
            lines.push(`  版本: ${s.version}`);
            if (s.tools && s.tools.length > 0) {
              lines.push(`  AI 工具: ${s.tools.join(", ")}`);
            }
            if (s.commands && s.commands.length > 0) {
              lines.push(`  CLI 命令: ${s.commands.join(", ")}`);
            }
            if (s.requires?.skills?.length > 0) {
              lines.push(`  依赖: ${s.requires.skills.join(", ")}`);
            }
            if (!installed) {
              lines.push(`  安装: 调用 js_eyes_install_skill 工具，参数 skillId="${s.id}"`);
              lines.push(`  或命令行: curl -fsSL https://js-eyes.com/install.sh | bash -s -- ${s.id}`);
            }
            lines.push("");
          }

          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`获取技能注册表失败 (${url}): ${err.message}`);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
    wrapSensitiveTool({
      name: "js_eyes_install_skill",
      label: "JS Eyes: Plan Skill Install",
      description: "下载并校验一个 JS Eyes 扩展技能的安装计划：核对 SHA-256、解到 staging 目录、列出工具/依赖。出于安全考虑，不会自动启用或写入到 skills 目录；需要用户在终端执行 `js-eyes skills approve <skillId>` 才会真正落地。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要安装的技能 ID（如 'js-x-ops-skill'）",
          },
          force: {
            type: "boolean",
            description: "如果该技能已经安装，是否允许覆盖（仍然只生成计划）",
          },
        },
        required: ["skillId"],
      },
      async execute(_toolCallId, params) {
        const { skillId, force } = params;
        try {
          const planResult = await planSkillInstall({
            skillId,
            registryUrl: skillsRegistryUrl,
            skillsDir,
            force,
            logger: api.logger,
          });
          const plan = planResult.plan;
          const planFile = nodePath.join(runtimePaths.runtimeDir, 'pending-skills', `${skillId}.json`);
          nodeFs.mkdirSync(nodePath.dirname(planFile), { recursive: true });
          nodeFs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
          chmodBestEffort(planFile, 0o600);

          const lines = [
            `已生成安装计划，但未执行。请人工 review 后批准。`,
            `  技能: ${planResult.skill.name} (${skillId})`,
            `  来源: ${plan.sourceUrl}`,
            `  SHA-256: ${plan.bundleSha256}`,
            `  Bundle 大小: ${plan.bundleSize} bytes`,
            `  声明工具: ${(plan.declaredTools || []).join(', ') || '(none)'}`,
            `  依赖锁文件: ${plan.hasLockfile ? '存在' : '缺失'}`,
            `  Staging: ${plan.stagingDir}`,
            `  目标: ${plan.targetDir}`,
            ``,
            `请在主机终端执行: js-eyes skills approve ${skillId}`,
            `（也可以直接执行 \`js-eyes skills install ${skillId}\` 来在终端审阅+安装）`,
          ];
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`生成安装计划失败 (${skillId}): ${err.message}`);
        }
      },
    }),
    { optional: true },
  );

  registerLocalSkills(api, skillsDir, pluginCfg, { wrapSensitiveTool });

  api.registerCli(
    ({ program }) => {
      const jsEyes = program
        .command("js-eyes")
        .description("JS Eyes — 浏览器自动化工具");

      jsEyes
        .command("status")
        .description("查看 JS-Eyes 服务器连接状态")
        .action(async () => {
          try {
            const url = `http://${serverHost}:${serverPort}/api/browser/status`;
            const resp = await fetch(url, { headers: getLocalRequestHeaders() });
            const data = await resp.json();
            const d = data.data;
            console.log("\n=== JS-Eyes Server Status ===");
            console.log(`  运行时间: ${d.uptime}s`);
            console.log(`  浏览器扩展: ${d.connections.extensions.length} 个`);
            for (const ext of d.connections.extensions) {
              console.log(`    - ${ext.browserName} (${ext.clientId}), ${ext.tabCount} 个标签页`);
            }
            console.log(`  自动化客户端: ${d.connections.automationClients} 个`);
            console.log(`  标签页总数: ${d.tabs}`);
            console.log(`  待处理请求: ${d.pendingRequests}\n`);
          } catch (err) {
            console.error(`无法连接到服务器 (${serverHost}:${serverPort}): ${err.message}`);
          }
        });

      jsEyes
        .command("tabs")
        .description("列出所有浏览器标签页")
        .action(async () => {
          try {
            const url = `http://${serverHost}:${serverPort}/api/browser/tabs`;
            const resp = await fetch(url, { headers: getLocalRequestHeaders() });
            const data = await resp.json();
            if (!data.browsers || data.browsers.length === 0) {
              console.log("\n当前没有浏览器扩展连接。\n");
              return;
            }
            console.log("");
            for (const browser of data.browsers) {
              console.log(`=== ${browser.browserName} (${browser.clientId}) ===`);
              for (const tab of browser.tabs) {
                const active = tab.id === data.activeTabId ? " [ACTIVE]" : "";
                console.log(`  [${tab.id}] ${tab.title || "(untitled)"}${active}`);
                console.log(`       ${tab.url}`);
              }
            }
            console.log("");
          } catch (err) {
            console.error(`无法连接到服务器 (${serverHost}:${serverPort}): ${err.message}`);
          }
        });

      const serverCmd = jsEyes.command("server").description("管理 JS-Eyes 内置服务器");

      serverCmd
        .command("start")
        .description("启动内置服务器")
        .action(async () => {
          if (server) {
            console.log("服务器已在运行中。");
            return;
          }
          try {
            server = createServer({
              port: serverPort,
              host: serverHost,
              logger: console,
            });
            await server.start();
            console.log(`服务器已启动: ws://${serverHost}:${serverPort}`);
          } catch (err) {
            console.error(`启动失败: ${err.message}`);
            server = null;
          }
        });

      serverCmd
        .command("stop")
        .description("停止内置服务器")
        .action(async () => {
          if (!server) {
            console.log("服务器未在运行。");
            return;
          }
          await server.stop();
          server = null;
          if (bot) {
            try { bot.disconnect(); } catch {}
            bot = null;
          }
          console.log("服务器已停止。");
        });
    },
    { commands: ["js-eyes"] },
  );
}

const definition = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  register,
};

export default resolvePluginEntry(definition);
