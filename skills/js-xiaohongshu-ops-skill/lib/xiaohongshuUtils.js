'use strict';

const cheerio = require('cheerio');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertXhsUrl(url) {
  if (typeof url !== 'string' || !/xiaohongshu\.com\//.test(url)) {
    throw new Error(`URL 不属于小红书笔记: ${url}`);
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
        hasMeta: !!document.querySelector('meta[name="description"], meta[name="og:title"], meta[property="og:title"]')
      }))()`,
    );
    if (state && (state.readyState === 'complete' || state.readyState === 'interactive') && state.hasMeta) {
      return;
    }
    await sleep(700);
  }
}

function cookieHeaderFromCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return '';
  }

  return cookies
    .filter((cookie) => cookie?.name && cookie?.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function isXhsTimeText(text) {
  return /^\d{2}-\d{2}$/.test(text)
    || /^\d{4}-\d{2}-\d{2}$/.test(text)
    || /^\d+[天小时分钟秒]前$/.test(text)
    || text === '昨天'
    || text === '前天';
}

function pickLongestMeaningfulText(texts, excluded = []) {
  const excludedSet = new Set(excluded.filter(Boolean));
  const filtered = Array.from(new Set(texts.map((text) => text.trim()).filter(Boolean))).filter((text) => {
    if (excludedSet.has(text)) return false;
    if (isXhsTimeText(text)) return false;
    if (/^\d+$/.test(text)) return false;
    if (text.length <= 1) return false;
    if (text === '回复' || text === '赞' || text === '作者' || text === '展开') return false;
    if (/^共\s*\d+\s*条评论$/.test(text)) return false;
    return true;
  });

  filtered.sort((a, b) => b.length - a.length);
  return filtered[0] || '';
}

function normalizeXhsApiComment(comment) {
  if (!comment || typeof comment !== 'object') {
    return null;
  }

  const userInfo = comment.user_info || comment.user || {};
  const replies = Array.isArray(comment.sub_comments)
    ? comment.sub_comments.map(normalizeXhsApiComment).filter(Boolean)
    : [];

  return {
    comment_id: comment.id || comment.comment_id || '',
    author_name: userInfo.nickname || userInfo.user_name || '',
    author_id: userInfo.user_id || userInfo.userId || '',
    author_avatar: userInfo.image || userInfo.avatar || '',
    content: comment.content || comment.note_comment || '',
    like_count: comment.like_count ?? comment.liked_count ?? 0,
    time: comment.create_time || comment.time || '',
    replies,
  };
}

function extractXhsCommentsFromHtml(html) {
  const $ = cheerio.load(html);
  const totalText = $('.comments-container .total').first().text().trim();
  const totalMatch = totalText.match(/(\d+)/);
  const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const comments = [];

  $('.comments-container .parent-comment > .comment-item').each((_, elem) => {
    const $item = $(elem);
    const authorLink = $item.find('.author a[href*="/user/profile/"]').first();
    const authorName = authorLink.text().trim();
    const authorId = authorLink.attr('data-user-id')
      || authorLink.attr('href')?.match(/\/user\/profile\/([^?]+)/)?.[1]
      || '';
    const authorAvatar = $item.find('.avatar img').first().attr('src') || '';
    const content = $item.find('.content .note-text').first().text().trim()
      || $item.find('.content').first().text().trim()
      || pickLongestMeaningfulText(
        $item.find('div, span, p, a').map((__, node) => $(node).text().trim()).get(),
        [authorName],
      );
    const time = $item.find('.info .date span').first().text().trim()
      || $item.find('.date span').first().text().trim()
      || '';
    const rawLikeCount = $item.find('.interactions .like .count').first().text().trim()
      || $item.find('.like .count').first().text().trim()
      || '0';
    const likeCount = /\d/.test(rawLikeCount) ? rawLikeCount : '0';
    if (!authorName && !content) {
      return;
    }

    comments.push({
      comment_id: $item.attr('id')?.replace(/^comment-/, '') || '',
      author_name: authorName,
      author_id: authorId,
      author_avatar: authorAvatar,
      content,
      like_count: likeCount,
      time,
      replies: [],
    });
  });

  return { comments, totalCount };
}

async function fetchXhsCommentsInPage(browser, tabId, url, maxPages = 0) {
  if (maxPages <= 0) {
    return { comments: [], totalCount: 0 };
  }

  const script = `
    (async () => {
      const targetUrl = ${JSON.stringify(url)};
      const parsed = new URL(targetUrl);
      const noteId = parsed.pathname.split('/').pop();
      const xsecToken = parsed.searchParams.get('xsec_token') || '';
      let cursor = '';
      let hasMore = true;
      let iteration = 0;
      const maxPages = ${JSON.stringify(maxPages)};
      const allComments = [];
      let lastError = null;

      while (hasMore && iteration < maxPages) {
        const apiUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'
          + '?note_id=' + encodeURIComponent(noteId)
          + '&cursor=' + encodeURIComponent(cursor)
          + '&top_comment_id='
          + '&image_formats=jpg,webp,avif'
          + '&xsec_token=' + encodeURIComponent(xsecToken);

        try {
          const response = await fetch(apiUrl, {
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
          });
          const payload = await response.json();
          if (!response.ok || payload?.success === false || payload?.code) {
            lastError = payload?.msg || payload?.message || ('HTTP ' + response.status);
            break;
          }

          const pageData = payload?.data || {};
          const comments = Array.isArray(pageData.comments) ? pageData.comments : [];
          allComments.push(...comments);
          hasMore = !!pageData.has_more;
          cursor = pageData.cursor || '';
          iteration += 1;
        } catch (error) {
          lastError = error.message;
          break;
        }
      }

      return {
        comments: allComments,
        totalCount: allComments.length,
        error: lastError,
      };
    })()
  `;

  const result = await browser.executeScript(tabId, script, { timeout: 30 });
  const comments = Array.isArray(result?.comments)
    ? result.comments.map(normalizeXhsApiComment).filter(Boolean)
    : [];

  return {
    comments,
    totalCount: result?.totalCount || comments.length,
    error: result?.error || null,
  };
}

function extractUserInfo(html) {
  const userIdMatch = html.match(/"userId":\s*"([^"]+)"/);
  const nicknameMatch = html.match(/"nickname":\s*"([^"]+)"/);
  const userId = userIdMatch ? userIdMatch[1] : '未找到用户ID';
  const nickname = nicknameMatch ? nicknameMatch[1] : '未找到用户昵称';
  const userUrl = userIdMatch ? `https://www.xiaohongshu.com/user/profile/${userId}` : '';
  return { userId, nickname, userUrl };
}

