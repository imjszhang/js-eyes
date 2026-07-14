'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderContentStateToMarkdown,
  parseArticleContentFromTweet,
  normalizeArticleEntityMap,
  isArticleGraphQLComplete,
} = require('../lib/articleContentState');

describe('lib/articleContentState', () => {
  it('normalizeArticleEntityMap supports dict and list', () => {
    assert.deepEqual(normalizeArticleEntityMap({ '0': { type: 'LINK' } }), { '0': { type: 'LINK' } });
    assert.deepEqual(
      normalizeArticleEntityMap([{ key: '1', value: { type: 'IMAGE' } }]),
      { '1': { type: 'IMAGE' } },
    );
  });

  it('renderContentStateToMarkdown extracts inline images via media_entities', () => {
    const contentState = {
      blocks: [
        { text: 'Intro', type: 'unstyled', entity_ranges: [], inline_style_ranges: [] },
        {
          text: ' ',
          type: 'atomic',
          entity_ranges: [{ key: 0, offset: 0, length: 1 }],
          inline_style_ranges: [],
        },
      ],
      entityMap: {
        '0': {
          type: 'IMAGE',
          data: {
            caption: 'diagram',
            mediaItems: [{ mediaId: 'm1' }],
          },
        },
      },
    };
    const articleRoot = {
      media_entities: [{
        media_id: 'm1',
        media_info: { original_img_url: 'https://pbs.twimg.com/media/AbCd.jpg' },
      }],
    };
    const out = renderContentStateToMarkdown(contentState, articleRoot);
    assert.match(out.contentMarkdown, /!\[diagram\]/);
    assert.equal(out.mediaDetails.length, 1);
    assert.equal(out.mediaDetails[0].url, 'https://pbs.twimg.com/media/AbCd.jpg');
    assert.equal(out.expectedInlineMedia, true);
  });

  it('parseArticleContentFromTweet merges article_results + rich content', () => {
    const tweet = {
      article: {
        article_results: {
          result: {
            rest_id: '99',
            title: 'Test Article',
            plain_text: 'fallback plain',
            content_state: {
              blocks: [{
                text: 'Hello world from article content_state parser with enough length for completeness check.',
                type: 'unstyled',
                entity_ranges: [],
                inline_style_ranges: [],
              }],
              entityMap: {},
            },
            cover_media: {
              media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' },
            },
            media_entities: [],
          },
        },
      },
      article_rich_content: {
        plain_text: 'should not override blocks',
      },
      legacy: { full_text: 'x' },
    };
    const parsed = parseArticleContentFromTweet(tweet);
    assert.ok(parsed);
    assert.equal(parsed.title, 'Test Article');
    assert.match(parsed.contentMarkdown, /Hello world from article/);
    assert.equal(parsed.coverUrl, 'https://pbs.twimg.com/media/cover.jpg');
    assert.equal(isArticleGraphQLComplete(parsed), true);
  });

  it('parseArticleContentFromTweet marks incomplete when inline media expected but missing', () => {
    const tweet = {
      article: {
        article_results: {
          result: {
            rest_id: '1',
            title: 'T',
            content_state: {
              blocks: [{
                text: ' ',
                type: 'atomic',
                entity_ranges: [{ key: 0, offset: 0, length: 1 }],
              }],
              entityMap: {
                '0': { type: 'IMAGE', data: { mediaItems: [{ mediaId: 'missing' }] } },
              },
            },
            media_entities: [],
          },
        },
      },
      legacy: {},
    };
    const parsed = parseArticleContentFromTweet(tweet);
    assert.equal(parsed.expectedInlineMedia, true);
    assert.equal(parsed.mediaDetails.length, 0);
    assert.equal(isArticleGraphQLComplete(parsed), false);
  });
});
