export function createPluginLifecycle(sharedServer) {
  let currentRegistration = null;
  let cliExitHandlersInstalled = false;

  function beginRegistration(api) {
    if (!currentRegistration) return null;

    const previousRegistration = currentRegistration;
    currentRegistration = null;
    const previousHadSidecars = previousRegistration.hadSidecars === true;
    try {
      if (previousHadSidecars) {
        api.logger.warn(
          "[js-eyes] register() called while a previous registration is still active; tearing down sidecars (server kept if still referenced)",
        );
      }
      return Promise.resolve(
        previousRegistration.teardownSidecars({ logger: api.logger }),
      ).catch((error) => {
        api.logger.warn(`[js-eyes] previous teardown failed: ${error.message}`);
      });
    } catch (error) {
      api.logger.warn(`[js-eyes] previous teardown failed: ${error.message}`);
      return null;
    }
  }

  function clearCurrentRegistration(api) {
    if (currentRegistration && currentRegistration.api === api) {
      currentRegistration = null;
    }
  }

  function setCurrentRegistration(registration) {
    currentRegistration = registration;
  }

  async function exitCli(success) {
    process.exitCode = success ? 0 : 1;
    if (currentRegistration) {
      try {
        await currentRegistration.teardownSidecars({});
        await sharedServer.release();
      } catch {}
      currentRegistration = null;
    }
    setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
  }

  function installCliExitHandlers() {
    if (cliExitHandlersInstalled) return;
    cliExitHandlersInstalled = true;
    process.on("uncaughtException", (error) => {
      console.error("[js-eyes] uncaughtException:", error?.stack || error);
      exitCli(false);
    });
    process.on("unhandledRejection", (error) => {
      console.error("[js-eyes] unhandledRejection:", error instanceof Error ? error.stack : error);
      exitCli(false);
    });
  }

  return {
    beginRegistration,
    clearCurrentRegistration,
    exitCli,
    installCliExitHandlers,
    setCurrentRegistration,
  };
}
