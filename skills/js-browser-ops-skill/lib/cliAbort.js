'use strict';

function installCliAbort(options = {}) {
  const controller = options.controller || new AbortController();
  let count = 0;
  const onSignal = () => {
    count += 1;
    if (count === 1) {
      controller.abort();
      return;
    }
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return {
    signal: controller.signal,
    dispose() {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

module.exports = { installCliAbort };
