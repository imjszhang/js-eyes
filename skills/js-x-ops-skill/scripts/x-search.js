#!/usr/bin/env node

/**
 * X.com (Twitter) 搜索脚本
 * 使用 GraphQL API 优先 + 浏览器 DOM 提取兜底的混合方式搜索 X 平台内容
 * 
 * 使用方法:
 *   node scripts/x-search.js "搜索关键词" [options]
 * 
 * 选项:
 *   --max-pages <number>       最多抓取页数（默认1，每页约20条）
 *   --sort <type>              排序方式: top(默认) / latest / media
 *   --pretty                   美化 JSON 输出
 *   --browser-server <url>     JS-Eyes WebSocket 服务器地址（默认 ws://localhost:18080）
 *   --output <file>            指定输出文件路径
 *   --min-likes <number>       过滤最小点赞数（默认0）
 *   --min-retweets <number>    过滤最小转发数（默认0）
 *   --min-replies <number>     过滤最小回复数（默认0）
 *   --lang <code>              搜索语言（如 zh, en）
 *   --from <user>              指定作者（不带@）
 *   --to <user>                发给某用户的推文
 *   --since <date>             起始日期（YYYY-MM-DD）
 *   --until <date>             截止日期（YYYY-MM-DD）
 *   --exclude-replies          排除回复
 *   --exclude-retweets         排除转推
 *   --has-links                仅含链接的推文
 *   --resume <dir>             从中断的搜索目录恢复继续
 * 
 * 文件保存位置:
 *   work_dir/scrape/x_com_search/{keyword}_{timestamp}/data.json
 * 
 * 示例:
 *   node scripts/x-search.js "AI agent"
 *   node scripts/x-search.js "AI agent" --sort latest --max-pages 3
 *   node scripts/x-search.js "AI agent" --min-likes 100 --pretty
 *   node scripts/x-search.js "机器学习" --lang zh --sort latest
 *   node scripts/x-search.js "AI" --from elonmusk --since 2025-01-01
 *   node scripts/x-search.js "AI" --exclude-replies --exclude-retweets --has-links
 *   node scripts/x-search.js --resume work_dir/scrape/x_com_search/AI_2025-01-01T12-00-00
 * 
 * 注意:
 *   - 需要 JS-Eyes Server 运行中，且浏览器已安装 JS-Eyes 扩展并登录 X.com
 *   - X.com 搜索需要登录状态
 */

// v3.0：READ 主流程 / CLI 入口已被 cli/index.js + lib/api.js 替代；本文件仅保留 helper exports（lib/api.js fallback 用）。

const { BrowserAutomation } = require('../lib/js-eyes-client');
const path = require('path');
const { searchTweets } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const {
    DEFAULT_GRAPHQL_FEATURES,
    BEARER_TOKEN,
    buildTweetParserSnippet,
    buildGraphQLTweetParserSnippet,
    retryWithBackoff,
    saveProgress,
    loadProgress,
    appendPartialTweets,
    loadPartialTweets,
    cleanupTempFiles,
    ensureDirectoryExists,
    generateTimestamp,
    saveToFile,
    waitForPageLoad,
    createSafeExecuteScript,
    printSummary,
    acquireXTab,
    releaseXTab,
    loadGraphQLCache,
    saveGraphQLCache,
    clearGraphQLCache
} = require('../lib/xUtils');

/** 硬编码的 fallback queryId（仅在动态发现失败时使用） */
const FALLBACK_QUERY_ID = 'MJnbGMELgGmSiYRHVBRKjg';

/**
 * 是否启用 GraphQL API 搜索。
 * 目前 SearchTimeline GraphQL API 返回 404（可能是 X.com 接口迁移），
 * 暂时停用，直接使用 DOM 提取方式。
 * 设为 true 可恢复 GraphQL 优先策略。
 */
const ENABLE_GRAPHQL_SEARCH = false;

// ============================================================================
// CLI 参数解析
// ============================================================================


// ============================================================================
// 查询操作符构建
// ============================================================================

/**
 * 将 options 中的高级搜索选项构建为 X 搜索操作符字符串
 * @param {Object} options - 搜索选项
 * @returns {string} 操作符字符串（不含关键词本身）
 */
