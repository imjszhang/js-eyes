'use strict';

/**
 * Normalize extract options. Safe to call from Node; not injected into pages.
 */
function normalizeExtractOptions(options) {
  const opts = options && typeof options === 'object' && !options.nodeType ? options : {};
  const format = opts.format === 'html' || opts.format === 'text' ? opts.format : 'markdown';
  const maxContentChars = Number.isFinite(Number(opts.maxContentChars)) && Number(opts.maxContentChars) > 0
    ? Math.floor(Number(opts.maxContentChars))
    : 0;
  return {
    format,
    includeLinks: opts.includeLinks !== false,
    includeImages: opts.includeImages !== false,
    maxContentChars,
    maxLinks: Number.isFinite(Number(opts.maxLinks)) && Number(opts.maxLinks) >= 0
      ? Math.floor(Number(opts.maxLinks))
      : 100,
    maxImages: Number.isFinite(Number(opts.maxImages)) && Number(opts.maxImages) >= 0
      ? Math.floor(Number(opts.maxImages))
      : 50,
  };
}

/**
 * Self-contained page extractor. Serialized via Function#toString for
 * extension injection and generateReadPageScript. Dual signature:
 *   extractPageContent(document, options)
 *   extractPageContent(options)  // uses globalThis.document
 */
function extractPageContent(documentOrOptions, maybeOptions) {
  var document;
  var options;
  if (maybeOptions !== undefined) {
    document = documentOrOptions;
    options = maybeOptions || {};
  } else if (documentOrOptions && documentOrOptions.nodeType === 9) {
    document = documentOrOptions;
    options = {};
  } else {
    options = documentOrOptions || {};
    document = (typeof globalThis !== 'undefined' && globalThis.document)
      ? globalThis.document
      : null;
  }

  function emptyResult(extra) {
    var loc = '';
    try { loc = document && document.location ? String(document.location.href || '') : ''; } catch (e) {}
    var base = {
      title: document && document.title ? document.title : '',
      author: '',
      content: '',
      excerpt: '',
      siteName: '',
      url: loc,
      images: [],
      links: [],
      publishedTime: '',
      modifiedTime: '',
      canonicalUrl: '',
      lang: '',
      jsonLd: null,
      readyState: document && document.readyState ? document.readyState : '',
      contentChars: 0,
      truncated: false,
      status: 'ok',
    };
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) base[key] = extra[key];
      }
    }
    return base;
  }

  if (!document || !document.documentElement) {
    return emptyResult({ status: 'error', error: 'tab_not_found', code: 'tab_not_found' });
  }

  var format = options.format === 'html' || options.format === 'text' ? options.format : 'markdown';
  var includeLinks = options.includeLinks !== false;
  var includeImages = options.includeImages !== false;
  var maxContentChars = Number(options.maxContentChars);
  if (!(maxContentChars > 0)) maxContentChars = 0;
  var maxLinks = Number(options.maxLinks);
  if (!(maxLinks >= 0)) maxLinks = 100;
  var maxImages = Number(options.maxImages);
  if (!(maxImages >= 0)) maxImages = 50;

  function getMetaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? (el.getAttribute('content') || '') : '';
  }

  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function jsonLdAuthor(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      var names = [];
      for (var i = 0; i < value.length; i++) {
        var name = jsonLdAuthor(value[i]);
        if (name) names.push(name);
      }
      return names.join(', ');
    }
    if (typeof value === 'object') return value.name || value.alternateName || '';
    return '';
  }

  function jsonLdTypes(item) {
    var type = item && item['@type'];
    if (Array.isArray(type)) return type;
    return type ? [type] : [];
  }

  function isArticleType(types) {
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Article' || types[i] === 'NewsArticle' || types[i] === 'WebPage') return true;
    }
    return false;
  }

  function parseJsonLd() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    var items = [];
    for (var i = 0; i < scripts.length; i++) {
      try {
        var data = JSON.parse(scripts[i].textContent || '');
        if (Array.isArray(data)) {
          for (var a = 0; a < data.length; a++) items.push(data[a]);
        } else if (data && data['@graph'] && Array.isArray(data['@graph'])) {
          for (var g = 0; g < data['@graph'].length; g++) items.push(data['@graph'][g]);
        } else if (data) {
          items.push(data);
        }
      } catch (e) {}
    }
    for (var j = 0; j < items.length; j++) {
      if (items[j] && isArticleType(jsonLdTypes(items[j]))) return items[j];
    }
    return null;
  }

  function extractMetadata() {
    var jsonLd = parseJsonLd();
    var canonicalEl = document.querySelector('link[rel="canonical"]');
    var canonicalUrl = '';
    if (canonicalEl) {
      canonicalUrl = canonicalEl.href || canonicalEl.getAttribute('href') || '';
    }
    var htmlLang = '';
    if (document.documentElement) {
      htmlLang = document.documentElement.getAttribute('lang') || document.documentElement.lang || '';
    }
    return {
      title: firstNonEmpty(document.title, jsonLd && jsonLd.headline, getMetaContent('og:title')),
      author: firstNonEmpty(
        getMetaContent('author'),
        getMetaContent('article:author'),
        jsonLd && jsonLdAuthor(jsonLd.author),
      ),
      excerpt: firstNonEmpty(
        getMetaContent('description'),
        getMetaContent('og:description'),
        jsonLd && jsonLd.description,
      ),
      siteName: firstNonEmpty(getMetaContent('og:site_name'), jsonLd && jsonLd.publisher && jsonLd.publisher.name),
      publishedTime: firstNonEmpty(
        getMetaContent('article:published_time'),
        getMetaContent('og:published_time'),
        getMetaContent('datePublished'),
        jsonLd && jsonLd.datePublished,
      ),
      modifiedTime: firstNonEmpty(
        getMetaContent('article:modified_time'),
        getMetaContent('og:updated_time'),
        getMetaContent('dateModified'),
        jsonLd && jsonLd.dateModified,
      ),
      canonicalUrl: canonicalUrl,
      lang: htmlLang,
      jsonLd: jsonLd,
    };
  }

  function detectChallenge() {
    var title = (document.title || '').trim();
    var bodyText = '';
    try { bodyText = document.body ? String(document.body.innerText || '') : ''; } catch (e) {}
    var snippet = bodyText.slice(0, 800);
    var markers = document.querySelector(
      '#challenge-form, #cf-challenge-running, .cf-browser-verification, #challenge-stage, .cf-turnstile, #cf-error-details',
    );
    if (markers) return { blocked: true, blockedReason: 'cloudflare_challenge' };
    if (/just a moment/i.test(title) || /checking your browser/i.test(title) || /attention required/i.test(title)) {
      return { blocked: true, blockedReason: 'cloudflare_challenge' };
    }
    if (/^403\b/.test(title) || /access denied/i.test(title) || /forbidden/i.test(title)) {
      return { blocked: true, blockedReason: 'access_denied' };
    }
    if (bodyText.length < 1200) {
      if (/just a moment\.\.\.|checking your browser|cf-browser-verification|enable javascript and cookies/i.test(snippet)) {
        return { blocked: true, blockedReason: 'cloudflare_challenge' };
      }
      if (/access denied|you have been blocked|\b403\b.*forbidden|forbidden.*\b403\b/i.test(snippet)) {
        return { blocked: true, blockedReason: 'access_denied' };
      }
    }
    return { blocked: false, blockedReason: '' };
  }

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    var styleAttr = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(styleAttr)) return true;
    if (/visibility\s*:\s*hidden/i.test(styleAttr)) return true;
    try {
      var view = document.defaultView;
      if (view && typeof view.getComputedStyle === 'function') {
        var cs = view.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
      }
    } catch (e) {}
    return false;
  }

  function visibleTextLength(el) {
    if (!el) return 0;
    var clone = prepareVisibleClone(el);
    if (!clone) return 0;
    return String(clone.innerText || clone.textContent || '').trim().length;
  }

  function prepareVisibleClone(el) {
    if (!el) return null;
    var clone = el.cloneNode(true);
    var originals = el.querySelectorAll('*');
    var copies = clone.querySelectorAll('*');
    for (var i = originals.length - 1; i >= 0; i--) {
      if (isHidden(originals[i]) && copies[i] && copies[i].parentNode) {
        copies[i].parentNode.removeChild(copies[i]);
      }
    }
    if (isHidden(el)) return null;
    return clone;
  }

  function isDangerousTag(tag) {
    return /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|OBJECT|EMBED|LINK|META|BASE|TEMPLATE)$/.test(tag);
  }

  function sanitizeNode(root) {
    if (!root) return;
    var nodes = root.querySelectorAll('*');
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      var tag = node.tagName;
      if (isDangerousTag(tag)) {
        if (node.parentNode) node.parentNode.removeChild(node);
        continue;
      }
      var attrs = node.attributes ? Array.prototype.slice.call(node.attributes) : [];
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        var value = attrs[a].value || '';
        if (/^on/i.test(name)) {
          node.removeAttribute(name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(name);
        }
      }
    }
  }

  function sanitizeHtml(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html || '';
    sanitizeNode(wrap);
    return wrap.innerHTML;
  }

  function cellText(el) {
    return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function owningTable(el, table) {
    var node = el.parentNode;
    while (node && node !== table) {
      if (node.tagName === 'TABLE') return node;
      node = node.parentNode;
    }
    return table;
  }

  function tableToMarkdown(table) {
    var rows = [];
    var trs = table.querySelectorAll('tr');
    var r;
    for (r = 0; r < trs.length; r++) {
      var tr = trs[r];
      if (owningTable(tr, table) !== table) continue;
      if (isHidden(tr)) continue;
      var cols = [];
      var cells = tr.children;
      for (var c = 0; c < cells.length; c++) {
        var tag = cells[c].tagName;
        if (tag !== 'TD' && tag !== 'TH') continue;
        if (isHidden(cells[c])) continue;
        cols.push(cellText(cells[c]).replace(/\|/g, '\\|'));
      }
      if (cols.length) rows.push(cols);
    }
    if (!rows.length) return '';
    var width = 0;
    for (r = 0; r < rows.length; r++) {
      if (rows[r].length > width) width = rows[r].length;
    }
    function padRow(row) {
      var copy = row.slice();
      while (copy.length < width) copy.push('');
      return '| ' + copy.join(' | ') + ' |';
    }
    var md = '\n\n' + padRow(rows[0]) + '\n';
    var sep = [];
    for (var s = 0; s < width; s++) sep.push('---');
    md += '| ' + sep.join(' | ') + ' |\n';
    for (r = 1; r < rows.length; r++) md += padRow(rows[r]) + '\n';
    return md + '\n';
  }

  function htmlToMarkdown(root) {
    var md = '';
    function walk(node, listIndent, listOrdered, listIndex) {
      if (!node) return;
      if (node.nodeType === 3) {
        var text = String(node.textContent || '').replace(/\s+/g, ' ');
        if (!text || text === ' ') {
          if (text === ' ' && md.length && !/\s$/.test(md)) md += ' ';
          return;
        }
        if (/^\s/.test(text) && /\s$/.test(md)) text = text.replace(/^\s+/, '');
        md += text;
        return;
      }
      if (node.nodeType !== 1) return;
      if (isHidden(node)) return;
      var tag = node.tagName;
      if (isDangerousTag(tag) || tag === 'SVG') return;

      var heading = /^H([1-6])$/.exec(tag);
      if (heading) {
        var level = parseInt(heading[1], 10);
        var hashes = '';
        for (var h = 0; h < level; h++) hashes += '#';
        md += '\n' + hashes + ' ';
        for (var hi = 0; hi < node.childNodes.length; hi++) walk(node.childNodes[hi], listIndent, false, 0);
        md += '\n\n';
        return;
      }

      if (tag === 'P') {
        md += '\n\n';
        for (var pi = 0; pi < node.childNodes.length; pi++) walk(node.childNodes[pi], listIndent, false, 0);
        md += '\n\n';
        return;
      }

      if (tag === 'BR') {
        md += '\n';
        return;
      }

      if (tag === 'A') {
        var href = node.getAttribute('href') || '';
        if (!includeLinks || /^\s*javascript:/i.test(href)) {
          for (var ai = 0; ai < node.childNodes.length; ai++) walk(node.childNodes[ai], listIndent, false, 0);
          return;
        }
        md += '[';
        for (var aj = 0; aj < node.childNodes.length; aj++) walk(node.childNodes[aj], listIndent, false, 0);
        md += '](' + href + ')';
        return;
      }

      if (tag === 'IMG') {
        if (!includeImages) return;
        md += '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
        return;
      }

      if (tag === 'STRONG' || tag === 'B') {
        md += '**';
        for (var bi = 0; bi < node.childNodes.length; bi++) walk(node.childNodes[bi], listIndent, false, 0);
        md += '**';
        return;
      }

      if (tag === 'EM' || tag === 'I') {
        md += '*';
        for (var ei = 0; ei < node.childNodes.length; ei++) walk(node.childNodes[ei], listIndent, false, 0);
        md += '*';
        return;
      }

      if (tag === 'CODE' && (!node.parentNode || node.parentNode.tagName !== 'PRE')) {
        md += '`';
        for (var ci = 0; ci < node.childNodes.length; ci++) walk(node.childNodes[ci], listIndent, false, 0);
        md += '`';
        return;
      }

      if (tag === 'PRE') {
        md += '\n```\n' + String(node.innerText || node.textContent || '') + '\n```\n';
        return;
      }

      if (tag === 'BLOCKQUOTE') {
        md += '\n> ';
        for (var qi = 0; qi < node.childNodes.length; qi++) walk(node.childNodes[qi], listIndent, false, 0);
        md += '\n';
        return;
      }

      if (tag === 'TABLE') {
        md += tableToMarkdown(node);
        return;
      }

      if (tag === 'UL' || tag === 'OL') {
        var ordered = tag === 'OL';
        var index = 1;
        if (ordered) {
          var start = parseInt(node.getAttribute('start') || '1', 10);
          if (start > 0) index = start;
        }
        var indent = listIndent || '';
        var lis = node.children;
        for (var li = 0; li < lis.length; li++) {
          if (lis[li].tagName !== 'LI') continue;
          if (isHidden(lis[li])) continue;
          md += '\n' + indent + (ordered ? String(index) + '. ' : '- ');
          index += 1;
          var childIndent = indent + '  ';
          for (var lc = 0; lc < lis[li].childNodes.length; lc++) {
            var child = lis[li].childNodes[lc];
            if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
              walk(child, childIndent, child.tagName === 'OL', 0);
            } else {
              walk(child, indent, false, 0);
            }
          }
        }
        md += '\n';
        return;
      }

      if (tag === 'LI') {
        md += '\n' + (listIndent || '') + (listOrdered ? String(listIndex || 1) + '. ' : '- ');
        for (var lii = 0; lii < node.childNodes.length; lii++) walk(node.childNodes[lii], (listIndent || '') + '  ', false, 0);
        return;
      }

      // DIV / SECTION / ARTICLE / SPAN and other layout wrappers: no extra blank lines.
      for (var wi = 0; wi < node.childNodes.length; wi++) {
        walk(node.childNodes[wi], listIndent, listOrdered, listIndex);
      }
    }

    walk(root, '', false, 0);
    return md.replace(/\n{3,}/g, '\n\n').trim();
  }

  function scoreNode(node) {
    var score = 0;
    var tag = node.tagName;
    if (/^(DIV|SECTION|ARTICLE|MAIN)$/.test(tag)) score += 5;
    if (/^(PRE|TD|BLOCKQUOTE)$/.test(tag)) score += 3;
    if (/^(FORM|OL|UL|DL|ADDRESS)$/.test(tag)) score -= 3;
    if (/^(H1|H2|H3|H4|H5|H6|TH|HEADER|FOOTER|NAV)$/.test(tag)) score -= 5;
    var id = (node.id || '') + ' ' + (node.className || '');
    if (/article|body|content|entry|main|page|post|text|blog|story/i.test(id)) score += 25;
    if (/combx|comment|contact|foot|footer|footnote|masthead|media|meta|outbrain|promo|related|scroll|shoutbox|sidebar|sponsor|shopping|tags|tool|widget|ad-break|agegate|pagination|pager|popup/i.test(id)) {
      score -= 25;
    }
    return score;
  }

  function extractContentRoot() {
    var article = document.querySelector('article, [role="article"], main, [role="main"]');
    if (article && !isHidden(article) && visibleTextLength(article) > 0) return article;
    var candidates = document.querySelectorAll('div, section');
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (isHidden(node)) continue;
      var textLen = visibleTextLength(node);
      if (textLen < 80) continue;
      var s = scoreNode(node) + Math.min(Math.floor(textLen / 100), 3);
      if (s > bestScore) {
        bestScore = s;
        best = node;
      }
    }
    return best || document.body || document.documentElement;
  }

  var challenge = detectChallenge();
  var meta = extractMetadata();
  var url = '';
  try { url = document.location ? String(document.location.href || '') : ''; } catch (e) {}

  if (challenge.blocked) {
    return emptyResult({
      title: meta.title || (document.title || ''),
      author: meta.author,
      excerpt: meta.excerpt,
      siteName: meta.siteName,
      publishedTime: meta.publishedTime,
      modifiedTime: meta.modifiedTime,
      canonicalUrl: meta.canonicalUrl,
      lang: meta.lang,
      jsonLd: meta.jsonLd,
      url: url,
      status: 'blocked',
      blockedReason: challenge.blockedReason,
      content: '',
      contentChars: 0,
    });
  }

  var contentEl = extractContentRoot();
  var visible = prepareVisibleClone(contentEl);
  if (!visible) {
    return emptyResult({
      title: meta.title || (document.title || ''),
      author: meta.author,
      excerpt: meta.excerpt,
      siteName: meta.siteName,
      publishedTime: meta.publishedTime,
      modifiedTime: meta.modifiedTime,
      canonicalUrl: meta.canonicalUrl,
      lang: meta.lang,
      jsonLd: meta.jsonLd,
      url: url,
    });
  }

  var images = [];
  if (includeImages) {
    var imgs = visible.querySelectorAll('img[src]');
    for (var ii = 0; ii < imgs.length && images.length < maxImages; ii++) {
      images.push({ src: imgs[ii].getAttribute('src') || imgs[ii].src || '', alt: imgs[ii].alt || '' });
    }
  }

  var links = [];
  if (includeLinks) {
    var anchors = visible.querySelectorAll('a[href]');
    for (var li = 0; li < anchors.length && links.length < maxLinks; li++) {
      var href = anchors[li].getAttribute('href') || '';
      if (!href || /^\s*javascript:/i.test(href)) continue;
      links.push({
        href: anchors[li].href || href,
        text: String(anchors[li].innerText || '').trim(),
      });
    }
  }

  var content;
  if (format === 'html') {
    sanitizeNode(visible);
    content = visible.innerHTML;
  } else if (format === 'text') {
    content = String(visible.innerText || visible.textContent || '').trim();
  } else {
    content = htmlToMarkdown(visible);
  }

  var truncated = false;
  if (maxContentChars > 0 && content.length > maxContentChars) {
    content = content.slice(0, maxContentChars);
    truncated = true;
  }

  return {
    title: meta.title || (document.title || ''),
    author: meta.author,
    content: content,
    excerpt: meta.excerpt,
    siteName: meta.siteName,
    url: url,
    images: images,
    links: links,
    publishedTime: meta.publishedTime,
    modifiedTime: meta.modifiedTime,
    canonicalUrl: meta.canonicalUrl,
    lang: meta.lang,
    jsonLd: meta.jsonLd,
    readyState: document.readyState || '',
    contentChars: String(content).length,
    truncated: truncated,
    status: 'ok',
  };
}

const pageExtractApi = {
  extractPageContent,
  normalizeExtractOptions,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageExtractApi;
}
if (typeof globalThis !== 'undefined') {
  globalThis.JSEyesExtractPageContent = extractPageContent;
  globalThis.JSEyesPageExtract = pageExtractApi;
}
