'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const commonSrc = fs.readFileSync(
  path.join(__dirname, '..', 'bridges', 'common.js'),
  'utf8'
);

function extractFn(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`无法定位函数: ${name}`);
  let depth = 0;
  let i = src.indexOf('{', m.index);
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`函数 ${name} 未闭合`);
}

const fnSrc = extractFn(commonSrc, '_extractQueryIdFromBundleText');
const extractQueryId = new Function(`${fnSrc}\nreturn _extractQueryIdFromBundleText;`)();

test('GraphQL bundle discovery supports queryId before operationName', () => {
  const src = 'x={queryId:"abc_123-def",metadata:{kind:"query"},operationName:"HomeTimeline"}';
  assert.equal(extractQueryId(src, 'HomeTimeline'), 'abc_123-def');
});

test('GraphQL bundle discovery supports operationName before queryId and single quotes', () => {
  const src = "x={operationName:'HomeTimeline',metadata:{kind:'query'},queryId:'new_query-id'}";
  assert.equal(extractQueryId(src, 'HomeTimeline'), 'new_query-id');
});

test('GraphQL bundle discovery does not return a neighboring operation queryId', () => {
  const src = 'x={queryId:"search-id",operationName:"SearchTimeline"}';
  assert.equal(extractQueryId(src, 'HomeTimeline'), null);
});
