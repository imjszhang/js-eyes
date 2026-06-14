'use strict';

const { runTool } = require('./runTool');

async function getFrontPage(browser, args, options) {
  return runTool(browser, {
    toolName: 'hn_get_front_page',
    pageKey: 'front',
    method: 'getFrontPage',
    args: args || {},
    targetUrl: null,
    cmdDef: { domSupported: true, apiSupported: true },
    options,
  });
}

async function getItem(browser, args, options) {
  const targets = require('./toolTargets');
  return runTool(browser, {
    toolName: 'hn_get_item',
    pageKey: 'item',
    method: 'getItem',
    args: args || {},
    targetUrl: targets.itemUrl(args),
    cmdDef: { domSupported: true, apiSupported: true },
    options,
  });
}

async function getUser(browser, args, options) {
  const targets = require('./toolTargets');
  return runTool(browser, {
    toolName: 'hn_get_user',
    pageKey: 'user',
    method: 'getUser',
    args: args || {},
    targetUrl: targets.userUrl(args),
    cmdDef: { domSupported: true, apiSupported: true },
    options,
  });
}

async function search(browser, args, options) {
  return runTool(browser, {
    toolName: 'hn_search',
    pageKey: 'search',
    method: 'search',
    args: args || {},
    targetUrl: null,
    cmdDef: { domSupported: false, apiSupported: true },
    options,
  });
}

module.exports = {
  getFrontPage,
  getItem,
  getUser,
  search,
};