function buildQueryOperators(options) {
    const operators = [];

    if (options.from) operators.push(`from:${options.from}`);
    if (options.to) operators.push(`to:${options.to}`);
    if (options.since) operators.push(`since:${options.since}`);
    if (options.until) operators.push(`until:${options.until}`);
    if (options.lang) operators.push(`lang:${options.lang}`);
    if (options.minLikes > 0) operators.push(`min_faves:${options.minLikes}`);
    if (options.minRetweets > 0) operators.push(`min_retweets:${options.minRetweets}`);
    if (options.minReplies > 0) operators.push(`min_replies:${options.minReplies}`);
    if (options.excludeReplies) operators.push('-filter:replies');
    if (options.excludeRetweets) operators.push('-filter:retweets');
    if (options.hasLinks) operators.push('filter:links');

    return operators.join(' ');
}

/**
 * 构建完整的查询字符串（关键词 + 操作符）
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @returns {string} 完整查询字符串
 */
function buildFullQuery(keyword, options) {
    const operators = buildQueryOperators(options);
    return operators ? `${keyword} ${operators}` : keyword;
}

// ============================================================================
// URL 构建
// ============================================================================

/**
 * 构建 X.com 搜索 URL
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @returns {string} 搜索 URL
 */
function buildSearchUrl(keyword, options) {
    const params = new URLSearchParams();

    const query = buildFullQuery(keyword, options);
    params.set('q', query);
    params.set('src', 'typed_query');
    
    // 排序/筛选类型
    const sortMap = {
        'top': '',           // 默认不设 f 参数 = 热门
        'latest': 'live',
        'media': 'image'
    };
    
    const sortValue = sortMap[options.sort];
    if (sortValue) {
        params.set('f', sortValue);
    }
    
    return `https://x.com/search?${params.toString()}`;
}

/**
 * 将 sort 选项映射为 GraphQL API 的 product 参数
 */
function sortToProduct(sort) {
    const map = {
        'top': 'Top',
        'latest': 'Latest',
        'media': 'Media'
    };
    return map[sort] || 'Top';
}

// ============================================================================
// 浏览器内执行的 DOM 提取脚本（搜索专用，使用 xUtils 中的 buildTweetParserSnippet）
// ============================================================================

/**
 * 生成在浏览器上下文中执行的推文提取脚本
 * 返回一段 JS 代码字符串，执行后返回推文数组
 */
function buildDomExtractionScript() {
    return `
    (() => {
        ${buildTweetParserSnippet()}
        
        const tweets = [];
        const seenIds = new Set();
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        
        articles.forEach(article => {
            try {
                const tweet = parseTweetArticle(article);
                if (tweet && !seenIds.has(tweet.tweetId)) {
                    seenIds.add(tweet.tweetId);
                    tweets.push(tweet);
                }
            } catch (e) {
                // 跳过解析失败的推文
            }
        });
        
        return tweets;
    })();
    `;
}

// ============================================================================
// 浏览器内执行的 GraphQL 参数发现脚本
// ============================================================================

/**
 * 生成动态发现 GraphQL queryId 和 features 的浏览器端脚本
 * 
 * 发现策略：
 * 1. 从 performance.getEntriesByType('resource') 匹配已有的 SearchTimeline 请求
 * 2. 从匹配到的 URL 中解析 queryId 和 features
 * 3. 如果 performance API 未捕获到，尝试从页面 JS bundle 中搜索 queryId
 * 
 * @returns {string} JS 代码字符串
 */
