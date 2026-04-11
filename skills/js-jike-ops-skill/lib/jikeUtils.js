'use strict';

const cheerio = require('cheerio');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeJikeUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('缺少即刻链接');
  }

  const mobileMatch = url.match(/https:\/\/m\.okjike\.com\/originalPosts\/([\w-]+)/);
  if (mobileMatch) {
    return `https://web.okjike.com/originalPost/${mobileMatch[1]}`;
  }
  return url;
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
        hasContent: !!document.querySelector('.mantine-Container-root')
      }))()`,
    );
    if (state && (state.readyState === 'complete' || state.readyState === 'interactive') && state.hasContent) {
      return;
    }
    await sleep(700);
  }
}

function extractSingleJikeComment($, $comment, isReply = false) {
  const $commentClone = $comment.clone();
  $commentClone.find('[data-clickable-feedback="false"]').remove();

  const authorLink = $commentClone.find('a[href^="/u/"]').first();
  const authorHref = authorLink.attr('href') || '';
  const authorId = authorHref.match(/\/u\/([\w-]+)/)?.[1] || '';
  const authorName = $commentClone.find('.jk-link-text span').first().text().trim() || '';
  const authorAvatar = $commentClone.find('img.jk-avatar, img[alt="avatar"]').first().attr('src') || '';

  let time = '';
  $commentClone.find('div').each((_, elem) => {
    const text = $(elem).text().trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(text) || /^\d+[天小时分钟]+前$/.test(text)) {
      time = text;
      return false;
    }
    return undefined;
  });

  const allUserNames = [];
  $commentClone.find('.jk-link-text span').each((_, elem) => {
    const name = $(elem).text().trim();
    if (name) {
      allUserNames.push(name);
    }
  });

  let content = '';
  $commentClone.find('div').each((_, elem) => {
    const $elem = $(elem);
    if ($elem.children('div').length > 0 || $elem.find('svg, button, img, a').length > 0) {
      return;
    }
    const text = $elem.text().trim();
    if (
      text &&
      text.length < 1000 &&
      !/^\d+$/.test(text) &&
      !/^\d{1,2}\/\d{1,2}$/.test(text) &&
      !/^\d+[天小时分钟]+前$/.test(text) &&
      !allUserNames.includes(text) &&
      text !== '作者' &&
      text !== '回复' &&
      !text.startsWith('回复')
    ) {
      if (!content) {
        content = text;
      }
    }
  });

  let likeCount = '0';
  $commentClone.find('[tabindex="0"]').each((_, elem) => {
    const $elem = $(elem);
    if ($elem.find('svg').length > 0) {
      const text = $elem.clone().children('svg').remove().end().text().trim();
      if (/^\d+$/.test(text)) {
        likeCount = text;
        return false;
      }
    }
    return undefined;
  });

  const replies = [];
  if (!isReply) {
    $comment.find('[data-clickable-feedback="false"]').each((_, elem) => {
      const reply = extractSingleJikeComment($, $(elem), true);
      if (reply && reply.content) {
        replies.push(reply);
      }
    });
  }

  return {
    author_name: authorName,
    author_id: authorId,
    author_avatar: authorAvatar,
    content,
    like_count: likeCount,
    time,
    replies,
  };
}

function extractJikeComments($) {
  const comments = [];
  let commentSection = null;

  $('header, span').each((_, elem) => {
    if ($(elem).text().includes('全部评论')) {
      commentSection = $(elem).closest('section').find('[data-clickable-feedback="true"]');
      if (commentSection.length === 0) {
        commentSection = $(elem).parent().parent().find('[data-clickable-feedback="true"]');
      }
      return false;
    }
    return undefined;
  });

  if (!commentSection || commentSection.length === 0) {
    const mainContainer = $('.mantine-Container-root').first();
    commentSection = mainContainer.find('[data-clickable-feedback="true"]');
  }

  commentSection.each((_, elem) => {
    const comment = extractSingleJikeComment($, $(elem));
    if (comment && comment.content) {
      comments.push(comment);
    }
  });

  return comments;
}

function extractJikeContent(html, url) {
  const $ = cheerio.load(html);
  const mainContainer = $('.mantine-Container-root').first();
  const mainPost = mainContainer.find('[data-clickable-feedback="false"]').first();

  const header = mainPost.find('header').first();
  const authorLink = header.find('a[href^="/u/"]').filter((_, elem) => $(elem).text().trim()).first();
  const authorHref = authorLink.attr('href') || '';
  const authorId = authorHref.match(/\/u\/([\w-]+)/)?.[1] || '';
  const authorName = authorLink.text().trim() || '未知作者';
  const authorAvatar = mainPost.find('img.jk-avatar, img[alt="avatar"]').first().attr('src') || '';

  let publishTime = '';
  header.find('div, span').each((_, elem) => {
    const text = $(elem).text().trim();
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text) || /^\d{1,2}\/\d{1,2}$/.test(text) || /^\d+[天小时分钟]+前$/.test(text)) {
      publishTime = text;
      return false;
    }
    return undefined;
  });

  let content = '';
  mainPost.find('div').each((_, elem) => {
    const $elem = $(elem);
    if ($elem.children('div').length > 0 || $elem.find('svg, button').length > 0) {
      return;
    }
    const text = $elem.text().trim();
    if (text.length > 20 && !/^\d+$/.test(text) && !/^\d{1,2}\/\d{1,2}$/.test(text) && text.length > content.length) {
      content = text;
    }
  });

  const imageUrls = [];
  mainPost.find('img[alt="图片"], img[referrerpolicy="no-referrer"]').each((_, elem) => {
    const src = $(elem).attr('src');
    if (
      src &&
      !src.includes('!120x120') &&
      !$(elem).hasClass('jk-avatar') &&
      !$(elem).hasClass('sponsor-icon') &&
      !src.includes('userProfile/DEFAULT_STROKED')
    ) {
      imageUrls.push(src);
    }
  });

  const topicLink = mainPost.find('a[href^="/topic/"]').first();
  const topicHref = topicLink.attr('href') || '';
  const topicName = topicLink.text().trim() || '';
  const topicUrl = topicHref ? `https://web.okjike.com${topicHref}` : '';

  const interactionTexts = [];
  mainPost.find('[tabindex="0"]').each((_, elem) => {
    const $elem = $(elem);
    if ($elem.find('svg').length > 0) {
      const text = $elem.clone().children('svg').remove().end().text().trim();
      if (/^\d+$/.test(text)) {
        interactionTexts.push(text);
      }
    }
  });

  return {
    content,
    image_urls: imageUrls,
    author_name: authorName,
    author_id: authorId,
    author_avatar: authorAvatar,
    publish_time: publishTime,
    like_count: interactionTexts[0] || '0',
    comment_count: interactionTexts[1] || '0',
    share_count: interactionTexts[2] || '0',
    topic_name: topicName,
    topic_url: topicUrl,
    comments: extractJikeComments($),
    source_url: url,
  };
}

async function scrapeJikePost(browser, inputUrl) {
  const url = normalizeJikeUrl(inputUrl);
  let tabId = null;
  let shouldClose = false;

  try {
    const opened = await openOrReuseTab(browser, url);
    tabId = opened.tabId;
    shouldClose = !opened.isReused;

    await waitForReady(browser, tabId);
    const html = await browser.getTabHtml(tabId);

    return {
      platform: 'jike',
      sourceUrl: url,
      timestamp: new Date().toISOString(),
      data: extractJikeContent(html, url),
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
  extractJikeContent,
  scrapeJikePost,
};
