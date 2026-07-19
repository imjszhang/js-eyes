'use strict';


function escapeForJsDoubleQuote(s) {
    return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSetComposerImageChunkScript(chunk, isFirst) {
    const safe = escapeForJsDoubleQuote(chunk);
    if (isFirst) {
        return `(function(){ window.__imgB64 = "${safe}"; })();`;
    }
    return `(function(){ window.__imgB64 = (window.__imgB64 || "") + "${safe}"; })();`;
}

function buildSetComposerImageApplyScript(mimeType, fileName) {
    const safeMime = (mimeType || 'image/png').replace(/"/g, '\\"');
    const safeName = (fileName || 'image.png').replace(/"/g, '\\"');
    return `
    (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        try {
            var composerRoot = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="tweetComposer"]') || document.body;
            var tryExpand = function() {
                var btn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
                if (btn && !document.querySelector('[data-testid="tweetTextarea_0"]')) {
                    btn.click();
                    return true;
                }
                return false;
            };
            tryExpand();
            await delay(1500);
            var textarea = document.querySelector('[data-testid="tweetTextarea_0"]');
            var composerScope = (textarea && textarea.closest('[role="dialog"]')) ? textarea.closest('[role="dialog"]') : (textarea && textarea.closest('[data-testid="tweetComposer"]')) ? textarea.closest('[data-testid="tweetComposer"]') : composerRoot;
            var fileInput = composerScope.querySelector('input[type="file"]');
            if (!fileInput) {
                var attachBtn = composerScope.querySelector('[data-testid="attachMedia"]') || composerScope.querySelector('[data-testid="fileInput"]');
                if (attachBtn && attachBtn.tagName === 'INPUT') {
                    fileInput = attachBtn;
                } else if (attachBtn) {
                    attachBtn.click();
                    await delay(1200);
                    fileInput = composerScope.querySelector('input[type="file"]');
                }
                if (!fileInput && composerScope !== document.body) {
                    var allInScope = composerScope.querySelectorAll('input[type="file"]');
                    fileInput = allInScope.length > 0 ? allInScope[0] : null;
                }
            }
            if (!fileInput) {
                return { success: false, error: '未找到发推框中的文件输入' };
            }
            var b64 = (window.__imgB64 || "").replace(/\\s/g, "");
            if (!b64) {
                return { success: false, error: '未找到图片数据' };
            }
            var binary = atob(b64);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
            var blob = new Blob([bytes], { type: "${safeMime}" });
            var file = new File([blob], "${safeName}", { type: "${safeMime}" });
            var dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            var dropZone = composerScope.querySelector('[data-testid="attachMedia"]') ? composerScope.querySelector('[data-testid="attachMedia"]').closest('div') || composerScope : composerScope;
            var file2 = new File([blob], "${safeName}", { type: "${safeMime}" });
            var dt2 = new DataTransfer();
            dt2.items.add(file2);
            dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
            dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
            await delay(2000);
            try { delete window.__imgB64; } catch (e) {}
            return { success: true, b64Len: b64.length, blobSize: blob.size };
        } catch (e) {
            try { delete window.__imgB64; } catch (err) {}
            return { success: false, error: e.message };
        }
    })();
    `;
}

module.exports = {
  escapeForJsDoubleQuote,
  buildSetComposerImageChunkScript,
  buildSetComposerImageApplyScript,
};