function buildDiscoverGraphQLParamsScript() {
    return `
    (async () => {
        try {
            const result = { queryId: null, features: null, variables: null };
            
            // 从 URL 中提取 queryId、features 和 variables
            const parseGraphQLUrl = (urlStr) => {
                const parsed = {};
                try {
                    const url = new URL(urlStr);
                    const fp = url.searchParams.get('features');
                    if (fp) parsed.features = JSON.parse(fp);
                    const vp = url.searchParams.get('variables');
                    if (vp) parsed.variables = JSON.parse(vp);
                } catch (e) {}
                return parsed;
            };
            
            // 策略 1: 从 performance API 中匹配 SearchTimeline 请求
            // 取最后一条匹配（最新的请求最可能有当前有效的 queryId）
            try {
                const resources = performance.getEntriesByType('resource');
                for (let i = resources.length - 1; i >= 0; i--) {
                    const r = resources[i];
                    const pathMatch = r.name.match(/graphql\\/([A-Za-z0-9_-]+)\\/SearchTimeline/);
                    if (pathMatch) {
                        result.queryId = pathMatch[1];
                        const parsed = parseGraphQLUrl(r.name);
                        if (parsed.features) result.features = parsed.features;
                        if (parsed.variables) result.variables = parsed.variables;
                        break;
                    }
                }
            } catch (e) {}
            
            // 策略 2: 如果未找到 queryId，尝试从 JS bundle 中搜索
            if (!result.queryId) {
                try {
                    const scripts = document.querySelectorAll('script[src]');
                    const bundleUrls = [];
                    for (const script of scripts) {
                        const src = script.getAttribute('src') || '';
                        if (src.includes('/client-web/') || src.includes('main.')) {
                            bundleUrls.push(src.startsWith('http') ? src : 'https://x.com' + src);
                        }
                    }
                    
                    // 只检查前 5 个 bundle，避免过多请求
                    for (const bundleUrl of bundleUrls.slice(0, 5)) {
                        try {
                            const resp = await fetch(bundleUrl);
                            if (!resp.ok) continue;
                            const text = await resp.text();
                            
                            const match = text.match(/queryId:"([A-Za-z0-9_-]+)",operationName:"SearchTimeline"/);
                            if (match) {
                                result.queryId = match[1];
                                break;
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }
            
            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

// ============================================================================
// 浏览器内执行的 GraphQL 搜索脚本
// ============================================================================

/**
 * 生成 GraphQL SearchTimeline API 调用脚本
 * 在浏览器上下文中执行，利用已有的认证会话
 * 
 * @param {string} keyword - 搜索关键词（含高级操作符）
 * @param {string} product - 搜索类型: Top / Latest / Media
 * @param {string} cursor - 分页游标（首页为空）
 * @param {Object} [graphqlParams] - 动态发现的 GraphQL 参数
 * @param {string} [graphqlParams.queryId] - 动态发现的 queryId
 * @param {Object} [graphqlParams.features] - 动态发现的 features
 * @returns {string} JS 代码字符串
 */
function buildGraphQLSearchScript(keyword, product, cursor, graphqlParams = {}) {
    // 转义关键词中的特殊字符，防止注入
    const safeKeyword = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const safeCursor = (cursor || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    // 使用动态发现的参数或 fallback
    const queryIdToUse = graphqlParams.queryId || FALLBACK_QUERY_ID;
    const featuresToUse = graphqlParams.features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);
    // 使用捕获的 variables 模板，或 null
    const variablesTemplateLiteral = graphqlParams.variables ? JSON.stringify(graphqlParams.variables) : 'null';
    
    // 每次生成唯一 nonce，防止 WebSocket 服务端请求去重
    const nonce = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    
    return `
    (async () => {
        try {
            const _nonce = '${nonce}'; // 唯一标识，防止请求去重
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }
            
            ${buildGraphQLTweetParserSnippet()}
            
            const queryId = '${queryIdToUse}';
            
            // 优先使用从实际请求捕获的 variables 模板
            const capturedTemplate = ${variablesTemplateLiteral};
            let variables;
            if (capturedTemplate) {
                variables = { ...capturedTemplate };
                // 覆盖关键字段
                variables.rawQuery = '${safeKeyword}';
                variables.product = '${product}';
                delete variables.cursor;
            } else {
                // 回退：尝试从当前页面的 performance API 获取实际 variables
                let liveVariables = null;
                try {
                    const resources = performance.getEntriesByType('resource');
                    for (const r of resources) {
                        if (r.name.includes('/SearchTimeline')) {
                            const url = new URL(r.name);
                            const vp = url.searchParams.get('variables');
                            if (vp) {
                                liveVariables = JSON.parse(vp);
                                break;
                            }
                        }
                    }
                } catch (e) {}
                
                if (liveVariables) {
                    variables = { ...liveVariables };
                    variables.rawQuery = '${safeKeyword}';
                    variables.product = '${product}';
                    delete variables.cursor;
                } else {
                    variables = {
                        rawQuery: '${safeKeyword}',
                        count: 20,
                        querySource: 'typed_query',
                        product: '${product}'
                    };
                }
            }
            
            ${safeCursor ? `variables.cursor = '${safeCursor}';` : ''}
            
            const features = ${featuresLiteral};
            
            const apiUrl = 'https://x.com/i/api/graphql/' + queryId + '/SearchTimeline?' +
                'variables=' + encodeURIComponent(JSON.stringify(variables)) +
                '&features=' + encodeURIComponent(JSON.stringify(features));
            
            // 发送请求
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            let response;
            try {
                response = await fetch(apiUrl, {
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    }
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    return { success: false, error: 'GraphQL 请求超时' };
                }
                return { success: false, error: fetchError.message };
            }
            
            if (!response.ok) {
                const retryAfter = response.headers.get('retry-after') || null;
                let errorDetail = '';
                try { errorDetail = await response.text(); errorDetail = errorDetail.substring(0, 300); } catch(e) {}
                return { 
                    success: false, 
                    error: 'HTTP ' + response.status + (errorDetail ? ': ' + errorDetail : ''),
                    statusCode: response.status,
                    retryAfter: retryAfter ? parseInt(retryAfter, 10) : null
                };
            }
            
            const data = await response.json();
            
            try {
                const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
                
                let allEntries = [];
                for (const instruction of instructions) {
                    if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                        allEntries = allEntries.concat(instruction.entries);
                    }
                }
                
                const { tweets, nextCursor } = parseTweetEntries(allEntries);
                
                return {
                    success: true,
                    tweets: tweets,
                    nextCursor: nextCursor,
                    queryId: queryId
                };
            } catch (parseError) {
                return { success: false, error: '解析响应失败: ' + parseError.message, raw: JSON.stringify(data).substring(0, 500) };
            }
            
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

/**
 * 生成一体化首页脚本：等待 + 滚动 + DOM 提取，全部在一次 executeScript 中完成。
 * 
 * 设计原因：BrowserAutomation 的 WebSocket 通道存在已知限制——
 * 每个连接只能成功处理一次 execute_script 调用。
 * 因此需要将所有浏览器端操作合并到单次调用中。
 */
function buildFirstPageScript() {
    return `
    (async () => {
        try {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            
            ${buildTweetParserSnippet()}
            
            // ---- 推文提取函数（从当前 DOM 中提取，跳过已见 ID） ----
            const seenIds = new Set();
            const allTweets = [];
            
            const extractCurrentTweets = () => {
                const articles = document.querySelectorAll('article[data-testid="tweet"]');
                let newCount = 0;
                
                articles.forEach(article => {
                    try {
                        const tweet = parseTweetArticle(article);
                        if (tweet && !seenIds.has(tweet.tweetId)) {
                            seenIds.add(tweet.tweetId);
                            allTweets.push(tweet);
                            newCount++;
                        }
                    } catch (e) { /* skip */ }
                });
                
                return newCount;
            };
            
            // ---- Step 1: 等待推文元素出现 ----
            let contentReady = false;
            for (let i = 0; i < 10; i++) {
                const count = document.querySelectorAll('article[data-testid="tweet"]').length;
                if (count > 0) {
                    contentReady = true;
                    break;
                }
                await delay(1000);
            }
            
            if (!contentReady) {
                return { success: false, error: '未检测到推文，可能未登录或页面加载异常', tweets: [] };
            }
            
            // ---- Step 2: 先提取初始视口中的推文 ----
            extractCurrentTweets();
            
            // ---- Step 3: 滚动并增量提取（X.com 使用虚拟列表，需要边滚边采集） ----
            const maxScrollRounds = 5;
            let noNewCount = 0;
            
            for (let i = 0; i < maxScrollRounds; i++) {
                window.scrollTo(0, document.documentElement.scrollHeight);
                await delay(1500);
                
                const newFound = extractCurrentTweets();
                if (newFound === 0) {
                    noNewCount++;
                    // 连续 2 轮无新增则停止
                    if (noNewCount >= 2) break;
                } else {
                    noNewCount = 0;
                }
            }
            
            return { success: true, tweets: allTweets, tweetCount: allTweets.length };
        } catch (e) {
            return { success: false, error: e.message, tweets: [] };
        }
    })();
    `;
}

// retryWithBackoff 已移至 xUtils 模块

// 进度管理（saveProgress, loadProgress, appendPartialTweets, loadPartialTweets, cleanupTempFiles）已移至 xUtils 模块

// 文件工具（ensureDirectoryExists, generateTimestamp, saveToFile）已移至 xUtils 模块

// ============================================================================
// 辅助输出函数
// ============================================================================


// printSummary 已移至 xUtils 模块（支持 title 参数）

// ============================================================================
// 主流程（CLI 入口 — 调用 lib/api.js）
// ============================================================================


// ============================================================================
// 恢复搜索（从中断处继续）
// ============================================================================


module.exports = {
    buildSearchUrl,
    buildFullQuery,
    buildQueryOperators,
    sortToProduct,
    retryWithBackoff,
    buildDiscoverGraphQLParamsScript,
    buildGraphQLSearchScript,
    buildFirstPageScript,
    buildDomExtractionScript,
    FALLBACK_QUERY_ID,
    ENABLE_GRAPHQL_SEARCH
};

