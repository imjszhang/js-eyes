'use strict';

function buildParseTweetResultSnippet() {
    return `
                // 递归解析 tweet result
                const parseTweetResult = (tweetResult) => {
                    if (!tweetResult) return null;
                    const actualTweet = tweetResult.tweet || tweetResult;
                    const legacy = actualTweet.legacy;
                    if (!legacy) return null;

                    // 跳过广告
                    if (actualTweet.promotedMetadata) return null;

                    const userResult = actualTweet.core?.user_results?.result;
                    const userLegacy = userResult?.legacy;
                    const userCore = userResult?.core;
                    const userAvatar = userResult?.avatar;

                    // 提取媒体 URL（增强版：包含视频多质量等级）
                    const mediaUrls = [];
                    const mediaDetails = [];
                    const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];

                    mediaEntities.forEach(media => {
                        if (media.type === 'photo' && media.media_url_https) {
                            mediaUrls.push(media.media_url_https);
                            mediaDetails.push({
                                type: 'photo',
                                url: media.media_url_https,
                                expandedUrl: media.expanded_url || '',
                                width: media.original_info?.width || 0,
                                height: media.original_info?.height || 0
                            });
                        } else if (media.type === 'video' || media.type === 'animated_gif') {
                            const variants = (media.video_info?.variants || [])
                                .filter(v => v.content_type === 'video/mp4')
                                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                            const bestMp4 = variants[0];
                            if (bestMp4) {
                                mediaUrls.push(bestMp4.url);
                            }

                            const m3u8 = (media.video_info?.variants || [])
                                .find(v => v.content_type === 'application/x-mpegURL');

                            mediaDetails.push({
                                type: media.type,
                                posterUrl: media.media_url_https || '',
                                duration: media.video_info?.duration_millis || 0,
                                variants: (media.video_info?.variants || []).map(v => ({
                                    url: v.url,
                                    contentType: v.content_type,
                                    bitrate: v.bitrate || 0
                                })),
                                bestMp4Url: bestMp4?.url || '',
                                m3u8Url: m3u8?.url || '',
                                width: media.original_info?.width || 0,
                                height: media.original_info?.height || 0
                            });
                        }
                    });

                    // 提取引用推文
                    let quoteTweet = null;
                    const quotedResult = legacy.quoted_status_result?.result
                        || actualTweet.quoted_status_result?.result;
                    if (quotedResult) {
                        quoteTweet = parseTweetResult(quotedResult);
                    }

                    // 提取卡片（链接预览）
                    let card = null;
                    const cardData = actualTweet.card?.legacy;
                    if (cardData) {
                        const bindingValues = {};
                        (cardData.binding_values || []).forEach(bv => {
                            const val = bv.value?.string_value || bv.value?.image_value?.url || '';
                            if (val) bindingValues[bv.key] = val;
                        });
                        card = {
                            name: cardData.name || '',
                            title: bindingValues.title || '',
                            description: bindingValues.description || '',
                            url: bindingValues.card_url || bindingValues.url || '',
                            thumbnailUrl: bindingValues.thumbnail_image_original || bindingValues.thumbnail_image || '',
                            domain: bindingValues.domain || bindingValues.vanity_url || ''
                        };
                    }

                    // 提取 note_tweet（长推文完整内容）
                    const noteText = actualTweet.note_tweet?.note_tweet_results?.result?.text || '';

                    const screenName = userCore?.screen_name || userLegacy?.screen_name || '';
                    const tweetIdStr = legacy.id_str || actualTweet.rest_id || '';

                    return {
                        tweetId: tweetIdStr,
                        author: {
                            name: userCore?.name || userLegacy?.name || '',
                            username: '@' + screenName,
                            avatarUrl: userAvatar?.image_url || userLegacy?.profile_image_url_https || '',
                            isVerified: userResult?.is_blue_verified || false
                        },
                        content: noteText || legacy.full_text || '',
                        publishTime: legacy.created_at || '',
                        lang: legacy.lang || '',
                        stats: {
                            replies: legacy.reply_count || 0,
                            retweets: legacy.retweet_count || 0,
                            likes: legacy.favorite_count || 0,
                            views: parseInt(actualTweet.views?.count, 10) || 0,
                            bookmarks: legacy.bookmark_count || 0,
                            quotes: legacy.quote_count || 0
                        },
                        mediaUrls: [...new Set(mediaUrls)],
                        mediaDetails: mediaDetails,
                        tweetUrl: screenName && tweetIdStr ? ('https://x.com/' + screenName + '/status/' + tweetIdStr) : '',
                        isRetweet: !!legacy.retweeted_status_result,
                        isReply: !!legacy.in_reply_to_status_id_str,
                        inReplyToTweetId: legacy.in_reply_to_status_id_str || null,
                        inReplyToUser: legacy.in_reply_to_screen_name || null,
                        conversationId: legacy.conversation_id_str || '',
                        quoteTweet: quoteTweet,
                        card: card,
                        source: actualTweet.source || ''
                    };
                };
    `;
}

module.exports = { buildParseTweetResultSnippet };
