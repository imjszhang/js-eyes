export function registerManagementActions({
  getActiveServer,
  registerCoreAction,
  skillRegistry,
}) {
registerCoreAction(
    "skills/reload",
    {
      name: "skills/reload",
      label: "JS Eyes: Reload Skills",
      description: "重新扫描 primary + extraSkillDirs，应用 skillsEnabled 与配置变更（热加载/卸载技能），无需重启 OpenClaw。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "触发原因，仅用于日志（如 'agent-call', 'user-link'）",
          },
        },
      },
      async execute(_toolCallId, params) {
        const reason = (params && typeof params.reason === 'string') ? params.reason : 'tool';
        try {
          const summary = await skillRegistry.reload(reason);
          const lines = [
            `[js-eyes] reload 完成 (reason=${summary.reason || reason})`,
            `  added:    ${summary.added.join(', ') || '(none)'}`,
            `  removed:  ${summary.removed.join(', ') || '(none)'}`,
            `  reloaded: ${summary.reloaded.join(', ') || '(none)'}`,
            `  toggled-off: ${summary.toggledOff.join(', ') || '(none)'}`,
          ];
          if (Array.isArray(summary.conflicts) && summary.conflicts.length > 0) {
            lines.push(`  conflicts:`);
            for (const c of summary.conflicts) {
              lines.push(`    - ${c.id}: kept ${c.winner.source} ${c.winner.path}, skipped ${c.loser.source} ${c.loser.path}`);
            }
          }
          if (Array.isArray(summary.failedDispatchers) && summary.failedDispatchers.length > 0) {
            lines.push(`  binding-failures:`);
            for (const f of summary.failedDispatchers) {
              lines.push(`    - ${f.skillId}: ${f.toolNames.join(', ')}`);
            }
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `reload 失败: ${error.message}` }] };
        }
      },
    },
  );

registerCoreAction(
    "security/reload",
    {
      name: "security/reload",
      label: "JS Eyes: Reload Security",
      description: "热加载 ~/.js-eyes/config/config.json 中的安全配置（egressAllowlist / toolPolicies / enforcement 等），无需重启 OpenClaw 或 JS Eyes 服务器。下一次 open_url 会立即生效。非热加载字段（serverHost/serverPort/allowAnonymous/token 等）会出现在 ignored 字段中，仍需重启。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "触发原因，仅用于日志（如 'agent-call', 'user-link'）",
          },
        },
      },
      async execute(_toolCallId, params) {
        const reason = (params && typeof params.reason === 'string') ? params.reason : 'tool';
        const activeServer = getActiveServer();
        if (!activeServer || typeof activeServer.reloadSecurity !== 'function') {
          return { content: [{ type: 'text', text: '[js-eyes] 服务器未启动或未暴露 reloadSecurity（可能 autoStartServer=false 或版本过旧）。' }] };
        }
        try {
          const summary = activeServer.reloadSecurity({ source: `tool:${reason}` });
          const lines = [
            `[js-eyes] security reload (source=tool:${reason})`,
            `  changed:    ${summary.changed}`,
            `  generation: ${summary.generation}`,
            `  applied:    ${Object.keys(summary.applied || {}).join(', ') || '(none)'}`,
            `  ignored:    ${Object.keys(summary.ignored || {}).join(', ') || '(none)'}`,
            `  egressAllowlist: ${JSON.stringify(summary.egressAllowlist || [])}`,
          ];
          if (summary.error) {
            lines.push(`  error: ${summary.error}`);
          }
          if (Object.keys(summary.ignored || {}).length > 0) {
            lines.push('  (ignored fields require a server restart to take effect.)');
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `security reload 失败: ${error.message}` }] };
        }
      },
    },
  );
}
