'use strict';

// v0.7: 把 bridge/visual.common.js 装进 vm sandbox + 极简 mock DOM，
// 验证 lifetime 派生 / cleanup({scope}) / staggerFlashItems 三阶段的关键行为。
// 不依赖 jsdom，避免给 kit 引入额外 dev-dep。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'visual.common.js'),
  'utf8'
);

// ---- 极简 mock DOM ----
function makeFakeEl(opts){
  const o = opts || {};
  const el = {
    tagName: o.tag || 'DIV',
    id: o.id || '',
    parentNode: null,
    children: [],
    style: {
      _props: {},
      setProperty: function(k, v){ this._props[k] = v; },
    },
    classList: { _set: new Set(), add(c){ this._set.add(c); }, contains(c){ return this._set.has(c); } },
    _attrs: {},
    _listeners: {},
    _rect: o.rect || { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 },
    _inDom: !!o.inDom,
    appendChild(child){
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child){
      const idx = el.children.indexOf(child);
      if (idx >= 0) el.children.splice(idx, 1);
      child.parentNode = null;
    },
    remove(){
      if (el.parentNode) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx >= 0) el.parentNode.children.splice(idx, 1);
        el.parentNode = null;
      }
    },
    setAttribute(k, v){ el._attrs[k] = String(v); },
    getAttribute(k){ return el._attrs[k] != null ? el._attrs[k] : null; },
    addEventListener(type, fn){
      el._listeners[type] = el._listeners[type] || [];
      el._listeners[type].push(fn);
    },
    removeEventListener(){},
    dispatchEvent(type){
      const ls = el._listeners[type] || [];
      for (const fn of ls) try { fn({}); } catch (_) {}
    },
    getBoundingClientRect(){ return Object.assign({}, el._rect); },
    scrollIntoView(){ /* noop */ },
    get firstChild(){ return el.children[0]; },
    querySelectorAll(sel){
      const out = [];
      function walk(node){
        if (!node || !node.children) return;
        for (const c of node.children) {
          if (matches(c, sel)) out.push(c);
          walk(c);
        }
      }
      walk(el);
      return out;
    },
    querySelector(sel){
      const list = el.querySelectorAll(sel);
      return list[0] || null;
    },
  };
  return el;
}

// 极简 selector matcher：只支持 "." + classname / "#" + id / [attr="val"]
function matches(node, sel){
  if (!sel) return false;
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel.startsWith('.')) return node.classList && node.classList.contains(sel.slice(1));
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const m = /^\[([^=]+)="([^"]*)"\]$/.exec(sel);
    if (m) return node.getAttribute(m[1]) === m[2];
  }
  return false;
}

function makeSandbox(){
  const docElements = new Map();
  const head = makeFakeEl({ tag: 'HEAD' });
  const body = makeFakeEl({ tag: 'BODY' });
  const root = makeFakeEl({ tag: 'HTML' });
  root.appendChild(head); root.appendChild(body);

  const document = {
    head: head,
    body: body,
    documentElement: root,
    createElement(tag){
      const el = makeFakeEl({ tag: tag.toUpperCase() });
      Object.defineProperty(el, 'textContent', {
        get(){ return el._textContent || ''; },
        set(v){ el._textContent = String(v == null ? '' : v); },
      });
      Object.defineProperty(el, 'className', {
        get(){ return el._className || ''; },
        set(v){
          el._className = String(v == null ? '' : v);
          el.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
        },
      });
      Object.defineProperty(el, 'title', {
        get(){ return el._title || ''; },
        set(v){ el._title = String(v == null ? '' : v); },
      });
      return el;
    },
    createTextNode(text){
      return { nodeType: 3, textContent: String(text), parentNode: null,
        remove(){ if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i>=0) this.parentNode.children.splice(i,1); this.parentNode = null; } } };
    },
    getElementById(id){
      function walk(node){
        if (!node || !node.children) return null;
        for (const c of node.children) {
          if (c.id === id) return c;
          const r = walk(c);
          if (r) return r;
        }
        return null;
      }
      return walk(root);
    },
    querySelector(sel){ return root.querySelector(sel); },
    querySelectorAll(sel){ return root.querySelectorAll(sel); },
    evaluate(){ return { snapshotItem(){ return null; } }; },
  };

  const win = {
    document,
    innerWidth: 1000,
    innerHeight: 800,
    devicePixelRatio: 1,
    scrollY: 0, scrollX: 0,
    pageYOffset: 0, pageXOffset: 0,
    CSS: { escape(s){ return String(s).replace(/[^\w-]/g, ch => '\\' + ch); } },
    setTimeout(fn, ms){ return setTimeout(fn, ms); },
    clearTimeout(id){ return clearTimeout(id); },
    addEventListener(){},
    removeEventListener(){},
    requestAnimationFrame(fn){ return setTimeout(() => fn(Date.now()), 0); },
  };
  win.window = win;
  Object.defineProperty(win, 'history', {
    value: { pushState(){}, replaceState(){} },
  });

  const ctx = vm.createContext({
    window: win,
    document: document,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    Math,
    Date,
    Object,
    Array,
    Number,
    Boolean,
    String,
    JSON,
    console,
    Error,
    TypeError,
    Promise,
    Map,
    Set,
  });
  ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: 'visual.common.js' });
  return { ctx, win, document, body };
}

