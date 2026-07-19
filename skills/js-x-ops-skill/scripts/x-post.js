#!/usr/bin/env node
'use strict';

const { main } = require('../flows/post');
const { parseArgs, extractTweetId } = require('../commands/post-options');
const {
  buildDiscoverTweetQueryIdsScript,
  buildTweetDetailScript,
  buildTweetDetailCursorScript,
  buildParseTweetResultSnippet,
  buildTweetByRestIdScript,
} = require('../graphql/tweet-detail');
const { buildPostDomScript } = require('../dom/post-read');
const {
  buildReplyViaDomScript,
  buildReplyViaIntentScript,
  buildNewTweetViaDomScript,
  buildQuoteTweetViaDomScript,
} = require('../dom/post-write');
const {
  buildDiscoverCreateTweetQueryIdScript,
  buildCreateReplyScript,
  buildCreateNewTweetScript,
} = require('../graphql/tweet-write');
const {
  postReplyViaDom,
  postReplyViaIntent,
  postReplyViaMutation,
  postNewTweetViaMutation,
  postNewTweetViaDom,
  postQuoteTweetViaDom,
} = require('../flows/post-write');

module.exports = {
  main,
  parseArgs,
  extractTweetId,
  classifyXPostInput: require('../lib/xUrl').classifyXPostInput,
  buildDiscoverTweetQueryIdsScript,
  buildTweetDetailScript,
  buildTweetDetailCursorScript,
  buildParseTweetResultSnippet,
  buildTweetByRestIdScript,
  buildPostDomScript,
  buildReplyViaDomScript,
  postReplyViaDom,
  buildReplyViaIntentScript,
  postReplyViaIntent,
  buildDiscoverCreateTweetQueryIdScript,
  buildCreateReplyScript,
  postReplyViaMutation,
  buildCreateNewTweetScript,
  postNewTweetViaMutation,
  buildNewTweetViaDomScript,
  postNewTweetViaDom,
  buildQuoteTweetViaDomScript,
  postQuoteTweetViaDom,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('未处理的错误:', error);
    process.exit(1);
  });
}
