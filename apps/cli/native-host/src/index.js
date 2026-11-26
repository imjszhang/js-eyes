'use strict';

module.exports = {
  ...require('./host'),
  ...require('./installer'),
  ...require('./manifest'),
  ...require('./paths'),
  ...require('./extension-ids'),
  codec: require('./codec'),
};
