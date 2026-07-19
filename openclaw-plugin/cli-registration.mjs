export function registerPluginCli({
  api,
  createServer,
  exitCli,
  getLocalRequestHeaders,
  installCliExitHandlers,
  serverHost,
  serverPort,
  sharedServer,
  state,
}) {
  api.registerCli(
    ({ program }) => {
      installCliExitHandlers();

      const jsEyes = program
        .command("js-eyes")
        .description("JS Eyes — 浏览器自动化工具");

      jsEyes
        .command("status")
        .description("查看 JS-Eyes 服务器连接状态")
        .action(async () => {
          try {
            const url = `http://${serverHost}:${serverPort}/api/browser/status`;
            const response = await fetch(url, { headers: getLocalRequestHeaders() });
            const data = await response.json();
            const details = data.data;
            console.log("\n=== JS-Eyes Server Status ===");
            console.log(`  运行时间: ${details.uptime}s`);
            console.log(`  浏览器扩展: ${details.connections.extensions.length} 个`);
            for (const extension of details.connections.extensions) {
              console.log(`    - ${extension.browserName} (${extension.clientId}), ${extension.tabCount} 个标签页`);
            }
            console.log(`  自动化客户端: ${details.connections.automationClients} 个`);
            console.log(`  标签页总数: ${details.tabs}`);
            console.log(`  待处理请求: ${details.pendingRequests}\n`);
            await exitCli(true);
          } catch (error) {
            console.error(`无法连接到服务器 (${serverHost}:${serverPort}): ${error.message}`);
            await exitCli(false);
          }
        });

      jsEyes
        .command("tabs")
        .description("列出所有浏览器标签页")
        .action(async () => {
          try {
            const url = `http://${serverHost}:${serverPort}/api/browser/tabs`;
            const response = await fetch(url, { headers: getLocalRequestHeaders() });
            const data = await response.json();
            if (!data.browsers || data.browsers.length === 0) {
              console.log("\n当前没有浏览器扩展连接。\n");
              await exitCli(true);
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
            await exitCli(true);
          } catch (error) {
            console.error(`无法连接到服务器 (${serverHost}:${serverPort}): ${error.message}`);
            await exitCli(false);
          }
        });

      const serverCommand = jsEyes.command("server").description("管理 JS-Eyes 内置服务器");

      serverCommand
        .command("start")
        .description("启动内置服务器")
        .action(async () => {
          if (state.server || sharedServer.instance) {
            console.log("服务器已在运行中。");
            return;
          }
          try {
            state.server = createServer({
              port: serverPort,
              host: serverHost,
              logger: console,
            });
            await state.server.start();
            console.log(`服务器已启动: ws://${serverHost}:${serverPort}`);
          } catch (error) {
            console.error(`启动失败: ${error.message}`);
            state.server = null;
          }
        });

      serverCommand
        .command("stop")
        .description("停止内置服务器")
        .action(async () => {
          try {
            if (!state.server) {
              console.log("服务器未在运行。");
              await exitCli(true);
              return;
            }
            await state.server.stop();
            state.server = null;
            if (state.bot) {
              try { state.bot.disconnect(); } catch {}
              state.bot = null;
            }
            console.log("服务器已停止。");
            await exitCli(true);
          } catch (error) {
            console.error(`停止失败: ${error.message}`);
            await exitCli(false);
          }
        });
    },
    { commands: ["js-eyes"] },
  );
}
