'use strict';

const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { getPost } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const {
  retryWithBackoff, generateTimestamp, saveToFile, waitForPageLoad, createSafeExecuteScript,
  printSummary, acquireXTab, releaseXTab, loadGraphQLCache, saveGraphQLCache, clearGraphQLCache,
} = require('../lib/xUtils');
const { buildDiscoverTweetQueryIdsScript, buildTweetDetailScript, buildTweetDetailCursorScript, buildTweetByRestIdScript } = require('../graphql/tweet-detail');
const { buildPostDomScript } = require('../dom/post-read');
const { parseArgs, emitResultPayload, extractTweetId, checkForVerificationPage, printUsage } = require('../commands/post-options');
const {
  postReplyViaIntent, postReplyViaDom, postReplyViaMutation, postNewTweetViaMutation,
  setComposerImage, postNewTweetViaDom, postQuoteTweetViaDom, getFirstTweetIdFromPage,
  tryOfficialApiWrite,
} = require('./post-write');

async function main() {
    const options = parseArgs();

    const hasPost = options.post != null && String(options.post).trim() !== '';
    const hasThread = options.thread && options.thread.length > 0;
    const hasQuote = options.quote != null && String(options.quote).trim() !== '';

    if (hasQuote && !hasPost) {
        console.error('错误: --quote 必须与 --post 搭配使用（--post 提供引用评论文本）');
        printUsage();
        process.exit(1);
    }

    if (options.tweetInputs.length === 0 && !hasPost && !hasThread) {
        console.error('错误: 请提供至少一个推文 URL/ID 或 --post/--thread');
        printUsage();
        process.exit(1);
    }

    if (hasPost && hasThread) {
        console.error('错误: --post 与 --thread 互斥，请只使用其一');
        printUsage();
        process.exit(1);
    }
    if ((hasPost || hasThread) && options.tweetInputs.length > 0) {
        console.error('错误: 发新帖/串推模式不能同时提供推文 URL 或 ID');
        printUsage();
        process.exit(1);
    }
    if ((hasPost || hasThread) && options.reply != null && String(options.reply).trim() !== '') {
        console.error('错误: 发新帖/串推模式不能与 --reply 同时使用');
        printUsage();
        process.exit(1);
    }
    if (hasQuote && (hasThread || options.reply != null && String(options.reply).trim() !== '')) {
        console.error('错误: --quote 与 --reply、--thread 互斥');
        printUsage();
        process.exit(1);
    }

    const isReplyMode = options.reply != null && String(options.reply).trim() !== '';
    if (isReplyMode && options.tweetInputs.length > 1) {
        console.error('错误: 回复模式仅支持单条推文，请只提供一个 URL 或 ID');
        printUsage();
        process.exit(1);
    }

    const tweetIds = [];
    if (options.tweetInputs.length > 0) {
        for (const input of options.tweetInputs) {
            const id = extractTweetId(input);
            if (!id) {
                console.error(`错误: 无法解析推文 ID: "${input}"`);
                process.exit(1);
            }
            tweetIds.push(id);
        }
    }

    let quoteTweetId = null;
    if (hasQuote) {
        quoteTweetId = extractTweetId(options.quote);
        if (!quoteTweetId) {
            console.error(`错误: 无法解析 --quote 的推文 ID: "${options.quote}"`);
            process.exit(1);
        }
    }

    if (hasThread && options.thread.length > options.threadMax) {
        console.error(`错误: 串推条数 ${options.thread.length} 超过 --thread-max ${options.threadMax}`);
        printUsage();
        process.exit(1);
    }

    const isPostMode = hasPost || hasThread;
    const isWriteMode = isPostMode || isReplyMode;

    if (isWriteMode && !options.dryRun) {
        const officialAttempt = await tryOfficialApiWrite(options, {
            isReplyMode,
            replyTweetId: tweetIds[0],
            hasPost,
            hasThread,
            hasQuote,
            quoteTweetId,
        });
        if (officialAttempt.success) {
            const commandName = isReplyMode ? 'post reply' : hasQuote ? 'post quote' : hasPost ? 'post new' : 'post thread';
            console.log(`[官方 API] ${commandName} 成功`);
            await emitResultPayload(options, commandName, officialAttempt.result);
            return;
        }
        if (officialAttempt.attempted && options.via === 'api') {
            const commandName = isReplyMode ? 'post reply' : hasQuote ? 'post quote' : hasPost ? 'post new' : 'post thread';
            console.error(`[官方 API] ${commandName} 失败: ${officialAttempt.result?.error || '未知错误'}`);
            await emitResultPayload(options, commandName, officialAttempt.result || {
                success: false,
                error: 'official api failed',
                via: 'official_api',
            });
            return;
        }
        if (officialAttempt.attempted) {
            console.warn(`[官方 API] 失败，回退到 DOM/GraphQL: ${officialAttempt.result?.error || '未知错误'}`);
        }
    }

    let outputPath = options.output;
    let outputDir;
    if (!isPostMode) {
        if (!outputPath) {
            const timestamp = generateTimestamp();
            const dirName = tweetIds.length === 1
                ? `${tweetIds[0]}_${timestamp}`
                : `batch_${timestamp}`;
            outputDir = path.join(process.cwd(), 'work_dir', 'scrape', 'x_com_post', dirName);
            outputPath = path.join(outputDir, 'data.json');
        } else {
            if (!path.isAbsolute(outputPath)) {
                outputPath = path.join(process.cwd(), 'work_dir', 'scrape', 'x_com_post', outputPath);
            }
            outputDir = path.dirname(outputPath);
        }
    }

    console.log('='.repeat(60));
    console.log('X.com 帖子详情与发布工具');
    console.log('='.repeat(60));
    if (isPostMode) {
    if (hasQuote) {
        console.log('模式: Quote Tweet');
        console.log(`引用: https://x.com/i/status/${quoteTweetId}`);
        console.log(`内容: ${options.dryRun ? '(dry-run 不发送) ' : ''}"${String(options.post).slice(0, 60)}${String(options.post).length > 60 ? '...' : ''}"`);
    } else if (hasPost) {
        console.log('模式: 发新帖（单条）');
        console.log(`内容: ${options.dryRun ? '(dry-run 不发送) ' : ''}"${String(options.post).slice(0, 60)}${String(options.post).length > 60 ? '...' : ''}"`);
        if (options.image) console.log('附带图片: ' + options.image);
    } else {
        console.log('模式: 串推（thread）');
        console.log(`条数: ${options.thread.length}`);
        options.thread.forEach((seg, i) => {
            console.log(`  ${i + 1}. ${String(seg).slice(0, 50)}${String(seg).length > 50 ? '...' : ''}`);
        });
        console.log(`段间延迟: ${options.threadDelay} ms`);
        if (options.image) console.log('第1条附带图片: ' + options.image);
        }
    } else {
        console.log(`推文数量: ${tweetIds.length}`);
        tweetIds.forEach((id, i) => {
            console.log(`  ${i + 1}. https://x.com/i/status/${id}`);
        });
        if (options.withThread) console.log('包含对话线程: 是');
        if (options.withReplies > 0) console.log(`包含回复数: ${options.withReplies}`);
        if (isReplyMode) {
            console.log('回复模式: 是');
            console.log('回复方式: ' + (options.replyStyle === 'reply' ? 'Replying to @xxx' : 'Thread（推文下点击回复）'));
            console.log(`回复内容: ${options.dryRun ? '(dry-run 不发送) ' : ''}"${String(options.reply).slice(0, 50)}${String(options.reply).length > 50 ? '...' : ''}"`);
        }
    }
    console.log(`关闭 Tab: ${options.closeTab ? '是' : '否（保留复用）'}`);
    if (!isPostMode) console.log(`输出文件: ${outputPath}`);
    console.log('='.repeat(60));

    const runtimeConfig = resolveRuntimeConfig({
        browserServer: options.browserServer,
        recording: {
            ...(options.recordingMode ? { mode: options.recordingMode } : {}),
            ...(options.recordingBaseDir ? { baseDir: options.recordingBaseDir } : {}),
        },
    });
    options.browserServer = runtimeConfig.serverUrl;

    const browser = new BrowserAutomation(options.browserServer);

    try {
        if (isPostMode) {
            const homeUrl = 'https://x.com/home';
            console.log('\n[发帖] 获取标签页并打开首页...');
            const tabResult = await acquireXTab(browser, homeUrl);
            const tabId = tabResult.tabId;
            try {
                if (!tabResult.isReused || tabResult.navigated) {
                    try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
                }
                await new Promise(r => setTimeout(r, 3500));
                const safeExecuteScript = createSafeExecuteScript(browser);

                // Anti-bot verification page detection
                const verifyCheck = await checkForVerificationPage(browser, tabId, safeExecuteScript);
                if (verifyCheck.blocked) {
                    console.error('[发帖] 检测到验证页: ' + verifyCheck.reason);
                    await emitResultPayload(options, hasQuote ? 'post quote' : hasPost ? 'post new' : 'post thread', { success: false, error: verifyCheck.reason });
                    return;
                }

                if (options.dryRun) {
                    if (hasQuote) {
                        console.log('--dry-run: 将发送 Quote Tweet:');
                        console.log('  引用: https://x.com/i/status/' + quoteTweetId);
                        console.log('  内容: ' + String(options.post));
                    } else if (hasPost) {
                        console.log('--dry-run: 将发送新帖，内容为:');
                        console.log('  ' + String(options.post));
                    } else {
                        console.log('--dry-run: 将发送串推，共 ' + options.thread.length + ' 条:');
                        options.thread.forEach((seg, i) => console.log('  ' + (i + 1) + '. ' + seg));
                    }
                    console.log('(未实际发送)');
                    await emitResultPayload(options, hasQuote ? 'post quote' : hasPost ? 'post new' : 'post thread', {
                        success: true,
                        dryRun: true,
                        quoteTweetId: hasQuote ? quoteTweetId : '',
                        tweetId: '',
                        postedIds: [],
                        error: '',
                    });
                } else if (hasQuote) {
                    // Quote Tweet: --dom-only 时直接 DOM，否则 GraphQL 优先 → DOM fallback
                    const quoteUrl = options.quote && options.quote.startsWith('http') && !options.quote.includes('/i/status/')
                        ? options.quote
                        : 'https://x.com/i/status/' + quoteTweetId;
                    console.log('[Quote Tweet] 引用: ' + quoteUrl + (options.domOnly ? ' (DOM-only)' : ''));

                    let graphqlError = '';
                    let qtResult = null;

                    if (!options.domOnly) {
                        qtResult = await postNewTweetViaMutation(browser, tabId, options.post, safeExecuteScript, quoteUrl);
                        if (!qtResult?.success) {
                            graphqlError = qtResult?.error || '未知';
                            console.log('[Quote Tweet] GraphQL 失败 (' + graphqlError + ')，回退到 DOM...');
                        }
                    }

                    if (!qtResult?.success) {
                        qtResult = await postQuoteTweetViaDom(browser, tabId, quoteTweetId, options.post, safeExecuteScript);
                    }

                    if (qtResult.success) {
                        console.log('Quote Tweet 已发送' + (qtResult.tweetId ? '，ID: ' + qtResult.tweetId : ''));
                    } else {
                        console.error('Quote Tweet 失败:', qtResult.error || '未知错误');
                    }
                    const resultPayload = {
                        success: !!qtResult.success,
                        quoteTweetId: qtResult.tweetId || '',
                        error: qtResult.error || '',
                        graphqlError: graphqlError,
                    };
                    if (qtResult._debug) resultPayload._debug = qtResult._debug;
                    await emitResultPayload(options, 'post quote', resultPayload);
                } else if (hasPost) {
                    if (options.image) {
                        const imagePath = path.isAbsolute(options.image) ? options.image : path.join(process.cwd(), options.image);
                        const imgResult = await setComposerImage(browser, tabId, imagePath, safeExecuteScript);
                        if (!imgResult.success) {
                            console.error('添加图片失败:', imgResult.error || '未知');
                        } else {
                            if (imgResult.b64Len != null && imgResult.blobSize != null) {
                                console.log('已添加图片 (base64 长度:', imgResult.b64Len, ', blob 大小:', imgResult.blobSize, ')，正在填写正文并发送...');
                            } else {
                                console.log('已添加图片，正在填写正文并发送...');
                            }
                        }
                        await new Promise(r => setTimeout(r, 1500));
                    }
                    const result = await postNewTweetViaDom(browser, tabId, options.post, safeExecuteScript);
                    if (result.success) {
                        console.log('新帖已发送' + (result.tweetId ? '，ID: ' + result.tweetId : ''));
                    } else {
                        console.error('发新帖失败:', result.error || '未知错误');
                    }
                    await emitResultPayload(options, 'post new', {
                        success: !!result.success,
                        tweetId: result.tweetId || '',
                        error: result.error || '',
                    });
                } else {
                    const postedIds = [];
                    let lastId = null;
                    const delayMs = Math.max(2000, options.threadDelay);
                    for (let i = 0; i < options.thread.length; i++) {
                        if (i > 0) {
                            console.log(`  等待 ${delayMs / 1000} 秒间隔...`);
                            await new Promise(r => setTimeout(r, delayMs));
                        }
                        const text = options.thread[i];
                        let result;
                        if (i === 0) {
                            if (options.image) {
                                const imagePath = path.isAbsolute(options.image) ? options.image : path.join(process.cwd(), options.image);
                                const imgResult = await setComposerImage(browser, tabId, imagePath, safeExecuteScript);
                                if (!imgResult.success) {
                                    console.error('添加图片失败:', imgResult.error || '未知');
                                } else {
                                    if (imgResult.b64Len != null && imgResult.blobSize != null) {
                                        console.log('  已添加图片 (base64 长度:', imgResult.b64Len, ', blob 大小:', imgResult.blobSize, ')，正在填写第1条并发送...');
                                    } else {
                                        console.log('  已添加图片，正在填写第1条并发送...');
                                    }
                                }
                                await new Promise(r => setTimeout(r, 1500));
                            }
                            result = await postNewTweetViaDom(browser, tabId, text, safeExecuteScript);
                            if (result.success) {
                                console.log(`  等待 ${delayMs / 1000} 秒间隔...`);
                                await new Promise(r => setTimeout(r, delayMs));
                                const idResult = await getFirstTweetIdFromPage(tabId, safeExecuteScript, text);
                                if (idResult?.success && idResult.tweetId) {
                                    lastId = idResult.tweetId;
                                    postedIds.push(lastId);
                                }
                            }
                        } else {
                            await browser.openUrl('https://x.com/i/status/' + lastId, tabId);
                            await new Promise(r => setTimeout(r, 5000));
                            result = await postReplyViaDom(browser, tabId, lastId, text, safeExecuteScript);
                            if (result.success && result.tweetId) {
                                lastId = result.tweetId;
                                postedIds.push(lastId);
                            }
                        }
                        if (result && result.success) {
                            console.log(`  [${i + 1}/${options.thread.length}] 已发送`);
                        } else if (result && !result.success) {
                            console.error(`  [${i + 1}/${options.thread.length}] 失败: ${result.error || '未知错误'}`);
                            break;
                        }
                        if (i === 0 && result && result.success && !lastId) {
                            console.log('  [1/' + options.thread.length + '] 已发送（未取得 ID，后续条数无法继续）');
                            break;
                        }
                    }
                    if (postedIds.length > 0) {
                        console.log('串推已发送 ' + postedIds.length + ' 条，ID: ' + postedIds.join(', '));
                    }
                    await emitResultPayload(options, 'post thread', {
                        success: postedIds.length > 0 && postedIds.length === options.thread.length,
                        postedIds,
                        error: postedIds.length === options.thread.length ? '' : 'thread_incomplete',
                    });
                }
            } finally {
                await releaseXTab(browser, tabId, !options.closeTab);
            }
        } else {
            const result = await getPost(browser, tweetIds, {
                ...options,
                logger: console,
                recording: runtimeConfig.recording,
            });

            const output = options.pretty
                ? JSON.stringify(result, null, 2)
                : JSON.stringify(result);
            await saveToFile(outputPath, output);

            const successResults = result.results.filter(r => r.success);
            const failedResults = result.results.filter(r => !r.success);

            console.log('\n' + '='.repeat(60));
            console.log('抓取完成');
            console.log('='.repeat(60));
            console.log(`成功: ${successResults.length} / ${result.totalRequested}`);
            if (failedResults.length > 0) {
                console.log(`失败: ${failedResults.length}`);
                failedResults.forEach(r => console.log(`  - ${r.tweetId}: ${r.error}`));
            }
            if (successResults.length > 0) {
                const totalLikes = successResults.reduce((sum, t) => sum + (t.stats?.likes || 0), 0);
                const totalRetweets = successResults.reduce((sum, t) => sum + (t.stats?.retweets || 0), 0);
                const totalViews = successResults.reduce((sum, t) => sum + (t.stats?.views || 0), 0);
                const totalMedia = successResults.reduce((sum, t) => sum + (t.mediaUrls?.length || 0), 0);
                console.log(`\n总点赞: ${totalLikes.toLocaleString()}`);
                console.log(`总转发: ${totalRetweets.toLocaleString()}`);
                console.log(`总查看: ${totalViews.toLocaleString()}`);
                if (totalMedia > 0) console.log(`总媒体: ${totalMedia} 个`);
            }
            console.log('='.repeat(60));

            if (isReplyMode) {
                const replyTweetId = tweetIds[0];
                const useIntent = options.replyStyle === 'reply';
                const replyUrl = useIntent
                    ? `https://x.com/intent/tweet?in_reply_to=${replyTweetId}`
                    : `https://x.com/i/status/${replyTweetId}`;
                console.log('\n[回复] ' + (useIntent ? 'Replying to 式' : 'Thread 式') + '，获取标签页并打开...');
                const tabResult = await acquireXTab(browser, replyUrl);
                const tabId = tabResult.tabId;
                try {
                    if (!tabResult.isReused || tabResult.navigated) {
                        try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
                    }
                    await new Promise(r => setTimeout(r, useIntent ? 3500 : 4000));
                    if (options.dryRun) {
                        console.log('--dry-run: 将对该推文发送回复，内容为:');
                        console.log('  ' + String(options.reply));
                        console.log('(未实际发送)');
                        await emitResultPayload(options, 'post reply', {
                            success: true,
                            dryRun: true,
                            replyTweetId: '',
                            error: '',
                            graphqlError: '',
                        });
                    } else {
                        const safeExecuteScript = createSafeExecuteScript(browser);

                        // Anti-bot verification page detection
                        const verifyCheck = await checkForVerificationPage(browser, tabId, safeExecuteScript);
                        if (verifyCheck.blocked) {
                            console.error('[回复] 检测到验证页: ' + verifyCheck.reason);
                            await emitResultPayload(options, 'post reply', { success: false, replyTweetId: '', error: verifyCheck.reason, graphqlError: '' });
                            return;
                        }

                        let graphqlError = '';
                        let replyResult = null;

                        if (!options.domOnly) {
                            replyResult = await postReplyViaMutation(browser, tabId, replyTweetId, options.reply, safeExecuteScript);
                            if (!replyResult?.success) {
                                graphqlError = replyResult?.error || '未知';
                                console.log('[回复] GraphQL 失败 (' + graphqlError + ')，回退到 DOM...');
                            }
                        }

                        if (!replyResult?.success) {
                            replyResult = useIntent
                                ? await postReplyViaIntent(browser, tabId, options.reply, safeExecuteScript)
                                : await postReplyViaDom(browser, tabId, replyTweetId, options.reply, safeExecuteScript);
                        }
                        if (replyResult.success) {
                            console.log('回复已发送' + (replyResult.tweetId ? '，ID: ' + replyResult.tweetId : ''));
                        } else {
                            console.error('回复失败:', replyResult.error || '未知错误');
                        }
                        const replyPayload = {
                            success: !!replyResult.success,
                            replyTweetId: replyResult.tweetId || '',
                            error: replyResult.error || '',
                            graphqlError: graphqlError,
                        };
                        if (replyResult._debug) replyPayload._debug = replyResult._debug;
                        await emitResultPayload(options, 'post reply', replyPayload);
                    }
                } finally {
                    await releaseXTab(browser, tabId, !options.closeTab);
                }
            }
        }

        browser.disconnect();

    } catch (error) {
        console.error('\n✗ 抓取失败:');
        console.error(error.message);
        if (error.stack) {
            console.error('\n堆栈跟踪:');
            console.error(error.stack);
        }
        browser.disconnect();
        process.exit(1);
    }
}

module.exports = { main };
