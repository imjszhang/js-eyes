'use strict';

const path = require('path');
const fs = require('fs').promises;
const pkg = require('../package.json');

function parseArgs(args = process.argv.slice(2)) {
    const options = {
        tweetInputs: [],       // URL 或 ID 列表
        withThread: false,
        withReplies: 0,        // 0 = 不抓取回复
        pretty: false,
        browserServer: null,
        output: null,
        closeTab: false,
        reply: null,           // 回复内容，非空时进入回复模式
        dryRun: false,         // 仅打印不发送
        replyStyle: 'reply',   // 'reply' = Replying to @xxx 式回复；'thread' = 点击推文下回复按钮（可能呈 thread）
        post: null,            // 单条新帖正文（--post "内容"）
        thread: [],            // 串推多段（--thread "段1" "段2" ...）
        threadDelay: 3500,     // 串推每条之间延迟毫秒（建议 3～5 秒，避免限流）
        threadMax: 25,         // 串推最大条数
        image: null,           // 发帖时附带的图片路径（--image path，仅单条或串推第1条）
        quote: null,           // Quote Tweet 引用目标（URL 或 ID，--quote url，需与 --post 搭配）
        domOnly: false,        // 强制 DOM 模式，跳过 GraphQL CreateTweet（--dom-only）
        via: 'auto',           // auto=官方 API 优先再 DOM；api=仅官方 API；dom=仅 DOM/GraphQL
        recordingMode: null,
        recordingBaseDir: null,
        noCache: false,
        debugRecording: false,
        runId: null,
    };

    let collectingThread = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith('--')) {
            collectingThread = false;
            const key = arg.replace('--', '').replace(/-/g, '');
            const nextArg = args[i + 1];

            switch (key) {
                case 'withthread':
                    options.withThread = true;
                    break;
                case 'withreplies':
                    options.withReplies = parseInt(nextArg, 10) || 20;
                    i++;
                    break;
                case 'pretty':
                    options.pretty = true;
                    break;
                case 'browserserver':
                    options.browserServer = nextArg;
                    i++;
                    break;
                case 'output':
                    options.output = nextArg;
                    i++;
                    break;
                case 'closetab':
                    options.closeTab = true;
                    break;
                case 'reply':
                    options.reply = typeof nextArg === 'string' ? nextArg : '';
                    if (options.reply) i++;
                    break;
                case 'dryrun':
                    options.dryRun = true;
                    break;
                case 'replystyle': {
                    const style = (nextArg || '').toLowerCase();
                    if (style === 'thread' || style === 'reply') options.replyStyle = style;
                    if (nextArg) i++;
                    break;
                }
                case 'post':
                    options.post = typeof nextArg === 'string' ? nextArg : '';
                    if (options.post) i++;
                    break;
                case 'thread':
                    collectingThread = true;
                    break;
                case 'threaddelay':
                    options.threadDelay = parseInt(nextArg, 10) || 3500;
                    i++;
                    break;
                case 'threadmax':
                    options.threadMax = parseInt(nextArg, 10) || 25;
                    i++;
                    break;
                case 'image':
                    options.image = typeof nextArg === 'string' ? nextArg : '';
                    if (options.image) i++;
                    break;
                case 'quote':
                    options.quote = typeof nextArg === 'string' ? nextArg : '';
                    if (options.quote) i++;
                    break;
                case 'domonly':
                    options.domOnly = true;
                    options.via = 'dom';
                    break;
                case 'via':
                    options.via = ['auto', 'api', 'dom'].includes(String(nextArg || '').toLowerCase())
                        ? String(nextArg).toLowerCase()
                        : 'auto';
                    if (nextArg) i++;
                    break;
                case 'recordingmode':
                    options.recordingMode = nextArg;
                    i++;
                    break;
                case 'recordingbasedir':
                    options.recordingBaseDir = nextArg;
                    i++;
                    break;
                case 'runid':
                    options.runId = nextArg;
                    i++;
                    break;
                case 'nocache':
                    options.noCache = true;
                    break;
                case 'debugrecording':
                    options.debugRecording = true;
                    break;
                default:
                    console.warn(`未知选项: ${arg}`);
            }
        } else {
            if (collectingThread) {
                options.thread.push(arg);
            } else {
                options.tweetInputs.push(arg);
            }
        }
    }

    return options;
}

async function writeOutputEnvelope(options, command, payload) {
    if (!options.output) return;
    const ok = !!payload.success;
    const envelope = {
        ok,
        result: payload,
        error: ok ? null : {
            code: payload.errorCode || 'write_failed',
            message: String(payload.error || 'write operation failed'),
        },
        meta: {
            version: pkg.version,
            command,
            duration_ms: null,
            via: payload.via || options.via || null,
        },
    };
    const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.join(process.cwd(), options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(envelope, null, options.pretty ? 2 : 0) + '\n', 'utf8');
}