// 把虚拟元素挂进 sandbox body，让 resolveAnchor / flashElement 能找到
function attachToBody(sandbox, el){
  sandbox.body.appendChild(el);
  return el;
}

// ---- 测试 ----

test('VERSION 升到 0.7.0', () => {
  const { win } = makeSandbox();
  assert.equal(win.__jse_visual.VERSION, '0.7.0');
});

test('config 默认含 v0.7 lifetime 字段', () => {
  const { win } = makeSandbox();
  const c = win.__jse_visual.getConfig();
  assert.equal(c.flashMs, 420);
  assert.equal(c.lingerMs, 5000);
  assert.equal(c.pinnedHold, 'next-call');
  assert.equal(c.errorAsPinned, true);
});

test('flashElement: pending tone → lifetime=flash; success → linger; error → pinned (errorAsPinned=true)', () => {
  const { win, body } = makeSandbox();
  // success → linger
  const elA = attachToBody({ body, ...win }, win.document.createElement('div'));
  // 简化：直接把 fake target 加进 body 让 resolveAnchor 找不到没关系，flashElement 直接传 el
  const target = attachToBody({ body }, win.document.createElement('div'));
  target._rect = { left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 };

  // 创建 layer 和绑定 sandbox 默认 prefix
  win.__jse_visual.flashElement(target, { tone: 'success', label: 'ok' });
  // body 下应该有 layer，layer 下应该有一个 box，box.data-lifetime=linger
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.ok(layer, 'layer should exist');
  const box1 = layer.children[0];
  assert.equal(box1.getAttribute('data-lifetime'), 'linger');

  // pending → flash
  win.__jse_visual.flashElement(target, { tone: 'pending', label: 'p' });
  const box2 = layer.children[1];
  assert.equal(box2.getAttribute('data-lifetime'), 'flash');

  // error → pinned (errorAsPinned 默认 true)
  win.__jse_visual.flashElement(target, { tone: 'error', label: 'e' });
  const box3 = layer.children[2];
  assert.equal(box3.getAttribute('data-lifetime'), 'pinned');
  // pinned 应该带一个 close button child
  const hasClose = box3.children.some(c => c.classList && c.classList.contains('__jse_visual_close'));
  assert.ok(hasClose, 'pinned overlay should have × close button');
});

test('errorAsPinned=false 时 error 降级到 linger', () => {
  const { win, body } = makeSandbox();
  win.__jse_visual.config({ errorAsPinned: false });
  const target = attachToBody({ body }, win.document.createElement('div'));
  target._rect = { left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 };
  win.__jse_visual.flashElement(target, { tone: 'error', label: 'e' });
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children[0].getAttribute('data-lifetime'), 'linger');
});

test('cleanup({scope:"non-pinned"}) 保留 pinned，清掉 flash/linger', () => {
  const { win, body } = makeSandbox();
  const t1 = attachToBody({ body }, win.document.createElement('div'));
  t1._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  const t2 = attachToBody({ body }, win.document.createElement('div'));
  t2._rect = { left: 50, top: 200, right: 250, bottom: 300, width: 200, height: 100 };
  const t3 = attachToBody({ body }, win.document.createElement('div'));
  t3._rect = { left: 50, top: 350, right: 250, bottom: 450, width: 200, height: 100 };

  win.__jse_visual.flashElement(t1, { tone: 'pending' }); // flash
  win.__jse_visual.flashElement(t2, { tone: 'success' }); // linger
  win.__jse_visual.flashElement(t3, { tone: 'error' });   // pinned

  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children.length, 3);

  win.__jse_visual.cleanup({ scope: 'non-pinned' });

  // 只剩 pinned 那个
  assert.equal(layer.children.length, 1);
  assert.equal(layer.children[0].getAttribute('data-lifetime'), 'pinned');
});

test('cleanup({scope:"all"}) 强制清 pinned + HUD', () => {
  const { win, body } = makeSandbox();
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  win.__jse_visual.flashElement(t, { tone: 'error' });
  win.__jse_visual.showHud({ action: 'oops', tone: 'error' });
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children.length, 1);
  assert.ok(win.document.getElementById('__jse_visual_hud'));

  win.__jse_visual.cleanup({ scope: 'all' });
  assert.equal(layer.children.length, 0);
  assert.equal(win.document.getElementById('__jse_visual_hud'), null);
});

test('dismissAll 等价 cleanup({scope:"all"})', () => {
  const { win, body } = makeSandbox();
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  win.__jse_visual.flashElement(t, { tone: 'error' });
  win.__jse_visual.dismissAll();
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children.length, 0);
});

