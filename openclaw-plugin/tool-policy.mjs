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

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }

  function summarizeParams(params = {}) {
    try {
      const json = JSON.stringify(stableValue(params));
      return json.length > 200 ? json.slice(0, 200) + `…(+${json.length - 200})` : json;
    } catch {
      return '[unserializable]';
    }
  }

  function consentFile(toolName, params) {
    const canonical = JSON.stringify(stableValue(params || {}));
    const id = nodeCrypto.createHash('sha256').update(toolName).update('\0').update(canonical).digest('hex').slice(0, 24);
    return { id, canonical, filePath: nodePath.join(runtimePaths.consentsDir, `${id}.json`) };
  }

  function writeConsent(toolName, params, status) {
    try {
      const { id, canonical, filePath } = consentFile(toolName, params);
      let previous = null;
      try { previous = JSON.parse(nodeFs.readFileSync(filePath, 'utf8')); } catch {}
      const record = {
        id,
        toolName,
        requestedAt: previous?.requestedAt || new Date().toISOString(),
        decidedAt: status === 'pending' ? null : new Date().toISOString(),
        summary: summarizeParams(params),
        paramsDigest: nodeCrypto.createHash('sha256').update(canonical).digest('hex'),
        status,
      };
      nodeFs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
      chmodBestEffort(filePath, 0o600);
      return record;
    } catch (error) {
      api.logger.warn(`[js-eyes] Failed to record consent log: ${error.message}`);
      return null;
    }
  }

  function wrapSensitiveTool(definition, context = {}) {
    if (!definition || !definition.name) return definition;
    const policyMap = security.toolPolicies || {};
    const policy = policyMap[definition.name]
      || (sensitiveToolNames.has(definition.name)
        || definition.risk === 'destructive'
        || definition.risk === 'administrative' ? 'confirm' : 'allow');
    if (policy === 'allow') return definition;

    const originalExecute = definition.execute;
    return {
      ...definition,
      async execute(toolCallId, params) {
        if (policy === 'deny') {
          writeConsent(definition.name, params, 'denied');
          api.logger.warn(`[js-eyes] Tool "${definition.name}" denied by policy`);
          return {
            content: [{
              type: 'text',
              text: `Tool "${definition.name}" denied by JS Eyes policy (security.toolPolicies).`,
            }],
          };
        }
        const consent = consentFile(definition.name, params);
        const paramsDigest = nodeCrypto.createHash('sha256').update(consent.canonical).digest('hex');
        let current = null;
        try { current = JSON.parse(nodeFs.readFileSync(consent.filePath, 'utf8')); } catch {}
        if (current?.status === 'denied'
          && current.toolName === definition.name
          && current.paramsDigest === paramsDigest) {
          return {
            content: [{
              type: 'text',
              text: `Tool "${definition.name}" was denied for these parameters.`,
            }],
            structuredContent: {
              code: 'JS_EYES_CONSENT_DENIED', consentId: consent.id, toolName: definition.name,
            },
          };
        }
        if (current?.status !== 'approved'
          || current.toolName !== definition.name
          || current.paramsDigest !== paramsDigest) {
          const pending = writeConsent(definition.name, params, 'pending');
          const consentId = pending?.id || consent.id;
          api.logger.warn(
            `[js-eyes] Tool "${definition.name}" is pending confirmation. source=${context.source || 'core'} consentId=${consentId}`,
          );
          return {
            content: [{
              type: 'text',
              text: `Tool "${definition.name}" requires approval. Run \`js-eyes consent approve ${consentId}\`, then retry the same call.`,
            }],
            structuredContent: { code: 'JS_EYES_CONSENT_REQUIRED', consentId, toolName: definition.name },
          };
        }
        writeConsent(definition.name, params, 'consumed');
        api.logger.warn(
          `[js-eyes] Consumed approval for tool "${definition.name}". source=${context.source || 'core'}`,
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