function mergeCommentInfo(primary, fallback) {
  const primaryComments = Array.isArray(primary?.comments) ? primary.comments : [];
  const fallbackComments = Array.isArray(fallback?.comments) ? fallback.comments : [];
  const comments = primaryComments.length > 0 ? primaryComments : fallbackComments;
  const totalCount = Math.max(primary?.totalCount || 0, fallback?.totalCount || 0, comments.length);
  return { comments, totalCount };
}

function extractNoteContent(html, url, commentInfo) {
  const $ = cheerio.load(html);

  let title = $('meta[name="og:title"]').attr('content') || $('meta[property="og:title"]').attr('content') || '未找到标题';
  if (title.length > 6 && title.endsWith(' - 小红书')) {
    title = title.slice(0, -6);
  }

  const description = $('meta[name="description"]').attr('content') || '未找到正文';
  const imageUrls = [];
  $('meta[name="og:image"], meta[property="og:image"]').each((_, elem) => {
    const value = $(elem).attr('content');
    if (value) {
      imageUrls.push(value);
    }
  });

  const { userId, nickname, userUrl } = extractUserInfo(html);

  return {
    title,
    description,
    content: description,
    image_urls: Array.from(new Set(imageUrls)),
    note_comment: $('meta[name="og:xhs:note_comment"], meta[property="og:xhs:note_comment"]').attr('content') || '未找到评论数',
    note_like: $('meta[name="og:xhs:note_like"], meta[property="og:xhs:note_like"]').attr('content') || '未找到点赞数',
    note_collect: $('meta[name="og:xhs:note_collect"], meta[property="og:xhs:note_collect"]').attr('content') || '未找到收藏数',
    user_id: userId,
    nickname,
    user_url: userUrl,
    comments: commentInfo.comments,
    total_comments_count: commentInfo.totalCount,
    source_url: url,
  };
}

async function scrapeXhsNote(browser, url, options = {}) {
  assertXhsUrl(url);

  let tabId = null;
  let shouldClose = false;

  try {
    const opened = await openOrReuseTab(browser, url);
    tabId = opened.tabId;
    shouldClose = !opened.isReused;

    await waitForReady(browser, tabId);

    const [html, cookies, userAgent] = await Promise.all([
      browser.getTabHtml(tabId),
      browser.getCookies(tabId),
      browser.executeScript(tabId, 'navigator.userAgent'),
    ]);

    void cookies;
    void userAgent;
    const domCommentInfo = extractXhsCommentsFromHtml(html);
    const pageCommentInfo = await fetchXhsCommentsInPage(browser, tabId, url, options.maxCommentPages || 0);
    const commentInfo = mergeCommentInfo(domCommentInfo, pageCommentInfo);

    return {
      platform: 'xiaohongshu',
      sourceUrl: url,
      timestamp: new Date().toISOString(),
      data: extractNoteContent(html, url, commentInfo),
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
  extractNoteContent,
  scrapeXhsNote,
};
