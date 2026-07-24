'use strict';

const archiverModule = require('archiver');

function createZipArchive(options) {
  if (typeof archiverModule.ZipArchive === 'function') {
    return new archiverModule.ZipArchive(options);
  }

  const archiver = archiverModule.default || archiverModule;
  return archiver('zip', options);
}

module.exports = { createZipArchive };
