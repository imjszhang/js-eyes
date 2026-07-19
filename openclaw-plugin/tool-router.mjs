export function registerToolRouter({
  api,
  coreActions,
  getSkillRegistry,
  normalizeSkillAction,
  textResult,
}) {
  api.registerTool(
    {
      name: "js-eyes",
      label: "JS Eyes",
      description: "JS Eyes 单一入口。使用路径式 action 调用浏览器、技能与安全管理能力，例如 browser/open-url、skills/reload、skill/<skillId>/<action>。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "路径式动作名，例如 browser/get-tabs、browser/open-url、skills/reload、security/reload、skill/<skillId>/<action>。",
          },
          args: {
            type: "object",
            description: "传给 action 的参数对象。",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
      async execute(toolCallId, params = {}) {
        const action = typeof params.action === "string" ? params.action.trim() : "";
        const args = params.args && typeof params.args === "object" && !Array.isArray(params.args)
          ? params.args
          : {};
        if (!action) {
          return textResult("缺少 action。请使用路径式 action，例如 browser/get-tabs 或 browser/open-url。");
        }
        const core = coreActions.get(action);
        if (core) {
          return core.execute(toolCallId, args);
        }
        if (action.startsWith("skill/")) {
          const skillRegistry = getSkillRegistry();
          if (!skillRegistry || typeof skillRegistry.executeAction !== "function") {
            return textResult(
              `JS Eyes skill registry 当前不可用，可能正在重载或插件已进入关闭流程。\n` +
              `请稍后重试 action: ${action}`,
            );
          }
          return skillRegistry.executeAction(normalizeSkillAction(action), toolCallId, args);
        }
        return textResult(
          `不支持的 JS Eyes action: ${action}\n` +
          `请使用路径式 action，例如 browser/get-tabs、browser/open-url、skills/reload、security/reload 或 skill/<skillId>/<action>。`,
        );
      },
    },
    { optional: true },
  );
}
