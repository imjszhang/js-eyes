'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyPage } = require('../lib/serp/parsers');
const { cheerioPage } = require('../lib/serp/pageAdapters');
const { isHardStop } = require('../lib/searchRunner');

const FIX = path.join(__dirname, 'fixtures');

describe('classifyPage', () => {
  it('detects consent and does not treat it as a search page', () => {
    const page = cheerioPage(
      fs.readFileSync(path.join(FIX, 'consent.html'), 'utf8'),
      'https://consent.google.com/',
    );
    const blocker = classifyPage(page);
    assert.equal(blocker.kind, 'consent_required');
    assert.equal(isHardStop(blocker), true);
  });

  it('detects captcha / sorry / unusual traffic', () => {
    const page = cheerioPage(
      fs.readFileSync(path.join(FIX, 'captcha.html'), 'utf8'),
      'https://www.google.com/sorry/index?continue=https://www.google.com/search',
    );
    const blocker = classifyPage(page);
    assert.equal(blocker.kind, 'captcha_required');
    assert.equal(isHardStop(blocker), true);
  });

  it('flags unexpected hosts', () => {
    const page = cheerioPage('<html><head><title>Mail</title></head><body></body></html>', 'https://mail.google.com/');
    const blocker = classifyPage(page);
    assert.equal(blocker.kind, 'unexpected_page');
  });

  it('allows a normal search page', () => {
    const page = cheerioPage(
      fs.readFileSync(path.join(FIX, 'web.html'), 'utf8'),
      'https://www.google.com/search?q=nodejs&udm=14',
    );
    assert.equal(classifyPage(page), null);
  });
});
