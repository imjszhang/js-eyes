'use strict';

const {
  POLICY_ENFORCEMENT_LEVELS,
  loadConfig,
  print,
  resolveSecurityConfig,
  setConfigValue,
} = require('../command-context');

async function commandSecurity(positionals, _flags) {
  const action = positionals[1];

  switch (action) {
    case 'show': {
      const config = loadConfig();
      const security = resolveSecurityConfig(config);
      print(JSON.stringify({
        enforcement: security.enforcement,
        taskOrigin: security.taskOrigin,
        egressAllowlist: security.egressAllowlist,
        taint: security.taint,
        profile: security.profile,
        allowAnonymous: security.allowAnonymous,
        allowRawEval: security.allowRawEval,
        requireLockfile: security.requireLockfile,
      }, null, 2));
      return;
    }
    case 'enforce': {
      const level = positionals[2];
      if (!level || !POLICY_ENFORCEMENT_LEVELS.includes(level)) {
        throw new Error(`用法: \`js-eyes security enforce <${POLICY_ENFORCEMENT_LEVELS.join('|')}>\``);
      }
      const nextConfig = setConfigValue('security.enforcement', level);
      print(`security.enforcement = ${nextConfig.security?.enforcement}`);
      if (level === 'off') print('!! Policy rules will only audit, not block.');
      if (level === 'strict') print('!! Policy rules will reject violating calls (breaks existing workflows if task origin is not declared).');
      return;
    }
    case 'reload': {
      // The CLI does not own the running server's event loop (servers started
      // by OpenClaw or `js-eyes server start` run in separate processes), so
      // this command is intentionally read-only: it re-resolves the on-disk
      // security config and prints what a live reload WOULD apply. The actual
      // reload path is one of:
      //   1. The running server's chokidar watcher on ~/.js-eyes/config/config.json
      //      (auto-fires within ~500ms of a write when chokidar is available).
      //   2. The built-in tool `js_eyes_reload_security` (agent-driven).
      const config = loadConfig();
      const security = resolveSecurityConfig(config);
      print('security.reload (read-only preview)');
      print(`  enforcement:     ${security.enforcement}`);
      print(`  egressAllowlist: ${JSON.stringify(security.egressAllowlist)}`);
      print('');
      print('如要通知正在运行的服务器热加载新配置，选择一条:');
      print('  1) 等待 ~0.5s：server-core 的 chokidar watcher 监听 ~/.js-eyes/config/config.json，写入后自动热加载（需安装 chokidar）。');
      print('  2) 在 Agent 中调用内置工具 `js_eyes_reload_security`（OpenClaw 插件装载时可用）。');
      print('注: 仅 egressAllowlist / toolPolicies / sensitiveCookieDomains / allowedOrigins / enforcement 支持热加载；其余字段需要重启服务器。');
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes security show` / `enforce <off|soft|strict>` / `reload`');
  }
}

module.exports = { commandSecurity };
