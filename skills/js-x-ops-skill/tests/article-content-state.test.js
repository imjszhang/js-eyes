'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderContentStateToMarkdown,
  parseArticleContentFromTweet,
  normalizeArticleEntityMap,
  buildMediaLinkMap,
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
    assert.equal(parsed.expectedInlineMediaCount, 1);
    assert.equal(parsed.resolvedInlineMediaCount, 0);
    assert.equal(parsed.inlineMediaComplete, false);
    assert.equal(parsed.mediaDetails.length, 0);
    assert.equal(isArticleGraphQLComplete(parsed), false);
  });

  it('parseArticleContentFromTweet resolves three inline images with array entityMap', () => {
    const longBody = 'A'.repeat(60);
    const contentState = {
      blocks: [
        { text: longBody, type: 'unstyled', entity_ranges: [] },
        { text: ' ', type: 'atomic', entityRanges: [{ key: 0, offset: 0, length: 1 }] },
        { text: ' ', type: 'atomic', entityRanges: [{ key: 1, offset: 0, length: 1 }] },
        { text: ' ', type: 'atomic', entityRanges: [{ key: 2, offset: 0, length: 1 }] },
      ],
      entityMap: [
        { key: '0', value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'm1' }] } } },
        { key: '1', value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'm2' }] } } },
        { key: '2', value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'm3' }] } } },
      ],
    };
    const tweet = {
      article: {
        article_results: {
          result: {
            rest_id: '2063985608381362576',
            title: 'Three images article',
            plain_text: longBody,
            content_state: contentState,
            media_entities: [
              { media_id: 'm1', media_info: { original_img_url: 'https://pbs.twimg.com/media/img1.jpg' } },
              { media_id: 'm2', media_info: { original_img_url: 'https://pbs.twimg.com/media/img2.jpg' } },
              { media_id: 'm3', media_info: { original_img_url: 'https://pbs.twimg.com/media/img3.jpg' } },
            ],
          },
        },
      },
      legacy: {},
    };
    const parsed = parseArticleContentFromTweet(tweet);
    assert.equal(parsed.expectedInlineMediaCount, 3);
    assert.equal(parsed.resolvedInlineMediaCount, 3);
    assert.equal(parsed.inlineMediaComplete, true);
    assert.equal(parsed.mediaDetails.filter((d) => d.source === 'content_state').length, 3);
    assert.equal(isArticleGraphQLComplete(parsed), true);
    assert.match(parsed.contentMarkdown, /img1\.jpg/);
    assert.match(parsed.contentMarkdown, /img2\.jpg/);
    assert.match(parsed.contentMarkdown, /img3\.jpg/);
  });

  it('content_state mediaDetails take priority over media_entities with same url', () => {
    const url = 'https://pbs.twimg.com/media/same.jpg';
    const contentState = {
      blocks: [{
        text: ' ',
        type: 'atomic',
        entity_ranges: [{ key: 0, offset: 0, length: 1 }],
      }],
      entityMap: {
        '0': { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'm1' }] } },
      },
    };
    const articleRoot = {
      media_entities: [{ media_id: 'm1', media_info: { original_img_url: url } }],
    };
    const rendered = renderContentStateToMarkdown(contentState, articleRoot);
    assert.equal(rendered.resolvedInlineMediaCount, 1);

    const tweet = {
      article: {
        article_results: {
          result: {
            rest_id: '2',
            title: 'Dedup',
            plain_text: 'X'.repeat(60),
            content_state: contentState,
            media_entities: articleRoot.media_entities,
          },
        },
      },
      legacy: {},
    };
    const parsed = parseArticleContentFromTweet(tweet);
    assert.equal(parsed.mediaDetails.length, 1);
    assert.equal(parsed.mediaDetails[0].source, 'content_state');
  });

  it('buildMediaLinkMap resolves MEDIA via adjacent LINK entity', () => {
    const entityMap = {
      '0': { key: 0, type: 'MEDIA', data: { mediaItems: [{}] } },
      '1': { key: 1, type: 'LINK', data: { url: 'https://pbs.twimg.com/media/from-link.jpg' } },
    };
    const linkMap = buildMediaLinkMap(entityMap);
    assert.equal(linkMap[0], 'https://pbs.twimg.com/media/from-link.jpg');

    const contentState = {
      blocks: [{
        text: ' ',
        type: 'atomic',
        entity_ranges: [{ key: 0, offset: 0, length: 1 }],
      }],
      entityMap,
    };
    const out = renderContentStateToMarkdown(contentState, { media_entities: [] });
    assert.match(out.contentMarkdown, /from-link\.jpg/);
    assert.equal(out.resolvedInlineMediaCount, 1);
  });
});
