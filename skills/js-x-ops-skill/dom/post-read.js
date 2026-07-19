'use strict';

const { buildTweetParserSnippet } = require('../lib/xUtils');


function buildPostDomScript(tweetId) {
    return `
    (async () => {
        try {
            const delay = ms => new Promise(r => setTimeout(r, ms));

            ${buildTweetParserSnippet()}

            // 等待推文出现
            let contentReady = false;
            for (let i = 0; i < 15; i++) {
                const count = document.querySelectorAll('article[data-testid="tweet"]').length;
                if (count > 0) {
                    contentReady = true;
                    break;
                }
                await delay(1000);
            }

            if (!contentReady) {
                return { success: false, error: '未检测到推文内容，可能已删除或页面加载异常' };
            }

            // 在详情页中，主推文通常是第一个 article（如果是线程则可能有多个）
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            let focalTweet = null;
            const threadTweets = [];

            for (const article of articles) {
                try {
                    const tweet = parseTweetArticle(article);
                    if (!tweet) continue;

                    if (tweet.tweetId === '${tweetId}') {
                        focalTweet = tweet;
                    } else if (!focalTweet) {
                        // focal tweet 之前的是线程上文
                        threadTweets.push(tweet);
                    }
                } catch (e) { /* skip */ }
            }

            if (!focalTweet && articles.length > 0) {
                // 如果没有精确匹配到 ID，取第一个非回复的推文
                try {
                    focalTweet = parseTweetArticle(articles[0]);
                } catch (e) {}
            }

            if (!focalTweet) {
                return { success: false, error: 'DOM 中未找到目标推文' };
            }

            return {
                success: true,
                focalTweet: focalTweet,
                threadTweets: threadTweets
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

module.exports = {
  buildPostDomScript,
};
