'use strict';


function buildReplyViaDomScript(tweetId, replyText) {
    const safeReplyText = JSON.stringify(replyText || '');
    const safeTweetId = String(tweetId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
    (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const replyText = ${safeReplyText};
        const targetTweetId = '${safeTweetId}';
        try {
            var articles = document.querySelectorAll('article[data-testid="tweet"]');
            let targetArticle = null;
            for (var artIdx = 0; artIdx < articles.length; artIdx++) {
                var art = articles[artIdx];
                const link = art.querySelector('a[href*="/status/' + targetTweetId + '"]');
                if (link) {
                    targetArticle = art;
                    break;
                }
            }
            if (!targetArticle) targetArticle = articles[0];
            if (!targetArticle) {
                return { success: false, error: '未找到推文区域' };
            }
            const replyBtn = targetArticle.querySelector('[data-testid="reply"]');
            if (!replyBtn) {
                return { success: false, error: '未找到回复按钮' };
            }
            replyBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            replyBtn.click();
            await delay(1500);
            var composerRoot = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="tweetComposer"]') || document.body;
            var isVisible = function(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
            };
            let textarea = null;
            for (var round = 0; round < 25; round++) {
                var candidates = composerRoot.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"], [contenteditable="true"]');
                for (var k = 0; k < candidates.length; k++) {
                    if (isVisible(candidates[k])) {
                        textarea = candidates[k];
                        break;
                    }
                }
                if (textarea) break;
                await delay(350);
            }
            if (!textarea) {
                return { success: false, error: '未找到可见的回复输入框（等待超时）' };
            }
            textarea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(250);
            textarea.click();
            await delay(200);
            textarea.focus();
            await delay(200);

            const setTextContent = async (element, text) => {
                const methods = [
                    async () => {
                        element.focus();
                        element.select && element.select();
                        await delay(100);
                        if (document.execCommand) {
                            document.execCommand('insertText', false, text);
                            return true;
                        }
                        return false;
                    },
                    async () => {
                        element.innerHTML = text.replace(/\\n/g, '<br>');
                        return true;
                    },
                    async () => {
                        element.textContent = text;
                        return true;
                    },
                    async () => {
                        element.focus();
                        for (const char of text) {
                            const event = new KeyboardEvent('keydown', { key: char, bubbles: true });
                            element.dispatchEvent(event);
                            element.textContent += char;
                            await delay(10);
                        }
                        return true;
                    }
                ];
                for (const method of methods) {
                    try {
                        const result = await method();
                        if (result) {
                            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                            element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                            await delay(200);
                            return true;
                        }
                    } catch (e) {}
                }
                return false;
            };

            const contentSet = await setTextContent(textarea, replyText);
            if (!contentSet) {
                return { success: false, error: '无法设置回复输入框内容（所有方法均失败）' };
            }

            let contentVerified = false;
            for (let checkRound = 0; checkRound < 20; checkRound++) {
                await delay(250);
                var actualText = (textarea.textContent || textarea.innerText || '').trim();
                if (actualText === replyText.trim()) {
                    contentVerified = true;
                    break;
                }
                if (checkRound < 3) {
                    await setTextContent(textarea, replyText);
                }
            }

            if (!contentVerified) {
                var finalText = (textarea.textContent || textarea.innerText || '').trim();
                return { success: false, error: '内容校验失败: 输入框内容与预期不一致 (len=' + finalText.length + ' vs ' + replyText.trim().length + ', content="' + finalText.substring(0, 50) + '")' };
            }

            var root = composerRoot && composerRoot !== document.body ? composerRoot : document;
            let postBtn = null;
            for (var waitRound = 0; waitRound < 25; waitRound++) {
                postBtn = root.querySelector('[data-testid="tweetButtonInline"]');
                if (!postBtn) postBtn = root.querySelector('[data-testid="tweetButton"]');
                if (!postBtn) {
                    postBtn = Array.from(root.querySelectorAll('button[role="button"]')).find(function(b) {
                        if (!isVisible(b)) return false;
                        var t = (b.textContent || '').trim();
                        return (t === 'Post' || t === 'Reply' || t === '发推' || t === '回复');
                    });
                }
                if (postBtn && !postBtn.hasAttribute('disabled') && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
                    break;
                }
                postBtn = null;
                await delay(400);
            }
            if (!postBtn) {
                return { success: false, error: '未找到发送按钮' };
            }
            if (postBtn.hasAttribute('disabled') || postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
                return { success: false, error: '发送按钮不可用（等待超时，可能未满足字数或权限）' };
            }
            postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            postBtn.click();

            let dialogClosed = false;
            for (let dRound = 0; dRound < 20; dRound++) {
                await delay(400);
                var dlg = document.querySelector('[role="dialog"]');
                if (!dlg || !isVisible(dlg)) {
                    dialogClosed = true;
                    break;
                }
            }
            if (!dialogClosed) {
                return { success: false, error: '发送后对话框未关闭（可能未成功发送）' };
            }

            await delay(1500);
            var newReplyId = null;
            try {
                var allArticles = document.querySelectorAll('article[data-testid="tweet"]');
                var focalIndex = -1;
                for (var j = 0; j < allArticles.length; j++) {
                    var linkInArt = allArticles[j].querySelector('a[href*="/status/' + targetTweetId + '"]');
                    if (linkInArt) {
                        focalIndex = j;
                        break;
                    }
                }
                var replyArticle = focalIndex >= 0 && focalIndex + 1 < allArticles.length ? allArticles[focalIndex + 1] : allArticles[0];
                var replyLink = replyArticle ? replyArticle.querySelector('a[href*="/status/"]') : null;
                if (replyLink && replyLink.href) {
                    var m = replyLink.href.match(/status\\/(\\d+)/);
                    if (m) newReplyId = m[1];
                }
            } catch (e) {}
            return { success: true, tweetId: newReplyId || undefined };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildReplyViaIntentScript(replyText) {
    const safeReplyText = JSON.stringify(replyText || '');
    return `
    (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const replyText = ${safeReplyText};
        try {
            await delay(3500);
            var composerRoot = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="tweetComposer"]') || document.body;
            var isVisible = function(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
            };
            let textarea = null;
            for (var round = 0; round < 35; round++) {
                var candidates = composerRoot.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"], [contenteditable="true"]');
                for (var k = 0; k < candidates.length; k++) {
                    if (isVisible(candidates[k])) {
                        textarea = candidates[k];
                        break;
                    }
                }
                if (textarea) break;
                await delay(400);
            }
            if (!textarea) {
                return { success: false, error: '未找到可见的输入框（intent 页等待超时）' };
            }
            textarea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            textarea.click();
            await delay(250);
            textarea.focus();
            await delay(250);

            const setTextContent = async (element, text) => {
                const methods = [
                    async () => {
                        element.focus();
                        element.select && element.select();
                        await delay(100);
                        if (document.execCommand) {
                            document.execCommand('insertText', false, text);
                            return true;
                        }
                        return false;
                    },
                    async () => {
                        element.innerHTML = text.replace(/\\n/g, '<br>');
                        return true;
                    },
                    async () => {
                        element.textContent = text;
                        return true;
                    },
                    async () => {
                        element.focus();
                        for (const char of text) {
                            const event = new KeyboardEvent('keydown', { key: char, bubbles: true });
                            element.dispatchEvent(event);
                            element.textContent += char;
                            await delay(10);
                        }
                        return true;
                    }
                ];
                for (const method of methods) {
                    try {
                        const result = await method();
                        if (result) {
                            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                            element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                            await delay(200);
                            return true;
                        }
                    } catch (e) {}
                }
                return false;
            };

            const contentSet = await setTextContent(textarea, replyText);
            if (!contentSet) {
                return { success: false, error: '无法设置回复输入框内容（所有方法均失败）' };
            }

            let contentVerified = false;
            for (let checkRound = 0; checkRound < 20; checkRound++) {
                await delay(250);
                var actualText = (textarea.textContent || textarea.innerText || '').trim();
                if (actualText === replyText.trim()) {
                    contentVerified = true;
                    break;
                }
                if (checkRound < 3) {
                    await setTextContent(textarea, replyText);
                }
            }

            if (!contentVerified) {
                var finalText = (textarea.textContent || textarea.innerText || '').trim();
                return { success: false, error: '内容校验失败: 输入框内容与预期不一致 (len=' + finalText.length + ' vs ' + replyText.trim().length + ')' };
            }

            var root = composerRoot && composerRoot !== document.body ? composerRoot : document;
            let postBtn = root.querySelector('[data-testid="tweetButtonInline"]');
            if (!postBtn) postBtn = root.querySelector('[data-testid="tweetButton"]');
            if (!postBtn) {
                postBtn = Array.from(root.querySelectorAll('button[role="button"]')).find(function(b) {
                    var t = (b.textContent || '').trim();
                    return (t === 'Post' || t === 'Reply' || t === '发推' || t === '回复') && !b.disabled && !b.hasAttribute('disabled');
                });
            }
            if (!postBtn) {
                return { success: false, error: '未找到发送按钮' };
            }
            if (postBtn.hasAttribute('disabled') || postBtn.getAttribute('aria-disabled') === 'true' || postBtn.disabled) {
                return { success: false, error: '发送按钮不可用（可能内容未正确填入）' };
            }
            postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(200);
            postBtn.click();

            let dialogClosed = false;
            for (let dRound = 0; dRound < 20; dRound++) {
                await delay(400);
                var dlg = document.querySelector('[role="dialog"]');
                if (!dlg || !isVisible(dlg)) {
                    dialogClosed = true;
                    break;
                }
            }
            if (!dialogClosed) {
                return { success: false, error: '发送后对话框未关闭（可能未成功发送）' };
            }

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildNewTweetViaDomScript(tweetText) {
    const safeTweetText = JSON.stringify(tweetText || '');
    return `
    (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const tweetText = ${safeTweetText};
        try {
            var composerRoot = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="tweetComposer"]') || document.body;
            var isVisible = function(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
            };
            var tryExpandComposer = function() {
                var postBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
                if (postBtn && !document.querySelector('[data-testid="tweetTextarea_0"]')) {
                    postBtn.click();
                    return true;
                }
                return false;
            };
            tryExpandComposer();
            await delay(1500);
            let textarea = null;
            for (var round = 0; round < 30; round++) {
                var candidates = composerRoot.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"], [contenteditable="true"]');
                for (var k = 0; k < candidates.length; k++) {
                    if (isVisible(candidates[k])) {
                        textarea = candidates[k];
                        break;
                    }
                }
                if (textarea) break;
                await delay(400);
            }
            if (!textarea) {
                return { success: false, error: '未找到可见的发推输入框（等待超时）' };
            }
            textarea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(250);
            textarea.click();
            await delay(200);
            textarea.focus();
            await delay(200);
            if (textarea.contentEditable === 'true') {
                textarea.focus();
                if (document.execCommand) {
                    document.execCommand('insertText', false, tweetText);
                } else {
                    textarea.textContent = tweetText;
                }
                textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tweetText }));
            } else {
                textarea.value = tweetText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await delay(1200);
            await delay(800);
            var actualText = (textarea.textContent || textarea.innerText || '').trim();
            if (actualText !== tweetText.trim()) {
                return { success: false, error: '内容校验失败: 输入框内容与预期不一致 (len=' + actualText.length + ' vs ' + tweetText.trim().length + ')' };
            }
            var root = composerRoot && composerRoot !== document.body ? composerRoot : document;
            let postBtn = null;
            for (var waitRound = 0; waitRound < 25; waitRound++) {
                postBtn = root.querySelector('[data-testid="tweetButtonInline"]');
                if (!postBtn) postBtn = root.querySelector('[data-testid="tweetButton"]');
                if (!postBtn) {
                    postBtn = Array.from(root.querySelectorAll('button[role="button"]')).find(function(b) {
                        if (!isVisible(b)) return false;
                        var t = (b.textContent || '').trim();
                        return (t === 'Post' || t === '发推');
                    });
                }
                if (postBtn && !postBtn.hasAttribute('disabled') && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
                    break;
                }
                postBtn = null;
                await delay(400);
            }
            if (!postBtn) {
                return { success: false, error: '未找到发送按钮' };
            }
            if (postBtn.hasAttribute('disabled') || postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
                return { success: false, error: '发送按钮不可用（等待超时，可能未满足字数或权限）' };
            }
            postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            postBtn.click();
            await delay(2500);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildQuoteTweetViaDomScript(quoteText) {
    const safeQuoteText = JSON.stringify(quoteText || '');
    return `
    (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const quoteText = ${safeQuoteText};
        try {
            var isVisible = function(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
            };

            // 1. 找到推文并点击 Repost 按钮
            var retweetBtn = null;
            for (var waitR = 0; waitR < 20; waitR++) {
                retweetBtn = document.querySelector('[data-testid="retweet"]') || document.querySelector('[data-testid="unretweet"]');
                if (retweetBtn && isVisible(retweetBtn)) break;
                retweetBtn = null;
                await delay(400);
            }
            if (!retweetBtn) {
                return { success: false, error: '未找到 Repost 按钮' };
            }
            retweetBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            retweetBtn.click();
            await delay(1200);

            // 2. 在弹出菜单中找到 "Quote" 选项并点击
            var quoteMenuItem = null;
            for (var waitQ = 0; waitQ < 15; waitQ++) {
                var menuItems = document.querySelectorAll('[role="menuitem"], [data-testid="Dropdown"] a, [role="menu"] [role="menuitem"]');
                for (var mi = 0; mi < menuItems.length; mi++) {
                    var txt = (menuItems[mi].textContent || '').trim().toLowerCase();
                    if (txt === 'quote' || txt === '引用' || txt.includes('quote')) {
                        quoteMenuItem = menuItems[mi];
                        break;
                    }
                }
                if (quoteMenuItem) break;
                await delay(400);
            }
            if (!quoteMenuItem) {
                return { success: false, error: '未找到 Quote 菜单项' };
            }
            quoteMenuItem.click();
            await delay(2000);

            // 3. 在弹出的 compose dialog 中找到输入框
            var composerRoot = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="tweetComposer"]') || document.body;
            let textarea = null;
            for (var round = 0; round < 30; round++) {
                var candidates = composerRoot.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"], [contenteditable="true"]');
                for (var k = 0; k < candidates.length; k++) {
                    if (isVisible(candidates[k])) {
                        textarea = candidates[k];
                        break;
                    }
                }
                if (textarea) break;
                await delay(400);
            }
            if (!textarea) {
                return { success: false, error: '未找到 Quote 输入框（等待超时）' };
            }

            // 4. 输入评论文本（多方式尝试 + 轮询验证 + 重试）
            const setTextContent = async (element, text) => {
                const methods = [
                    async () => {
                        element.focus();
                        element.select && element.select();
                        await delay(100);
                        if (document.execCommand) {
                            document.execCommand('insertText', false, text);
                            return true;
                        }
                        return false;
                    },
                    async () => {
                        element.innerHTML = text.replace(/\\n/g, '<br>');
                        return true;
                    },
                    async () => {
                        element.textContent = text;
                        return true;
                    },
                    async () => {
                        element.focus();
                        for (const char of text) {
                            const event = new KeyboardEvent('keydown', { key: char, bubbles: true });
                            element.dispatchEvent(event);
                            element.textContent += char;
                            await delay(10);
                        }
                        return true;
                    }
                ];
                for (const method of methods) {
                    try {
                        const result = await method();
                        if (result) {
                            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                            element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                            await delay(200);
                            return true;
                        }
                    } catch (e) {}
                }
                return false;
            };

            textarea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(250);
            textarea.click();
            await delay(200);
            textarea.focus();
            await delay(200);

            const contentSet = await setTextContent(textarea, quoteText);
            if (!contentSet) {
                return { success: false, error: '无法设置 Quote 输入框内容（所有方法均失败）' };
            }

            let contentVerified = false;
            for (let checkRound = 0; checkRound < 20; checkRound++) {
                await delay(250);
                var actualText = (textarea.textContent || textarea.innerText || '').trim();
                if (actualText === quoteText.trim()) {
                    contentVerified = true;
                    break;
                }
                if (checkRound < 3) {
                    await setTextContent(textarea, quoteText);
                }
            }

            if (!contentVerified) {
                var finalText = (textarea.textContent || textarea.innerText || '').trim();
                return { success: false, error: '内容校验失败: 输入框内容与预期不一致 (len=' + finalText.length + ' vs ' + quoteText.trim().length + ', content="' + finalText.substring(0, 50) + '")' };
            }

            // 5. 找到 Post 按钮并点击
            var root = composerRoot && composerRoot !== document.body ? composerRoot : document;
            let postBtn = null;
            for (var waitRound = 0; waitRound < 25; waitRound++) {
                postBtn = root.querySelector('[data-testid="tweetButton"]');
                if (!postBtn) postBtn = root.querySelector('[data-testid="tweetButtonInline"]');
                if (!postBtn) {
                    postBtn = Array.from(root.querySelectorAll('button[role="button"]')).find(function(b) {
                        if (!isVisible(b)) return false;
                        var t = (b.textContent || '').trim();
                        return (t === 'Post' || t === '发推');
                    });
                }
                if (postBtn && !postBtn.hasAttribute('disabled') && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
                    break;
                }
                postBtn = null;
                await delay(400);
            }
            if (!postBtn) {
                return { success: false, error: '未找到 Quote 发送按钮' };
            }
            if (postBtn.hasAttribute('disabled') || postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
                return { success: false, error: 'Quote 发送按钮不可用（等待超时）' };
            }
            postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await delay(300);
            postBtn.click();

            // 6. 验证 compose dialog 已关闭（表示发送成功）
            let dialogClosed = false;
            for (let dRound = 0; dRound < 20; dRound++) {
                await delay(400);
                var dlg = document.querySelector('[role="dialog"]');
                if (!dlg || !isVisible(dlg)) {
                    dialogClosed = true;
                    break;
                }
            }
            if (!dialogClosed) {
                return { success: false, error: 'Quote 发送后 dialog 未关闭（发送可能失败）' };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildGetFirstTweetIdFromPageScript(matchText) {
    const hasMatch = matchText != null && String(matchText).trim() !== '';
    const searchStr = hasMatch ? JSON.stringify(String(matchText).trim()) : 'null';
    return `
    (async () => {
        try {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            const matchText = ${searchStr};
            var initialWait = matchText ? 5000 : 2000;
            var maxTries = matchText ? 5 : 1;
            for (var tryNum = 0; tryNum < maxTries; tryNum++) {
                await delay(tryNum === 0 ? initialWait : 2500);
                var articles = document.querySelectorAll('article[data-testid="tweet"]');
                var firstTweetId = null;
                for (var ai = 0; ai < articles.length; ai++) {
                    var art = articles[ai];
                    var link = art.querySelector('a[href*="/status/"]');
                    if (link && link.href) {
                        var mat = link.href.match(/status\\/(\\d+)/);
                        if (mat && !firstTweetId) firstTweetId = mat[1];
                        if (matchText) {
                            var tweetTextEl = art.querySelector('[data-testid="tweetText"]');
                            var bodyText = tweetTextEl ? (tweetTextEl.textContent || '').trim() : (art.textContent || '').trim();
                            var snippet = matchText.length > 30 ? matchText.substring(0, 30) : matchText;
                            if (bodyText.indexOf(matchText) === -1 && bodyText.indexOf(snippet) === -1) continue;
                        }
                        if (mat) return { success: true, tweetId: mat[1] };
                    }
                }
                if (matchText && firstTweetId) {
                    return { success: true, tweetId: firstTweetId, fallback: true };
                }
            }
            return { success: false, error: matchText ? '未找到内容匹配的推文 ID（界面可能尚未更新）' : '未找到推文 ID' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

module.exports = {
  buildReplyViaDomScript,
  buildReplyViaIntentScript,
  buildNewTweetViaDomScript,
  buildQuoteTweetViaDomScript,
  buildGetFirstTweetIdFromPageScript,
};