test('before(): 默认 pinnedHold=next-call → 自动清掉上一轮 pinned', () => {
  const { win, body } = makeSandbox();
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  // 先制造一个 pinned overlay
  win.__jse_visual.flashElement(t, { tone: 'error' });
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children.length, 1);
  // 触发 before (新工具调用)
  win.__jse_visual.before({ kind: 'list', label: 'next', tone: 'pending' });
  // pinnedHold='next-call' 默认会清掉
  assert.equal(layer.children.length, 0);
});

test('before(): pinnedHold=manual 时保留 pinned', () => {
  const { win, body } = makeSandbox();
  win.__jse_visual.config({ pinnedHold: 'manual' });
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  win.__jse_visual.flashElement(t, { tone: 'error' });
  win.__jse_visual.before({ kind: 'list', label: 'next', tone: 'pending' });
  const layer = win.document.getElementById('__jse_visual_layer');
  // pinned 还在
  const pinnedCount = layer.children.filter(c => c.getAttribute('data-lifetime') === 'pinned').length;
  assert.equal(pinnedCount, 1);
});

test('staggerFlashItems phase A: 同步 emit 全部语义 flash 进 ring buffer（不依赖 DOM）', () => {
  const { win } = makeSandbox();
  // 不挂任何 DOM；resolveAnchor 默认拿 null
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const drained0 = win.__jse_visual.drainEvents();
  void drained0;
  win.__jse_visual.staggerFlashItems({ items: items, label: 'L', tone: 'success' });
  const events = win.__jse_visual.drainEvents();
  const flashes = events.filter(e => e.type === 'flash');
  // phase A：3 条 sync flash event 全部入 buffer，无 DOM 依赖
  assert.equal(flashes.length, 3);
  // 每条带 lifetime=linger（success 默认派生）
  for (const f of flashes) assert.equal(f.lifetime, 'linger');
});

test('staggerFlashItems phase B: 在视口内的元素同步并发画 outline', () => {
  const { win, body } = makeSandbox();
  // 在视口内的 3 个 anchor
  const items = [];
  for (let i = 0; i < 3; i++){
    const el = attachToBody({ body }, win.document.createElement('div'));
    el.id = 'item-' + i;
    el.setAttribute('data-anchor', 'a' + i);
    el._rect = { left: 50, top: 100 + i * 200, right: 250, bottom: 200 + i * 200, width: 200, height: 100 };
    items.push({ selector: '#item-' + i });
  }
  // 给 sandbox 注入 site resolver（用 selector 字段拿 element）
  win.__jse_visual.setSiteAnchorResolver(function(spec){
    if (spec && spec.selector) return win.document.querySelector(spec.selector);
    return null;
  });
  win.__jse_visual.staggerFlashItems({ items: items, label: 'L', tone: 'success' });
  const layer = win.document.getElementById('__jse_visual_layer');
  // phase B 同步 → 3 个 box 已经画出来
  assert.equal(layer.children.length, 3);
  for (const box of layer.children) {
    assert.equal(box.getAttribute('data-lifetime'), 'linger');
  }
});

test('staggerFlashItems: emit 计数与 items 长度对齐（不漏 event）', () => {
  const { win } = makeSandbox();
  const items = Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i }));
  // drain 残留事件
  win.__jse_visual.drainEvents();
  const n = win.__jse_visual.staggerFlashItems({ items: items, tone: 'info' });
  assert.equal(n, 5);
  const events = win.__jse_visual.drainEvents();
  const flashes = events.filter(e => e.type === 'flash');
  assert.equal(flashes.length, 5);
});

test('removeLater(linger): hover 进入清 timer，hover 离开重挂', () => {
  const { win, body } = makeSandbox();
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  win.__jse_visual.config({ lingerMs: 50 });
  win.__jse_visual.flashElement(t, { tone: 'success' });
  const layer = win.document.getElementById('__jse_visual_layer');
  assert.equal(layer.children.length, 1);
  const box = layer.children[0];
  // hover 进入 → 清 timer
  box.dispatchEvent('mouseenter');
  // 等过 lingerMs，元素仍在
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(layer.children.length, 1, 'hover 期间 linger 不消失');
      // hover 离开 → 重挂 timer
      box.dispatchEvent('mouseleave');
      setTimeout(() => {
        assert.equal(layer.children.length, 0, 'leave 后 linger timer 触发，元素消失');
        resolve();
      }, 80);
    }, 80);
  });
});

test('flash event 带 lifetime 字段（向后兼容：老消费者可忽略）', () => {
  const { win, body } = makeSandbox();
  const t = attachToBody({ body }, win.document.createElement('div'));
  t._rect = { left: 50, top: 50, right: 250, bottom: 150, width: 200, height: 100 };
  win.__jse_visual.drainEvents();
  win.__jse_visual.flashElement(t, { tone: 'success', anchor: { id: 'x' } });
  const events = win.__jse_visual.drainEvents();
  const flash = events.find(e => e.type === 'flash');
  assert.ok(flash);
  assert.equal(flash.lifetime, 'linger');
});
