export function createToolPolicy({
  api,
  chmodBestEffort,
  nodeCrypto,
  nodeFs,
  nodePath,
  PolicyBlockError,
  runtimePaths,
  security,
  ServerPolicyError,
  sensitiveToolDefaults,
}) {
  const sensitiveToolNames = new Set([
    ...sensitiveToolDefaults,
    ...Object.keys(security.toolPolicies || {}).filter((name) =>
      security.toolPolicies[name] === 'confirm' || security.toolPolicies[name] === 'deny'),
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

  function wrapSensitiveTool(definition, context = {}) {
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
          return {
            content: [{
              type: 'text',
              text: `Tool "${definition.name}" denied by JS Eyes policy (security.toolPolicies).`,
            }],
          };
        }
        recordConsentDecision(definition.name, params, 'auto-confirm');
        api.logger.warn(
          `[js-eyes] Tool "${definition.name}" requires confirmation (policy=confirm). source=${context.source || 'core'} params=${summarizeParams(params)}`,
        );
        return originalExecute(toolCallId, params);
      },
    };
  }

  function textResult(text) {
    return { content: [{ type: "text", text }] };
  }

  function normalizeSkillAction(action) {
    if (action === "skill/js-browser-ops-skill/browser_screenshot") {
      return "skill/js-browser-ops-skill/browser-screenshot";
    }
    return action;
  }

  function formatPolicyError(error) {
    if (error instanceof ServerPolicyError) {
      if (error.code === "POLICY_PENDING_EGRESS") {
        const hostLine = error.host ? `目标主机: ${error.host}\n` : "";
        const pendingLine = error.pendingId ? `pendingId: ${error.pendingId}\n` : "";
        return (
          `JS Eyes 出站策略未允许打开该 URL（pending-egress），浏览器未执行导航。\n` +
          `${hostLine}${pendingLine}` +
          `可执行: js-eyes egress list 查看待审批；js-eyes egress approve <id> 批准该条；` +
          `js-eyes egress allow <域名> 写入 security.egressAllowlist；` +
          `js-eyes security show 查看 egressAllowlist 与 taskOrigin。\n` +
          `服务端说明: ${error.message}`
        );
      }
      if (error.code === "POLICY_SOFT_BLOCK") {
        return (
          `JS Eyes 服务端策略拦截了该操作（多为任务范围 L4a、污点 L4b 等，与出站 egress 不同）。\n` +
          `规则: ${error.rule || "unknown"}\n` +
          `详情: ${error.message}`
        );
      }
      return `JS Eyes 服务端策略拒绝: ${error.message} (code=${error.code})`;
    }
    if (error instanceof PolicyBlockError) {
      return error.message;
    }
    return null;
  }

  function policyTextResultOrThrow(error) {
    const text = formatPolicyError(error);
    if (text) return textResult(text);
    throw error;
  }

  return { normalizeSkillAction, policyTextResultOrThrow, textResult, wrapSensitiveTool };
}
