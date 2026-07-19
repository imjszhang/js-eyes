export function registerServerService({
  api,
  autoStart,
  clearCurrentRegistration,
  consumePreviousTeardown,
  ensureNativeHost,
  ensureToken,
  fullRuntime,
  hostConfig,
  logNativeHostResult,
  pluginConfig,
  requestTimeout,
  runtimePaths,
  security,
  serverHost,
  serverPort,
  sharedServer,
  state,
  teardownRegistration,
}) {
  if (!fullRuntime) return;

  api.registerService({
    id: "js-eyes-server",
    async start(context) {
      if (!autoStart) {
        context.logger.info("[js-eyes] autoStartServer=false, skipping server start");
        return;
      }
      try {
        await consumePreviousTeardown();
        const tokenInfo = security.allowAnonymous ? null : ensureToken();
        try {
          const nativeHostResult = ensureNativeHost(pluginConfig.nativeHost);
          logNativeHostResult(nativeHostResult, context.logger);
        } catch (error) {
          context.logger.warn(`[js-eyes] Native host check failed: ${error.message}`);
        }
        state.server = await sharedServer.acquire({
          port: serverPort,
          host: serverHost,
          token: tokenInfo?.token || undefined,
          security,
          config: hostConfig,
          requestTimeout,
          pendingEgressDir: runtimePaths.pendingEgressDir,
          auditLogFile: runtimePaths.auditLogFile,
          logger: {
            info: (message) => context.logger.info(message),
            warn: (message) => context.logger.warn(message),
            error: (message) => context.logger.error(message),
          },
        });
        state.serverUsesSharedRef = true;
        if (tokenInfo?.path) {
          context.logger.info(`[js-eyes] Server token file: ${tokenInfo.path}`);
        }
        if (sharedServer.refs === 1) {
          context.logger.info(`[js-eyes] Server started on ws://${serverHost}:${serverPort}`);
        } else {
          context.logger.info(
            `[js-eyes] Reusing server on ws://${serverHost}:${serverPort} (refs=${sharedServer.refs})`,
          );
        }
      } catch (error) {
        context.logger.error(`[js-eyes] Failed to start server: ${error.message}`);
        if (state.serverUsesSharedRef) {
          state.serverUsesSharedRef = false;
          await sharedServer.release();
        }
        state.server = null;
      }
    },
    async stop(context) {
      await teardownRegistration(context);
      clearCurrentRegistration(api);
    },
  });
}
