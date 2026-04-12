'use strict';

const cheerio = require('cheerio');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCommentDomStats(browser, tabId) {
  return browser.executeScript(
    tabId,
    `(() => ({
      topLevelCommentCount: document.querySelectorAll("shreddit-comment[depth='0']").length,
      commentCount: document.querySelectorAll('shreddit-comment').length,
      collapsedCount: document.querySelectorAll('shreddit-comment[collapsed]').length,
      moreRepliesCount: document.querySelectorAll('a[slot="more-comments-permalink"]').length,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY
    }))()`,
  );
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

async function scrollRedditThread(browser, tabId, options = {}) {
  const settings = {
    maxSteps: options.maxSteps || 18,
    stepPx: options.stepPx || 900,
    stepDelayMs: options.stepDelayMs || 350,
    settleMs: options.settleMs || 1000,
  };

  return browser.executeScript(
    tabId,
    `(async () => {
      const options = ${JSON.stringify(settings)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(300);

      let steps = 0;
      let stableBottomHits = 0;
      let previousHeight = document.documentElement.scrollHeight;

      while (steps < options.maxSteps) {
        const maxY = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
        const nextY = Math.min(window.scrollY + options.stepPx, maxY);
        window.scrollTo({ top: nextY, behavior: 'instant' });
        await sleep(options.stepDelayMs);

        const currentHeight = document.documentElement.scrollHeight;
        const atBottom = window.scrollY + window.innerHeight >= currentHeight - 4;

        if (atBottom) {
          stableBottomHits = currentHeight === previousHeight ? stableBottomHits + 1 : 0;
          previousHeight = currentHeight;
          if (stableBottomHits >= 2) {
            break;
          }
        } else {
          previousHeight = currentHeight;
        }

        steps += 1;
      }

      await sleep(options.settleMs);

      return {
        steps,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        topLevelCommentCount: document.querySelectorAll("shreddit-comment[depth='0']").length,
        commentCount: document.querySelectorAll('shreddit-comment').length,
      };
    })()`,
  );
}

async function expandCollapsedComments(browser, tabId, options = {}) {
  const settings = {
    maxTargets: options.maxTargets || 24,
  };

  return browser.executeScript(
    tabId,
    `(async () => {
      const options = ${JSON.stringify(settings)};

      const hydrateCommentInPlace = (current, source) => {
        const sourceAttrs = new Map(Array.from(source.attributes).map((attr) => [attr.name, attr.value]));

        for (const attr of Array.from(current.attributes)) {
          if (!sourceAttrs.has(attr.name)) {
            current.removeAttribute(attr.name);
          }
        }

        for (const [name, value] of sourceAttrs.entries()) {
          current.setAttribute(name, value);
        }

        const sourceChildren = Array.from(source.children).filter((child) => {
          if (!child || !child.tagName) {
            return false;
          }
          const tag = child.tagName.toLowerCase();
          const slot = child.getAttribute('slot') || '';
          return tag !== 'shreddit-comment' && slot !== 'more-comments-permalink' && !slot.startsWith('children-');
        });

        for (const child of sourceChildren) {
          const slot = child.getAttribute('slot') || '';
          const tag = child.tagName.toLowerCase();
          const existing = Array.from(current.children).find((candidate) => {
            if (!candidate || !candidate.tagName) {
              return false;
            }
            return candidate.tagName.toLowerCase() === tag && (candidate.getAttribute('slot') || '') === slot;
          });

          const imported = document.importNode(child, true);
          if (existing) {
            existing.replaceWith(imported);
          } else {
            current.appendChild(imported);
          }
        }
      };

      const targets = Array.from(document.querySelectorAll('shreddit-comment[collapsed]'))
        .slice(0, options.maxTargets)
        .map((commentNode) => ({
          commentId: commentNode.getAttribute('thingid'),
          reloadUrl: commentNode.getAttribute('reload-url'),
        }))
        .filter((item) => item.commentId && item.reloadUrl);

      const results = [];

      for (const target of targets) {
        const current = document.querySelector('shreddit-comment[thingid="' + target.commentId + '"]');
        if (!current) {
          results.push({ commentId: target.commentId, ok: false, reason: 'missing-current' });
          continue;
        }

        try {
          const response = await fetch(new URL(target.reloadUrl, location.origin).toString(), { credentials: 'include' });
          const html = await response.text();
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const source = parsed.querySelector('shreddit-comment[thingid="' + target.commentId + '"]');

          if (!source) {
            results.push({ commentId: target.commentId, ok: false, reason: 'missing-source' });
            continue;
          }

          hydrateCommentInPlace(current, source);
          results.push({
            commentId: target.commentId,
            ok: true,
            collapsed: current.hasAttribute('collapsed'),
          });
        } catch (error) {
          results.push({ commentId: target.commentId, ok: false, reason: error.message });
        }
      }

      return {
        attempted: targets.length,
        expandedCount: results.filter((item) => item.ok).length,
        results,
        remainingCollapsedCount: document.querySelectorAll('shreddit-comment[collapsed]').length,
        moreRepliesCount: document.querySelectorAll('a[slot="more-comments-permalink"]').length,
        commentCount: document.querySelectorAll('shreddit-comment').length,
      };
    })()`,
    { timeout: 120 },
  );
}

async function expandMoreReplies(browser, tabId, options = {}) {
  const settings = {
    maxTargets: options.maxTargets || 6,
    iframeHydrationAttempts: options.iframeHydrationAttempts || 8,
    iframeHydrationDelayMs: options.iframeHydrationDelayMs || 1000,
    iframeLoadTimeoutMs: options.iframeLoadTimeoutMs || 15000,
  };

  return browser.executeScript(
    tabId,
    `(async () => {
      const options = ${JSON.stringify(settings)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const makeSignature = (node) => {
        if (!node || !node.tagName) {
          return '';
        }
        return [
          node.tagName.toLowerCase(),
          node.getAttribute('slot') || '',
          node.getAttribute('thingid') || '',
          node.getAttribute('href') || '',
        ].join('|');
      };

      const collectTargets = () => {
        const deduped = new Map();
        for (const link of Array.from(document.querySelectorAll('a[slot="more-comments-permalink"]'))) {
          const parentComment = link.closest('shreddit-comment');
          const commentId = parentComment?.getAttribute('thingid') || '';
          const href = link.getAttribute('href') || '';
          if (!commentId || !href || deduped.has(commentId)) {
            continue;
          }
          deduped.set(commentId, {
            commentId,
            href: new URL(href, location.origin).toString(),
          });
        }
        return Array.from(deduped.values()).slice(0, options.maxTargets);
      };

      const readRootFromIframe = async (target) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;';
        iframe.src = target.href;
        document.body.appendChild(iframe);

        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('iframe load timeout')), options.iframeLoadTimeoutMs);
            iframe.onload = () => {
              clearTimeout(timer);
              resolve();
            };
            iframe.onerror = () => {
              clearTimeout(timer);
              reject(new Error('iframe load error'));
            };
          });

          let iframeDoc = iframe.contentDocument;
          for (let attempt = 0; attempt < options.iframeHydrationAttempts; attempt += 1) {
            if (iframeDoc?.querySelectorAll('shreddit-comment').length) {
              break;
            }
            await sleep(options.iframeHydrationDelayMs);
            iframeDoc = iframe.contentDocument;
          }

          return iframeDoc?.querySelector('shreddit-comment[thingid="' + target.commentId + '"]') || null;
        } finally {
          iframe.remove();
        }
      };

      const results = [];
      for (const target of collectTargets()) {
        const current = document.querySelector('shreddit-comment[thingid="' + target.commentId + '"]');
        if (!current) {
          results.push({ commentId: target.commentId, ok: false, reason: 'missing-current' });
          continue;
        }

        try {
          const sourceRoot = await readRootFromIframe(target);
          if (!sourceRoot) {
            results.push({ commentId: target.commentId, ok: false, reason: 'missing-source-root' });
            continue;
          }

          const existingChildren = new Set(
            Array.from(current.querySelectorAll('shreddit-comment')).map((node) => node.getAttribute('thingid')).filter(Boolean),
          );
          const directChildren = Array.from(sourceRoot.children).filter((child) => {
            if (!child || !child.tagName) {
              return false;
            }
            const tag = child.tagName.toLowerCase();
            const slot = child.getAttribute('slot') || '';
            return tag === 'shreddit-comment' || slot === 'more-comments-permalink' || slot.startsWith('children-');
          });

          let appendedCount = 0;
          const seen = new Set(Array.from(current.children).map((child) => makeSignature(child)));

          for (const child of directChildren) {
            const signature = makeSignature(child);
            const childCommentId = child.getAttribute?.('thingid') || '';
            if (childCommentId && existingChildren.has(childCommentId)) {
              continue;
            }
            if (signature && seen.has(signature)) {
              continue;
            }
            current.appendChild(document.importNode(child, true));
            if (signature) {
              seen.add(signature);
            }
            if (childCommentId) {
              existingChildren.add(childCommentId);
            }
            appendedCount += 1;
          }

          results.push({ commentId: target.commentId, ok: true, appendedCount });
        } catch (error) {
          results.push({ commentId: target.commentId, ok: false, reason: error.message });
        }
      }

      return {
        attempted: results.length,
        appendedCount: results.reduce((sum, item) => sum + (item.appendedCount || 0), 0),
        results,
        commentCount: document.querySelectorAll('shreddit-comment').length,
        moreRepliesCount: document.querySelectorAll('a[slot="more-comments-permalink"]').length,
      };
    })()`,
    { timeout: 180 },
  );
}

async function prepareRedditDom(browser, tabId) {
  await waitForCommentsReady(browser, tabId, 20000);
  await scrollRedditThread(browser, tabId);

  let previousSignature = '';
  for (let pass = 0; pass < 3; pass += 1) {
    const collapsedResult = await expandCollapsedComments(browser, tabId);
    const moreRepliesResult = await expandMoreReplies(browser, tabId);
    const stats = await getCommentDomStats(browser, tabId);
    const signature = JSON.stringify(stats);

    if (
      previousSignature === signature ||
      (collapsedResult.expandedCount === 0 && moreRepliesResult.appendedCount === 0)
    ) {
      break;
    }
    previousSignature = signature;
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
    await prepareRedditDom(browser, tabId);
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
