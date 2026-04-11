'use strict';

const cheerio = require('cheerio');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertRedditUrl(url) {
  if (typeof url !== 'string' || !/reddit\.com\//.test(url)) {
    throw new Error(`URL 不属于 Reddit 帖子: ${url}`);
  }
}

async function openOrReuseTab(browser, url) {
  const tabsResult = await browser.getTabs();
  const tabs = Array.isArray(tabsResult?.tabs) ? tabsResult.tabs : [];
  const matchedTab = tabs.find((tab) => tab.url === url);
  if (matchedTab) {
    return { tabId: matchedTab.id, isReused: true };
  }

  const tabId = await browser.openUrl(url);
  return { tabId, isReused: false };
}

async function waitForReady(browser, tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await browser.executeScript(
      tabId,
      `(() => ({
        readyState: document.readyState,
        hasContent: !!document.querySelector('shreddit-post, h1')
      }))()`,
    );
    if (state && (state.readyState === 'complete' || state.readyState === 'interactive') && state.hasContent) {
      return;
    }
    await sleep(700);
  }
}

async function waitForCommentsReady(browser, tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await browser.executeScript(
      tabId,
      `(() => ({
        commentCount: document.querySelectorAll('shreddit-comment[depth="0"]').length,
        hasCommentContent: !!document.querySelector('div[slot="comment"]')
      }))()`,
    );
    if (state && (state.commentCount > 0 || state.hasCommentContent)) {
      return;
    }
    await sleep(700);
  }
}

function extractSingleRedditComment($, $comment) {
  const authorName = $comment.attr('author') || '';
  const thingId = $comment.attr('thingid') || '';
  const score = $comment.attr('score') || '0';
  const depth = parseInt($comment.attr('depth') || '0', 10);
  const permalink = $comment.attr('permalink') || '';

  let content = '';
  const contentContainer = $comment.find('div[slot="comment"], div[slot="comment-content"], div[data-post-click-location="text-body"]').first();
  if (contentContainer.length > 0) {
    content = contentContainer.text().trim();
  } else {
    const paragraphs = $comment.find('p');
    const texts = [];
    paragraphs.each((_, p) => {
      const text = $(p).text().trim();
      if (text) {
        texts.push(text);
      }
    });
    content = texts.join('\n');
  }

  if (!content) {
    const $clone = $comment.clone();
    $clone.find('shreddit-comment').remove();
    $clone.find('shreddit-comment-action-row').remove();
    $clone.find('[slot="actionRow"]').remove();
    content = $clone.find('div').filter((_, el) => {
      const text = $(el).text().trim();
      return text.length > 10 && !text.includes('Reply') && !text.includes('Share');
    }).first().text().trim();
  }

  const timeElem = $comment.find('time, faceplate-timeago').first();
  const time = timeElem.attr('datetime') || timeElem.attr('ts') || timeElem.text().trim() || '';

  const replies = [];
  $comment.children(`shreddit-comment[depth="${depth + 1}"]`).each((_, replyElem) => {
    const reply = extractSingleRedditComment($, $(replyElem));
    if (reply && (reply.content || reply.author_name)) {
      replies.push(reply);
    }
  });

  return {
    author_name: authorName,
    comment_id: thingId,
    content,
    score,
    depth,
    permalink: permalink ? `https://www.reddit.com${permalink}` : '',
    time,
    replies,
  };
}

function extractRedditComments($) {
  const comments = [];
  $('shreddit-comment[depth="0"]').each((_, elem) => {
    const comment = extractSingleRedditComment($, $(elem));
    if (comment && (comment.content || comment.author_name)) {
      comments.push(comment);
    }
  });
  return comments;
}

function extractRedditContent(html, url) {
  const $ = cheerio.load(html);
  const shredditPost = $('shreddit-post').first();

  let title = '';
  let content = '';
  let authorName = '';
  let authorId = '';
  let publishTime = '';
  let upvoteCount = '0';
  let commentCount = '0';
  let subredditName = '';
  let subredditUrl = '';

  if (shredditPost.length > 0) {
    title = shredditPost.attr('post-title') || '';
    upvoteCount = shredditPost.attr('score') || '0';
    commentCount = shredditPost.attr('comment-count') || '0';
    publishTime = shredditPost.attr('created-timestamp') || '';

    const subredditPrefixed = shredditPost.attr('subreddit-prefixed-name') || '';
    const subredditMatch = subredditPrefixed.match(/r\/([\w]+)/);
    if (subredditMatch) {
      subredditName = subredditMatch[1];
      subredditUrl = `https://www.reddit.com/r/${subredditName}`;
    }

    const overflowMenu = $('shreddit-post-overflow-menu').first();
    authorName = overflowMenu.attr('author-name') || '';
    authorId = overflowMenu.attr('author-id') || '';

    if (!authorName) {
      const authorLink = shredditPost.find('a[href^="/user/"]').first();
      const href = authorLink.attr('href') || '';
      const match = href.match(/\/user\/([\w-]+)/);
      if (match) {
        authorId = match[1];
        authorName = authorId;
      }
    }
  }

  const textBody = $('shreddit-post-text-body').first();
  if (textBody.length > 0) {
    const textContainer = textBody.find('div[data-post-click-location="text-body"]').first();
    content = (textContainer.length ? textContainer : textBody).text().trim();
  }

  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || '';
  }

  const imageUrls = [];
  const seen = new Set();
  $('shreddit-post img, [slot="post-media-container"] img').each((_, elem) => {
    const src = $(elem).attr('src') || $(elem).attr('data-src') || '';
    if (
      src &&
      !src.includes('avatar') &&
      !src.includes('icon') &&
      !src.includes('logo') &&
      !src.includes('redditstatic.com/avatars') &&
      !src.includes('emoji') &&
      (src.includes('i.redd.it') || src.includes('preview.redd.it') || src.includes('external-preview'))
    ) {
      if (!seen.has(src)) {
        seen.add(src);
        imageUrls.push(src);
      }
    }
  });

  return {
    title,
    content,
    author_name: authorName,
    author_id: authorId,
    publish_time: publishTime,
    upvote_count: upvoteCount,
    comment_count: commentCount,
    subreddit_name: subredditName,
    subreddit_url: subredditUrl,
    image_urls: imageUrls,
    comments: extractRedditComments($),
    source_url: url,
  };
}

async function scrapeRedditPost(browser, url) {
  assertRedditUrl(url);

  let tabId = null;
  let shouldClose = false;

  try {
    const opened = await openOrReuseTab(browser, url);
    tabId = opened.tabId;
    shouldClose = !opened.isReused;

    await waitForReady(browser, tabId);
    await waitForCommentsReady(browser, tabId);
    const html = await browser.getTabHtml(tabId);

    return {
      platform: 'reddit',
      sourceUrl: url,
      timestamp: new Date().toISOString(),
      data: extractRedditContent(html, url),
    };
  } finally {
    if (tabId && shouldClose) {
      try {
        await browser.closeTab(tabId);
      } catch (_) {}
    }
  }
}

module.exports = {
  extractRedditContent,
  scrapeRedditPost,
};
