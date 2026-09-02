'use strict';

const cheerio = require('cheerio');

function cheerioPage(html, url) {
  const $ = cheerio.load(String(html || ''));
  let parsed;
  try { parsed = new URL(url); } catch (_) { parsed = new URL('https://www.google.com/'); }

  function wrap(el) {
    if (!el) return null;
    const node = $(el);
    const wrapped = {
      tagName: String(el.tagName || el.name || '').toUpperCase(),
      textContent: node.text() || '',
      href: node.attr('href') || '',
      getAttribute(name) {
        const value = node.attr(name);
        return value == null ? null : value;
      },
      querySelector(sel) {
        const found = node.find(sel).get(0);
        return found ? wrap(found) : null;
      },
      querySelectorAll(sel) {
        return node.find(sel).toArray().map(wrap);
      },
      closest(sel) {
        const found = node.closest(sel).get(0);
        return found ? wrap(found) : null;
      },
    };
    Object.defineProperty(wrapped, 'parentElement', {
      get() {
        const parent = node.parent().get(0);
        if (!parent || parent.type === 'root' || parent.name === 'root') return null;
        return wrap(parent);
      },
    });
    return wrapped;
  }

  return {
    locationHref: parsed.toString(),
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    title: $('title').first().text() || '',
    querySelector(sel) {
      const el = $(sel).get(0);
      return el ? wrap(el) : null;
    },
    querySelectorAll(sel) {
      return $(sel).toArray().map(wrap);
    },
  };
}

module.exports = { cheerioPage };
