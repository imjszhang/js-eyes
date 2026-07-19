export function createSharedServerManager(createServer) {
  const state = {
    instance: null,
    configKey: null,
    startPromise: null,
    refs: 0,
  };

  function configKey(host, port) {
    return `${host}:${port}`;
  }

  async function stopInstance() {
    const instance = state.instance;
    state.instance = null;
    state.configKey = null;
    state.startPromise = null;
    state.refs = 0;
    if (instance) {
      try {
        await instance.stop();
      } catch {}
    }
  }

  async function acquire(createOptions) {
    const key = configKey(createOptions.host, createOptions.port);
    if (state.instance && state.configKey !== key) {
      await stopInstance();
    }
    if (!state.instance) {
      if (!state.startPromise) {
        state.startPromise = (async () => {
          const instance = createServer(createOptions);
          await instance.start();
          state.instance = instance;
          state.configKey = key;
        })();
      }
      try {
        await state.startPromise;
      } catch (error) {
        state.instance = null;
        state.configKey = null;
        throw error;
      } finally {
        state.startPromise = null;
      }
    }
    state.refs += 1;
    return state.instance;
  }

  async function release() {
    if (state.refs > 0) {
      state.refs -= 1;
    }
    if (state.refs === 0) {
      await stopInstance();
    }
  }

  return {
    acquire,
    release,
    get instance() {
      return state.instance;
    },
    get refs() {
      return state.refs;
    },
  };
}
