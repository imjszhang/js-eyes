'use strict';

const { extractPageContent, normalizeExtractOptions } = require('./extract-page-content');

/**
 * Build an injectable IIFE that runs the same extractPageContent body in-page.
 * Used when the extension does not yet expose first-class page.extract.
 */
function generateReadPageScript(format, extraOptions) {
  const raw = format && typeof format === 'object'
    ? { ...format, ...(extraOptions || {}) }
    : { format, ...(extraOptions || {}) };
  const options = normalizeExtractOptions(raw);
  return `(${extractPageContent.toString()})(document, ${JSON.stringify(options)});`;
}

module.exports = {
  extractPageContent,
  generateReadPageScript,
  normalizeExtractOptions,
};
