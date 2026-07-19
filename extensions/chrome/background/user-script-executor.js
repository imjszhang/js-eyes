'use strict';

const USER_SCRIPTS_UNAVAILABLE_MESSAGE =
  'Chrome raw script execution requires Chrome 135+ and the userScripts permission. ' +
  'Enable "Allow User Scripts" in the extension details (Chrome 138+) or Developer mode (Chrome 135-137), then reload the extension.';

async function executeUserScript(tabId, code, chromeApi = globalThis.chrome) {
  if (!chromeApi?.userScripts || typeof chromeApi.userScripts.execute !== 'function') {
    const error = new Error(USER_SCRIPTS_UNAVAILABLE_MESSAGE);
    error.code = 'USER_SCRIPTS_UNAVAILABLE';
    throw error;
  }

  const results = await chromeApi.userScripts.execute({
    target: { tabId: parseInt(tabId) },
    js: [{ code }],
  });
  const result = results?.[0];

  if (!result) {
    throw new Error('脚本执行未返回结果');
  }
  if (result.error) {
    throw new Error('脚本执行错误: ' + result.error);
  }
  return result.result;
}

const userScriptExecutor = {
  USER_SCRIPTS_UNAVAILABLE_MESSAGE,
  executeUserScript,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = userScriptExecutor;
}
globalThis.JSEyesChromeUserScriptExecutor = userScriptExecutor;
