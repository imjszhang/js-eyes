'use strict';

/**
 * Readability-inspired content extraction script injected into the target page.
 * Returns structured page content as { title, author, content, excerpt, siteName, url, images, links }.
 */
function generateReadPageScript(format) {
  return `
(function() {
  var fmt = ${JSON.stringify(format || 'markdown')};

  function getMetaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? el.getAttribute('content') || '' : '';
  }

  function scoreNode(node) {
    var score = 0;
    var tag = node.tagName;
    if (/^(DIV|SECTION|ARTICLE|MAIN)$/i.test(tag)) score += 5;
    if (/^(PRE|TD|BLOCKQUOTE)$/i.test(tag)) score += 3;
    if (/^(FORM|OL|UL|DL|ADDRESS)$/i.test(tag)) score -= 3;
    if (/^(H1|H2|H3|H4|H5|H6|TH|HEADER|FOOTER|NAV)$/i.test(tag)) score -= 5;
    var id = (node.id || '') + ' ' + (node.className || '');
    if (/article|body|content|entry|main|page|post|text|blog|story/i.test(id)) score += 25;
    if (/combx|comment|contact|foot|footer|footnote|masthead|media|meta|outbrain|promo|related|scroll|shoutbox|sidebar|sponsor|shopping|tags|tool|widget|ad-break|agegate|pagination|pager|popup/i.test(id)) score -= 25;
    return score;
  }

  function extractContent() {
    var article = document.querySelector('article, [role="article"], main, [role="main"]');
    if (!article) {
      var candidates = document.querySelectorAll('div, section');
      var best = null, bestScore = -Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var node = candidates[i];
        var text = node.innerText || '';
        if (text.length < 200) continue;
        var s = scoreNode(node) + Math.min(Math.floor(text.length / 100), 3);
        if (s > bestScore) { bestScore = s; best = node; }
      }
      article = best || document.body;
    }
    return article;
  }

  function htmlToMarkdown(el) {
    if (!el) return '';
    var md = '';
    function walk(node) {
      if (node.nodeType === 3) { md += node.textContent; return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME)$/i.test(tag)) return;
      if (/^H([1-6])$/i.test(tag)) {
        var level = parseInt(RegExp.$1);
        md += '\\n' + '#'.repeat(level) + ' ';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '\\n\\n';
        return;
      }
      if (tag === 'P' || tag === 'DIV') {
        md += '\\n\\n';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '\\n\\n';
        return;
      }
      if (tag === 'BR') { md += '\\n'; return; }
      if (tag === 'A') {
        var href = node.getAttribute('href') || '';
        md += '[';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '](' + href + ')';
        return;
      }
      if (tag === 'IMG') {
        var alt = node.getAttribute('alt') || '';
        var src = node.getAttribute('src') || '';
        md += '![' + alt + '](' + src + ')';
        return;
      }
      if (tag === 'STRONG' || tag === 'B') {
        md += '**';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '**';
        return;
      }
      if (tag === 'EM' || tag === 'I') {
        md += '*';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '*';
        return;
      }
      if (tag === 'CODE') {
        md += '\\u0060';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '\\u0060';
        return;
      }
      if (tag === 'PRE') {
        md += '\\n\\u0060\\u0060\\u0060\\n';
        md += node.innerText || '';
        md += '\\n\\u0060\\u0060\\u0060\\n';
        return;
      }
      if (tag === 'LI') {
        md += '\\n- ';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        return;
      }
      if (tag === 'BLOCKQUOTE') {
        md += '\\n> ';
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        md += '\\n';
        return;
      }
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(el);
    return md.replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  var contentEl = extractContent();

  var images = [];
  var imgs = contentEl.querySelectorAll('img[src]');
  for (var i = 0; i < imgs.length; i++) {
    images.push({ src: imgs[i].src, alt: imgs[i].alt || '' });
  }
  var links = [];
  var anchors = contentEl.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var href = anchors[i].href;
    if (href && !href.startsWith('javascript:')) {
      links.push({ href: href, text: (anchors[i].innerText || '').trim() });
    }
  }

  var content;
  if (fmt === 'html') {
    content = contentEl.innerHTML;
  } else if (fmt === 'text') {
    content = (contentEl.innerText || '').trim();
  } else {
    content = htmlToMarkdown(contentEl);
  }

  return {
    title: document.title || '',
    author: getMetaContent('author') || getMetaContent('article:author') || '',
    content: content,
    excerpt: getMetaContent('description') || getMetaContent('og:description') || '',
    siteName: getMetaContent('og:site_name') || '',
    url: location.href,
    images: images.slice(0, 50),
    links: links.slice(0, 100),
  };
})();
`;
}