async function emitResultPayload(options, command, payload) {
    const enriched = {
        via: payload.via || options.via || null,
        ...payload,
    };
    console.log('__RESULT_JSON__:' + JSON.stringify(enriched));
    await writeOutputEnvelope(options, command, enriched);
}

function extractTweetId(input) {
    return require('../lib/xUrl').extractTweetId(input);
}

async function checkForVerificationPage(browser, tabId, safeExecuteScript) {
    try {
        const urlResult = await browser.getTabUrl(tabId);
        const currentUrl = (typeof urlResult === 'string' ? urlResult : urlResult?.url) || '';

        const blockedPaths = ['/account/access', '/i/flow/consent_flow', '/i/flow/login',
                              '/account/login_verification', '/account/begin_password_reset'];
        for (const p of blockedPaths) {
            if (currentUrl.includes(p)) {
                return { blocked: true, reason: `VERIFICATION_REQUIRED (url: ${p})` };
            }
        }

        const domCheck = await safeExecuteScript(tabId, `(() => {
            const text = (document.body?.innerText || '').substring(0, 3000).toLowerCase();
            const signals = ['verify your identity', 'unusual login activity', 'suspicious activity',
                             'confirm your identity', 'complete a captcha', 'are you a robot',
                             'verify it\\'s you', 'account has been locked'];
            for (const s of signals) { if (text.includes(s)) return s; }
            return '';
        })()`);

        const matchedSignal = domCheck?.result?.value || domCheck?.value || '';
        if (matchedSignal) {
            return { blocked: true, reason: `VERIFICATION_REQUIRED (dom: ${matchedSignal})` };
        }

        return { blocked: false };
    } catch (e) {
        return { blocked: false };
    }
}

function printUsage() {
    console.log('\n使用方法:');
    console.log('  node scripts/x-post.js <url_or_id> [url_or_id...] [options]');
    console.log('  node scripts/x-post.js --post "内容" [options]');
    console.log('  node scripts/x-post.js --thread "段1" "段2" "段3" [options]');
    console.log('\n选项:');
    console.log('  --with-thread              抓取完整对话线程（默认只抓取指定推文）');
    console.log('  --with-replies <number>    包含回复数，支持分页翻页（默认0，不抓取回复）');
    console.log('  --pretty                   美化 JSON 输出');
    console.log('  --browser-server <url>     浏览器服务器地址');
    console.log('  --output <file>            指定输出文件路径');
    console.log('  --close-tab                抓完后关闭 tab（默认保留）');
    console.log('  --reply "内容"             对指定推文发表回复（回复模式，仅支持单条推文）');
    console.log('  --reply-style <reply|thread>  reply=Replying to @xxx 式（默认）；thread=推文下点击回复（可能呈 thread）');
    console.log('  --dry-run                  与 --reply/--post/--thread/--quote 同用时仅打印内容，不实际发送');
    console.log('  --post "内容"             发一条新帖（与 URL、--reply、--thread 互斥）');
    console.log('  --quote <url_or_id>       Quote Tweet：引用指定推文并附评论（需与 --post 搭配，与 --reply/--thread 互斥）');
    console.log('  --thread "段1" "段2" ...  发串推（与 URL、--post、--reply 互斥）');
    console.log('  --via <auto|api|dom>      写操作通道：默认 auto（官方 API 优先，失败回退 DOM/GraphQL）');
    console.log('  --thread-delay <ms>       串推每条之间延迟毫秒（默认 3500，建议 3～5 秒防限流）');
    console.log('  --thread-max <n>          串推最大条数（默认 25）');
    console.log('  --image <path>            发帖时附带图片（仅单条或串推第1条）');
    console.log('  --recording-mode <mode>   off | history | standard | debug');
    console.log('  --debug-recording         强制开启 debug recording');
    console.log('  --no-cache                禁用 recording cache');
    console.log('  --recording-base-dir <dir> 自定义 recording 落盘目录');
    console.log('  --run-id <id>            自定义本次运行 ID');
    console.log('\n示例:');
    console.log('  node scripts/x-post.js https://x.com/elonmusk/status/1234567890');
    console.log('  node scripts/x-post.js 1234567890 9876543210 --pretty');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --with-thread');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --with-replies 100');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --reply "回复内容"');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --reply "回复" --reply-style reply');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --reply "续推" --reply-style thread');
    console.log('  node scripts/x-post.js https://x.com/user/status/123 --reply "测试" --dry-run');
    console.log('  node scripts/x-post.js --post "新帖内容"');
    console.log('  node scripts/x-post.js --thread "段1" "段2" "段3" --thread-delay 2000');
    console.log('  node scripts/x-post.js --post "带图发帖" --image ./path/to/image.png');
    console.log('  node scripts/x-post.js --post "评论内容" --quote https://x.com/user/status/123');
    console.log('  node scripts/x-post.js --post "评论" --quote 1234567890 --dry-run');
}

module.exports = {
  parseArgs,
  writeOutputEnvelope,
  emitResultPayload,
  extractTweetId,
  checkForVerificationPage,
  printUsage,
};
