'use strict';

const cheerio = require('cheerio');
const {
  createDebugState,
  recordDomStat,
  recordStep,
} = require('@js-eyes/skill-recording');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertZhihuAnswerUrl(url) {
  if (typeof url !== 'string' || !/zhihu\.com\/question\/\d+\/answer\/\d+/.test(url)) {
    throw new Error(`URL 不属于知乎回答: ${url}`);
  }
}

function assertZhihuArticleUrl(url) {
  if (typeof url !== 'string' || !/zhuanlan\.zhihu\.com\/p\/\d+/.test(url)) {
    throw new Error(`URL 不属于知乎专栏: ${url}`);
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
        hasContent: !!document.querySelector('.RichContent-inner, .Post-RichTextContainer, meta[itemprop="name"]')
      }))()`,
    );
    if (state && (state.readyState === 'complete' || state.readyState === 'interactive') && state.hasContent) {
      return;
    }
    await sleep(700);
  }
}

async function getZhihuDomStats(browser, tabId) {
  return browser.executeScript(
    tabId,
    `(() => ({
      answerBlocks: document.querySelectorAll('.ContentItem.AnswerItem').length,
      articleBlocks: document.querySelectorAll('.Post-RichTextContainer').length,
      richTextBlocks: document.querySelectorAll('.RichContent-inner, .Post-RichTextContainer').length,
      scrollHeight: document.documentElement.scrollHeight,
      title: document.title
    }))()`,
  );
}

function extractZhihuRichText($, element) {
  let text = '';

  element.contents().each((_, child) => {
    const $child = $(child);
    if (child.type === 'tag') {
      const tagName = child.name.toLowerCase();
      switch (tagName) {
        case 'p': {
          const pText = extractZhihuRichText($, $child);
          if (pText.trim()) {
            text += `${pText}\n\n`;
          }
          break;
        }
        case 'b':
        case 'strong':
          text += `**${extractZhihuRichText($, $child)}**`;
          break;
        case 'em':
        case 'i':
          text += `*${extractZhihuRichText($, $child)}*`;
          break;
        case 'a': {
          const href = $child.attr('href') || '#';
          const linkText = extractZhihuRichText($, $child).replace(/\s*$/, '');
          text += `[${linkText}](${href})`;
          break;
        }
        case 'ol':
        case 'ul':
          text += `${extractZhihuRichText($, $child)}\n`;
          break;
        case 'li': {
          const liText = extractZhihuRichText($, $child);
          const prefix = $child.parent().is('ol') ? `${$child.index() + 1}.` : '-';
          text += `${prefix} ${liText}\n`;
          break;
        }
        case 'hr':
          text += '\n---\n\n';
          break;
        case 'div':
          if ($child.hasClass('RichText-LinkCardContainer')) {
            const linkCard = $child.find('.LinkCard');
            const cardTitle = linkCard.find('.LinkCard-title').text().trim();
            const cardDesc = linkCard.find('.LinkCard-desc').text().trim();
            const cardHref = linkCard.attr('href') || '#';
            if (cardTitle) {
              text += `\n[${cardTitle}](${cardHref})\n${cardDesc ? `> ${cardDesc}` : ''}\n\n`;
            }
          } else {
            text += extractZhihuRichText($, $child);
          }
          break;
        case 'span':
          if (!$child.hasClass('ZDI') && !$child.find('svg').length) {
            text += extractZhihuRichText($, $child);
          }
          break;
        case 'svg':
          break;
        default:
          text += extractZhihuRichText($, $child);
          break;
      }
    } else if (child.type === 'text') {
      text += child.data || '';
    }
  });

  return text;
}

function extractZhihuAnswerContent(html, url) {
  const $ = cheerio.load(html);

  let questionTitle = $('meta[itemprop="name"]').attr('content') || $('.QuestionHeader-title').text().trim() || '未找到问题标题';

  let authorName = '未找到作者';
  const contentItem = $('.ContentItem.AnswerItem');
  if (contentItem.length && contentItem.attr('data-zop')) {
    try {
      const dataZop = JSON.parse(contentItem.attr('data-zop'));
      if (dataZop.authorName) {
        authorName = dataZop.authorName;
      }
    } catch (_) {}
  }

  if (authorName === '未找到作者') {
    const authorMeta = $('.AuthorInfo').find('meta[itemprop="name"]').first().attr('content');
    authorName = authorMeta || $('.UserLink-link').first().text().trim() || authorName;
  }

  let answerContent = '未找到回答内容';
  const richContentInner = $('.RichContent-inner');
  if (richContentInner.length) {
    const richTextSpan = richContentInner.find('span.RichText[itemprop="text"]').first();
    answerContent = extractZhihuRichText($, richTextSpan.length ? richTextSpan : richContentInner).trim() || answerContent;
  }

  return {
    title: questionTitle,
    author_name: authorName,
    content: answerContent,
    upvote_count: $('meta[itemprop="upvoteCount"]').attr('content') || '0',
    comment_count: $('meta[itemprop="commentCount"]').attr('content') || '0',
    source_url: url,
  };
}

function extractZhihuArticleContent(html, url) {
  const $ = cheerio.load(html);

  let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || '未找到文章标题';
  if (title.endsWith(' - 知乎')) {
    title = title.slice(0, -5);
  }

  return {
    title,
    author_name: $('.AuthorInfo').find('meta[itemprop="name"]').first().attr('content') || '未找到作者',
    publish_time: $('.ContentItem-time').first().text().trim() || '未找到发布时间',
    content: $('.Post-RichTextContainer').first().text().trim() || '未找到文章内容',
    upvote_count: $('.VoteButton--up').first().text().trim().replace('已赞同', '').trim() || '0',
    comment_count: $('.BottomActions-CommentBtn').first().text().trim().replace('添加评论', '').trim() || '0',
    source_url: url,
  };
}

async function scrapeZhihu(browser, url, extractor, platform, options = {}) {
  let tabId = null;
  let shouldClose = false;
  const debugState = createDebugState();

  try {
    recordStep(debugState, 'open_tab_started', { url, platform });
    const opened = await openOrReuseTab(browser, url);
    tabId = opened.tabId;
    shouldClose = !opened.isReused;
    recordStep(debugState, 'open_tab_completed', opened);

    await waitForReady(browser, tabId);
    recordStep(debugState, 'page_ready', { tabId });
    recordDomStat(debugState, 'before_capture', await getZhihuDomStats(browser, tabId));
    const html = await browser.getTabHtml(tabId);
    recordStep(debugState, 'html_captured', { htmlLength: html.length });

    return {
      platform,
      sourceUrl: url,
      timestamp: new Date().toISOString(),
      data: extractor(html, url),
      metrics: {
        htmlLength: html.length,
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

async function scrapeZhihuAnswer(browser, url, options = {}) {
  assertZhihuAnswerUrl(url);
  return scrapeZhihu(browser, url, extractZhihuAnswerContent, 'zhihu_answer', options);
}

async function scrapeZhihuArticle(browser, url, options = {}) {
  assertZhihuArticleUrl(url);
  return scrapeZhihu(browser, url, extractZhihuArticleContent, 'zhihu_zhuanlan', options);
}

module.exports = {
  extractZhihuAnswerContent,
  extractZhihuArticleContent,
  scrapeZhihuAnswer,
  scrapeZhihuArticle,
};
