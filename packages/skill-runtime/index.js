'use strict';

const errors = require('./errors');
const runtime = require('./runtime');
const hostService = require('./host-service');
const permissions = require('./permissions');
const nativeHandlers = require('./native-handlers');
const workerBackend = require('./worker-backend');
const registry = require('./registry');

module.exports = {
  ...errors,
  ...runtime,
  ...hostService,
  ...permissions,
  ...nativeHandlers,
  ...workerBackend,
  ...registry,
};