function generateClickScript(selector, options) {
  const opts = options || {};
  return `
(function() {
  var selector = ${JSON.stringify(selector)};
  var textMatch = ${JSON.stringify(opts.text || '')};
  var index = ${JSON.stringify(opts.index || 0)};

  var el;
  if (textMatch) {
    var all = document.querySelectorAll(selector || '*');
    var matches = [];
    for (var i = 0; i < all.length; i++) {
      if ((all[i].innerText || '').trim().indexOf(textMatch) !== -1) matches.push(all[i]);
    }
    el = matches[index] || null;
  } else if (selector.startsWith('//') || selector.startsWith('(//')) {
    var xr = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    el = xr.snapshotItem(index);
  } else {
    var all = document.querySelectorAll(selector);
    el = all[index] || null;
  }

  if (!el) {
    return { success: false, error: '未找到匹配元素: ' + selector + (textMatch ? ' (text=' + textMatch + ')' : '') };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.click();

  return {
    success: true,
    tag: el.tagName,
    text: (el.innerText || '').substring(0, 100),
  };
})();
`;
}

function generateFillFormScript(selector, value, options) {
  const opts = options || {};
  return `
(function() {
  var selector = ${JSON.stringify(selector)};
  var value = ${JSON.stringify(value)};
  var clearFirst = ${JSON.stringify(!!opts.clearFirst)};
  var index = ${JSON.stringify(opts.index || 0)};

  var all = document.querySelectorAll(selector);
  var el = all[index];
  if (!el) {
    return { success: false, error: '未找到表单元素: ' + selector };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();

  if (el.tagName === 'SELECT') {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, tag: 'SELECT', value: el.value };
  }

  if (el.isContentEditable) {
    if (clearFirst) el.innerHTML = '';
    el.innerHTML += value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true, tag: el.tagName, contentEditable: true };
  }

  if (clearFirst) el.value = '';
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, clearFirst ? value : el.value + value);
  } else {
    el.value = clearFirst ? value : el.value + value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true, tag: el.tagName, value: el.value.substring(0, 100) };
})();
`;
}

function generateWaitForScript(selector, options) {
  const opts = options || {};
  const timeoutMs = (opts.timeout || 10) * 1000;
  return `
new Promise(function(resolve) {
  var selector = ${JSON.stringify(selector)};
  var timeoutMs = ${timeoutMs};
  var visible = ${JSON.stringify(!!opts.visible)};

  function check() {
    var el = document.querySelector(selector);
    if (!el) return false;
    if (visible) {
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    return true;
  }

  if (check()) { resolve({ success: true, found: true, waited: 0 }); return; }

  var start = Date.now();
  var observer = new MutationObserver(function() {
    if (check()) {
      observer.disconnect();
      resolve({ success: true, found: true, waited: Date.now() - start });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  setTimeout(function() {
    observer.disconnect();
    resolve({ success: false, found: false, waited: timeoutMs, error: '等待超时: ' + selector });
  }, timeoutMs);
});
`;
}

function generateScrollScript(options) {
  const opts = options || {};
  return `
(function() {
  var target = ${JSON.stringify(opts.target || 'bottom')};
  var selector = ${JSON.stringify(opts.selector || '')};
  var pixels = ${JSON.stringify(opts.pixels || 0)};

  if (selector) {
    var el = document.querySelector(selector);
    if (!el) return { success: false, error: '未找到元素: ' + selector };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, scrolledTo: 'element', selector: selector };
  }

  if (target === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return { success: true, scrolledTo: 'top' };
  }

  if (target === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    return { success: true, scrolledTo: 'bottom', scrollHeight: document.body.scrollHeight };
  }

  if (pixels) {
    window.scrollBy({ top: pixels, behavior: 'smooth' });
    return { success: true, scrolledTo: 'relative', pixels: pixels };
  }

  return { success: true, scrolledTo: target };
})();
`;
}

function generateScreenshotScript() {
  return `
(function() {
  try {
    var canvas = document.createElement('canvas');
    var rect = document.documentElement.getBoundingClientRect();
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var ctx = canvas.getContext('2d');

    // Fallback: capture basic page info since html2canvas is not available natively
    // Return page dimensions and a description instead of actual screenshot
    return {
      success: true,
      method: 'metadata',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      url: location.href,
      title: document.title,
      note: 'Native page screenshot requires html2canvas library injection or extension-level capture API',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
})();
`;
}

module.exports = {
  generateReadPageScript,
  generateClickScript,
  generateFillFormScript,
  generateWaitForScript,
  generateScrollScript,
  generateScreenshotScript,
};
