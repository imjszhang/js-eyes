// bridges/home-bridge.js
// ---------------------------------------------------------------------------
// 小红书探索流首页 bridge（最小占位：v2.3 阶段仅 sessionState + navigateHome）。
//
// 暴露 window.__jse_xhs_home__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateHome()
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '0.1.2';

  // @@include ./common.js

  function _stateReady() {
    var p = location.pathname || '';
    return p === '/' || /^\/explore\/?$/.test(p);
  }

  function probe() {
    var session = sessionStateCommon();
    return okResult({
      url: location.href,
      hostname: location.hostname,
      bridge: { version: VERSION, name: 'home-bridge' },
      login: session && session.data ? session.data : null,
      timestamp: new Date().toISOString(),
    });
  }

  function state() {
    var ready = _stateReady();
    return okResult({
      ready: ready,
      reason: ready ? null : 'not_on_home',
      url: location.href,
      bridgeVersion: VERSION,
    });
  }

  function sessionState() { return sessionStateCommon(); }

  function navigateHome() {
    return navigateLocation('https://www.xiaohongshu.com/explore');
  }

  window.__jse_xhs_home__ = {
    __meta: { version: VERSION, name: 'home-bridge' },
    probe: probe,
    state: state,
    sessionState: sessionState,
    navigateHome: navigateHome,
  };

  return { ok: true, version: VERSION, name: 'home-bridge' };
})();
