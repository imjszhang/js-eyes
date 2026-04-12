'use strict';

const cheerio = require('cheerio');
const {
  createDebugState,
  recordDomStat,
  recordStep,
} = require('@js-eyes/skill-recording');

const WECHAT_CONTENT_SELECTOR = '#js_content, .rich_media_content';
const WECHAT_TITLE_SELECTOR = '.rich_media_title';

function assertWechatUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) {
    throw new Error(`URL 不属于微信公众号文章: ${url}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForDocumentReady(browser, tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await browser.executeScript(tabId, 'document.readyState');
    if (state === 'complete' || state === 'interactive') {
      return;
    }
    await sleep(500);
  }
}

async function waitForWechatContent(browser, tabId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await browser.executeScript(
      tabId,
      `(() => {
        const node = document.querySelector('${WECHAT_CONTENT_SELECTOR}');
        if (!node) {
          return { ready: false, textLength: 0 };
        }
        const text = (node.innerText || node.textContent || '').trim();
        return { ready: text.length >= 80, textLength: text.length };
      })()`,
    );
    if (state && state.ready) {
      return;
    }
    await sleep(800);
  }
}

async function getWechatDomStats(browser, tabId) {
  return browser.executeScript(
    tabId,
    `(() => {
      const contentNode = document.querySelector('${WECHAT_CONTENT_SELECTOR}');
      return {
        imageCount: document.querySelectorAll('${WECHAT_CONTENT_SELECTOR} img').length,
        contentTextLength: (contentNode?.innerText || contentNode?.textContent || '').trim().length,
        scrollHeight: document.documentElement.scrollHeight,
        title: document.title
      };
    })()`,
  );
}

async function prepareWechatPage(browser, tabId) {
  await browser.executeScript(
    tabId,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const viewportHeight = window.innerHeight || 800;
      const scrollHeight = document.documentElement.scrollHeight || viewportHeight;
      const steps = Math.ceil(scrollHeight / viewportHeight);

      for (let i = 0; i < Math.min(steps, 6); i += 1) {
        window.scrollBy(0, viewportHeight * 0.8);
        await delay(120);
      }

      window.scrollTo(0, 0);
      await delay(150);

      document.querySelectorAll('img[data-src]').forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && (!img.src || img.src.startsWith('data:'))) {
          img.src = dataSrc;
        }
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt < 2500) {
        const images = Array.from(document.querySelectorAll('${WECHAT_CONTENT_SELECTOR} img'));
        const loadedCount = images.filter((img) => img.complete || img.naturalHeight > 0).length;
        if (images.length > 0 && loadedCount >= Math.max(1, images.length * 0.5)) {
          return { phase: 'complete', total: images.length, loaded: loadedCount };
        }
        await delay(200);
      }

      const images = Array.from(document.querySelectorAll('${WECHAT_CONTENT_SELECTOR} img'));
      const loadedCount = images.filter((img) => img.complete || img.naturalHeight > 0).length;
      return { phase: 'timeout', total: images.length, loaded: loadedCount };
    })()`,
    { timeout: 30 },
  );
}

async function extractWechatImages(browser, tabId) {
  const result = await browser.executeScript(
    tabId,
    `(() => {
      const urls = new Set();
      const container = document.querySelector('${WECHAT_CONTENT_SELECTOR}');
      if (!container) {
        return [];
      }

      container.querySelectorAll('img').forEach((img) => {
        let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:') || src.includes('svg')) {
          return;
        }

        src = src.replace(/\\?.*$/, '').replace(/\\/\\d+$/, '');
        if (src.includes('res.wx.qq.com') || src.includes('emoji') || src.includes('icon')) {
          return;
        }

        urls.add(src);
      });

      return Array.from(urls);
    })()`,
  );

  return Array.isArray(result) ? result : [];
}

