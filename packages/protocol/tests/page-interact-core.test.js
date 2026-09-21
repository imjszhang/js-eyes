'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseKeyChord } = require('../page-interact-core');

describe('parseKeyChord', () => {
  it('accepts named keys and modifier+letter chords', () => {
    assert.equal(parseKeyChord('Enter').key, 'Enter');
    assert.equal(parseKeyChord('Escape').key, 'Escape');
    assert.equal(parseKeyChord('Control+a').key, 'a');
    assert.equal(parseKeyChord('Control+a').mods.ctrlKey, true);
    assert.equal(parseKeyChord('Meta+Shift+Tab').key, 'Tab');
    assert.equal(parseKeyChord('Meta+Shift+Tab').mods.metaKey, true);
    assert.equal(parseKeyChord('Meta+Shift+Tab').mods.shiftKey, true);
  });

  it('rejects bare letters and unknown chords', () => {
    assert.equal(parseKeyChord('a').error, 'unsupported keys');
    assert.equal(parseKeyChord('Control+Enter+a').error, 'unsupported keys');
    assert.equal(parseKeyChord('').error, 'keys is required');
  });
});

describe('in-page state and refs', () => {
  beforeEach(() => {
    delete global.window;
    delete global.document;
    delete global.location;
    delete global.HTMLInputElement;
    delete global.HTMLTextAreaElement;
    delete global.Event;
    delete global.KeyboardEvent;
    delete global.MutationObserver;
  });

  it('collects interactive elements and resolves refs until the next snapshot', () => {
    const { collectPageState, clickInPage, resolveRef } = loadWithDom({
      title: 'Demo',
      href: 'https://example.com/path',
      buttons: [{ text: 'Save', tag: 'BUTTON' }],
    });

    const first = collectPageState(10, true);
    assert.equal(first.title, 'Demo');
    assert.equal(first.generation, 1);
    assert.equal(first.elements.length, 1);
    assert.equal(first.elements[0].ref, 'e1');
    assert.equal(first.elements[0].role, 'button');

    const clicked = clickInPage('', '', 0, 'e1');
    assert.equal(clicked.success, true);
    assert.equal(clicked.tag, 'BUTTON');

    first.elements[0];
    const store = global.window.__jsEyesRefStore;
    store.map.e1.el.isConnected = false;
    const stale = resolveRef('e1');
    assert.equal(stale.code, 'REF_STALE');
    assert.equal(clickInPage('', '', 0, 'e1').code, 'REF_STALE');
  });

  it('selects native options and rejects non-select refs', () => {
    const { collectPageState, selectOptionInPage } = loadWithDom({
      title: 'Form',
      href: 'https://example.com',
      select: { options: [{ value: 'a', text: 'Alpha' }, { value: 'b', text: 'Beta' }] },
    });
    const state = collectPageState(10, true);
    const ref = state.elements.find((item) => item.tag === 'select').ref;
    const selected = selectOptionInPage('', 'b', '', 0, ref);
    assert.equal(selected.success, true);
    assert.equal(selected.value, 'b');
  });
});

function loadWithDom(spec) {
  const clicks = [];
  function makeEl(tag, extras = {}) {
    const el = {
      tagName: tag,
      innerText: extras.text || '',
      textContent: extras.text || '',
      isConnected: true,
      disabled: false,
      isContentEditable: false,
      href: extras.href,
      src: extras.src,
      type: extras.type,
      name: extras.name,
      id: extras.id,
      value: extras.value || '',
      options: extras.options,
      selectedIndex: 0,
      attributes: extras.attributes || {},
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      getBoundingClientRect() {
        return { x: 0, y: 0, width: 40, height: 16 };
      },
      scrollIntoView() {},
      focus() {},
      click() { clicks.push(this); },
      dispatchEvent() { return true; },
    };
    if (extras.options) {
      Object.defineProperty(el, 'value', {
        get() {
          const opt = this.options[this.selectedIndex];
          return opt ? opt.value : '';
        },
        set(next) {
          const index = this.options.findIndex((opt) => opt.value === next);
          if (index >= 0) this.selectedIndex = index;
        },
      });
    }
    return el;
  }

  const nodes = [];
  for (const button of spec.buttons || []) {
    nodes.push(makeEl(button.tag || 'BUTTON', button));
  }
  if (spec.select) {
    nodes.push(makeEl('SELECT', spec.select));
  }

  const iframeNodes = [];
  global.document = {
    title: spec.title,
    readyState: 'complete',
    body: { scrollHeight: 100 },
    documentElement: {},
    querySelector() { return nodes[0] || null; },
    querySelectorAll(sel) {
      if (sel === 'iframe') return iframeNodes;
      return nodes;
    },
    evaluate() {
      return { snapshotItem() { return null; } };
    },
    activeElement: nodes[0] || null,
  };
  global.location = { href: spec.href };
  global.window = { __jsEyesRefStore: null };
  global.URL = require('node:url').URL;
  global.Event = class Event { constructor() {} };
  global.KeyboardEvent = class KeyboardEvent { constructor() {} };
  global.MutationObserver = class MutationObserver {
    observe() {}
    disconnect() {}
  };
  global.HTMLInputElement = { prototype: {} };
  global.HTMLTextAreaElement = { prototype: {} };

  delete require.cache[require.resolve('../page-interact-core')];
  const core = require('../page-interact-core');
  return { ...core, clicks };
}
