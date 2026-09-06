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

module.exports = {
  generateReadPageScript,
};