function extractTextWithNewlines($, element) {
  let text = '';

  element.contents().each((_, child) => {
    const $child = $(child);

    if (child.type === 'tag') {
      const tagName = child.name.toLowerCase();
      switch (tagName) {
        case 'img': {
          const imgSrc = $child.attr('data-src') || $child.attr('src') || '';
          const imgAlt = $child.attr('alt') || '';
          text += `\n![${imgAlt}](${imgSrc})\n`;
          break;
        }
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
          const depth = Number(tagName.slice(1));
          text += `${'#'.repeat(depth)} ${extractTextWithNewlines($, $child)}\n\n`;
          break;
        }
        case 'p':
          text += `${extractTextWithNewlines($, $child)}\n\n`;
          break;
        case 'strong':
        case 'b':
          text += `**${extractTextWithNewlines($, $child)}**`;
          break;
        case 'em':
        case 'i':
          text += `*${extractTextWithNewlines($, $child)}*`;
          break;
        case 'ul':
        case 'ol':
          text += `${extractTextWithNewlines($, $child)}\n`;
          break;
        case 'li': {
          const parent = $child.parent();
          const prefix = parent.is('ol') ? '1.' : '-';
          text += `${prefix} ${extractTextWithNewlines($, $child)}\n`;
          break;
        }
        case 'a': {
          const href = $child.attr('href') || '#';
          const linkText = extractTextWithNewlines($, $child);
          text += `[${linkText}](${href})`;
          break;
        }
        default:
          text += extractTextWithNewlines($, $child);
          break;
      }
    } else if (child.type === 'text') {
      text += child.data || '';
    }
  });

  return text;
}

function extractWechatContent(html, url, imageUrls = []) {
  const $ = cheerio.load(html);
  const title = $(WECHAT_TITLE_SELECTOR).text().trim() || '未找到标题';
  const description = $('meta[name="description"]').attr('content') || '未找到概述';
  const coverUrl = $('meta[property="og:image"]').attr('content') || '';
  const author = $('meta[name="author"]').attr('content') || '未找到作者';

  let content = '未找到正文内容';
  const contentDiv = $('.rich_media_content');
  if (contentDiv.length > 0) {
    content = extractTextWithNewlines($, contentDiv).replace(/\n\n+/g, '\n\n').trim();
  }

  return {
    title,
    cover_url: coverUrl,
    description,
    author,
    content,
    image_urls: Array.isArray(imageUrls) ? imageUrls : [],
    source_url: url,
  };
}

async function scrapeWechatArticle(browser, url, options = {}) {
  assertWechatUrl(url);

  let tabId = null;
  let shouldClose = false;
  const debugState = createDebugState();

  try {
    recordStep(debugState, 'open_tab_started', { url });
    const opened = await openOrReuseTab(browser, url);
    tabId = opened.tabId;
    shouldClose = !opened.isReused;
    recordStep(debugState, 'open_tab_completed', opened);

    if (!opened.isReused) {
      await waitForDocumentReady(browser, tabId);
    }
    await waitForWechatContent(browser, tabId);
    recordStep(debugState, 'content_ready', { tabId });
    await prepareWechatPage(browser, tabId);
    recordStep(debugState, 'page_prepared', { tabId });
    recordDomStat(debugState, 'before_capture', await getWechatDomStats(browser, tabId));

    const [html, imageUrls] = await Promise.all([
      browser.getTabHtml(tabId),
      extractWechatImages(browser, tabId),
    ]);
    recordStep(debugState, 'html_captured', {
      htmlLength: html.length,
      imageCount: imageUrls.length,
    });

    return {
      platform: 'wechat',
      sourceUrl: url,
      timestamp: new Date().toISOString(),
      data: extractWechatContent(html, url, imageUrls),
      metrics: {
        htmlLength: html.length,
        imageCount: imageUrls.length,
      },
      debug: {
        steps: debugState.steps,
        domStats: debugState.domStats,
        rawHtml: options.runContext?.recording?.saveRawHtml ? html : undefined,
      },
    };
  } catch (error) {
    recordStep(debugState, 'scrape_failed', { message: error.message });
    error.debug = {
      steps: debugState.steps,
      domStats: debugState.domStats,
    };
    throw error;
  } finally {
    if (tabId && shouldClose) {
      try {
        await browser.closeTab(tabId);
      } catch (_) {}
    }
  }
}

module.exports = {
  extractWechatContent,
  scrapeWechatArticle,
};
