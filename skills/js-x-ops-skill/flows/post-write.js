'use strict';

const path = require('path');
const fs = require('fs').promises;
const { createOfficialApiClient } = require('../lib/official-api');
const { buildReplyViaDomScript, buildReplyViaIntentScript, buildNewTweetViaDomScript, buildQuoteTweetViaDomScript, buildGetFirstTweetIdFromPageScript } = require('../dom/post-write');
const { buildDiscoverCreateTweetQueryIdScript, buildCreateReplyScript, buildCreateNewTweetScript } = require('../graphql/tweet-write');
const { buildSetComposerImageChunkScript, buildSetComposerImageApplyScript } = require('../media/composer-image');

const IMAGE_B64_CHUNK_SIZE = 32 * 1024;

async function postReplyViaIntent(browser, tabId, replyText, safeExecuteScript) {
    const script = buildReplyViaIntentScript(replyText);
    const result = await safeExecuteScript(tabId, script, { timeout: 20000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function postReplyViaDom(browser, tabId, tweetId, replyText, safeExecuteScript) {
    const script = buildReplyViaDomScript(tweetId, replyText);
    const result = await safeExecuteScript(tabId, script, { timeout: 15000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function postReplyViaMutation(browser, tabId, tweetId, replyText, safeExecuteScript) {
    const disc = await safeExecuteScript(tabId, buildDiscoverCreateTweetQueryIdScript(), { timeout: 15000 });
    if (!disc?.success || !disc.createTweetQueryId) {
        return { success: false, error: '未发现 CreateTweet queryId' };
    }
    const script = buildCreateReplyScript(tweetId, replyText, disc.createTweetQueryId, disc.features);
    const result = await safeExecuteScript(tabId, script, { timeout: 20000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function postNewTweetViaMutation(browser, tabId, tweetText, safeExecuteScript, attachmentUrl) {
    const disc = await safeExecuteScript(tabId, buildDiscoverCreateTweetQueryIdScript(), { timeout: 15000 });
    if (!disc?.success || !disc.createTweetQueryId) {
        return { success: false, error: '未发现 CreateTweet queryId' };
    }
    const script = buildCreateNewTweetScript(tweetText, disc.createTweetQueryId, disc.features, attachmentUrl);
    const result = await safeExecuteScript(tabId, script, { timeout: 20000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function setComposerImage(browser, tabId, imagePath, safeExecuteScript) {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const name = path.basename(imagePath) || 'image' + ext;
    let base64;
    try {
        const buf = await fs.readFile(imagePath);
        base64 = buf.toString('base64');
    } catch (e) {
        return { success: false, error: '读取图片失败: ' + e.message };
    }
    const chunks = [];
    for (let i = 0; i < base64.length; i += IMAGE_B64_CHUNK_SIZE) {
        chunks.push(base64.slice(i, i + IMAGE_B64_CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
        const chunkScript = buildSetComposerImageChunkScript(chunks[i], i === 0);
        await safeExecuteScript(tabId, chunkScript, { timeout: 10000 });
    }
    const applyScript = buildSetComposerImageApplyScript(mime, name);
    const result = await safeExecuteScript(tabId, applyScript, { timeout: 25000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function postNewTweetViaDom(browser, tabId, tweetText, safeExecuteScript) {
    const script = buildNewTweetViaDomScript(tweetText);
    const result = await safeExecuteScript(tabId, script, { timeout: 25000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function postQuoteTweetViaDom(browser, tabId, quoteTweetId, quoteText, safeExecuteScript) {
    await browser.openUrl('https://x.com/i/status/' + quoteTweetId, tabId);
    await new Promise(r => setTimeout(r, 5000));
    const script = buildQuoteTweetViaDomScript(quoteText);
    const result = await safeExecuteScript(tabId, script, { timeout: 45000 });
    return result || { success: false, error: '脚本未返回结果' };
}

async function getFirstTweetIdFromPage(tabId, safeExecuteScript, matchText) {
    const timeout = matchText ? 28000 : 12000;
    const result = await safeExecuteScript(tabId, buildGetFirstTweetIdFromPageScript(matchText), { timeout });
    return result;
}

async function tryOfficialApiWrite(options, {
    isReplyMode,
    replyTweetId,
    hasPost,
    hasThread,
    hasQuote,
    quoteTweetId,
}) {
    if (options.dryRun || options.domOnly || options.via === 'dom') {
        return { attempted: false, success: false, result: null };
    }

    const client = createOfficialApiClient();
    if (!client.isConfigured) {
        const result = {
            success: false,
            error: 'X API 未配置（缺少环境变量）',
            errorCode: 'api_not_configured',
            via: 'official_api',
        };
        return { attempted: true, success: false, result };
    }

    let result;
    if (isReplyMode) {
        result = await client.createReply(options.reply, replyTweetId);
        result = {
            success: !!result.success,
            replyTweetId: result.tweet_id || '',
            error: result.error || '',
            errorCode: result.errorCode || '',
            status_code: result.status_code || 0,
            detail: result.detail || '',
            via: 'official_api',
        };
    } else if (hasQuote) {
        result = await client.createQuote(options.post, quoteTweetId);
        result = {
            success: !!result.success,
            quoteTweetId: result.tweet_id || '',
            error: result.error || '',
            errorCode: result.errorCode || '',
            status_code: result.status_code || 0,
            detail: result.detail || '',
            via: 'official_api',
        };
    } else if (hasPost) {
        const mediaIds = [];
        if (options.image) {
            const imagePath = path.isAbsolute(options.image) ? options.image : path.join(process.cwd(), options.image);
            const upload = await client.uploadMedia(imagePath);
            if (!upload.success) {
                return {
                    attempted: true,
                    success: false,
                    result: { ...upload, via: 'official_api' },
                };
            }
            mediaIds.push(upload.media_id);
        }
        const posted = await client.createTweet(options.post, mediaIds.length ? mediaIds : undefined);
        result = {
            success: !!posted.success,
            tweetId: posted.tweet_id || '',
            error: posted.error || '',
            errorCode: posted.errorCode || '',
            status_code: posted.status_code || 0,
            detail: posted.detail || '',
            via: 'official_api',
        };
    } else if (hasThread) {
        const tweets = options.thread.map((text, idx) => ({
            text,
            media_paths: idx === 0 && options.image
                ? [path.isAbsolute(options.image) ? options.image : path.join(process.cwd(), options.image)]
                : [],
        }));
        const thread = await client.createThread(tweets);
        result = {
            success: !!thread.success,
            postedIds: thread.tweet_ids || [],
            error: (thread.errors || []).join('; '),
            errorCode: thread.success ? '' : 'official_api_failed',
            via: 'official_api',
        };
    }

    return { attempted: true, success: !!result?.success, result };
}

module.exports = {
  postReplyViaIntent,
  postReplyViaDom,
  postReplyViaMutation,
  postNewTweetViaMutation,
  setComposerImage,
  postNewTweetViaDom,
  postQuoteTweetViaDom,
  getFirstTweetIdFromPage,
  tryOfficialApiWrite,
};
