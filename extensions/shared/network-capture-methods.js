'use strict';

(() => {
const fault = code => Object.assign(new Error(code), {code});
const bytesOf = value => new TextEncoder().encode(JSON.stringify(value)).length;
const properties = new Set(['className','currentSrc','duration','currentTime','paused','src','textContent']);

function validateOptions(input) {
  if (!input || typeof input !== 'object') throw fault('CAPTURE_SCOPE_INVALID');
  const allowed = ['origins','urlPatterns','captureBodies','maxBodyBytes','maxBufferBytes','maxEvents','ttlMs','page'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw fault('CAPTURE_SCOPE_INVALID');
  if (!Array.isArray(input.origins) || !input.origins.length || input.origins.length > 8 || input.origins.some(o => {
    try { const u = new URL(o); return u.protocol !== 'https:' || u.origin !== o || u.username || u.password; } catch { return true; }
  })) throw fault('CAPTURE_SCOPE_INVALID');
  if (!Array.isArray(input.urlPatterns) || !input.urlPatterns.length || input.urlPatterns.length > 16 || input.urlPatterns.some(p => typeof p !== 'string' || p.length > 2048 || !/^https:\/\/(\*\.)?[a-z0-9.-]+\/[\x21-\x7e]*$/i.test(p))) throw fault('CAPTURE_SCOPE_INVALID');
  const options = {...input};
  for (const [key,min,max,fallback] of [['maxBodyBytes',0,2097152,1048576],['maxBufferBytes',1024,16777216,8388608],['maxEvents',1,512,256],['ttlMs',1000,300000,60000]]) {
    const v = options[key] ?? fallback;
    if (!Number.isSafeInteger(v) || v < min || v > max) throw fault('CAPTURE_LIMIT');
    options[key] = v;
  }
  if (options.captureBodies !== undefined && typeof options.captureBodies !== 'boolean') throw fault('CAPTURE_SCOPE_INVALID');
  if (options.page) {
    if (Object.keys(options.page).some(k => k !== 'selectors') || !Array.isArray(options.page.selectors) || options.page.selectors.length > 8) throw fault('CAPTURE_SCOPE_INVALID');
    const names = new Set();
    for (const s of options.page.selectors) {
      if (!s || Object.keys(s).some(k => !['name','selector','properties'].includes(k)) || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(s.name) || names.has(s.name) || typeof s.selector !== 'string' || !s.selector || s.selector.length > 256 || !Array.isArray(s.properties) || s.properties.length > properties.size || s.properties.some(p => !properties.has(p))) throw fault('CAPTURE_SCOPE_INVALID');
      names.add(s.name);
    }
  }
  return options;
}

// Only fixed, bounded DOM reads run in the content world. Callers provide data,
// never code or arbitrary property paths. Password/input values are excluded.
function samplePage(selectors) {
  const values = {};
  for (const spec of selectors) {
    const found = [];
    for (const node of Array.from(document.querySelectorAll(spec.selector)).slice(0,4)) {
      const props = {};
      for (const name of spec.properties) {
        const value = node[name];
        if (typeof value === 'string') props[name] = value.slice(0,8192);
        else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) props[name] = value;
      }
      found.push({properties:props});
    }
    values[spec.name] = found;
  }
  return {url:location.href, values};
}

function patternMatches(pattern, url) {
  const u = new URL(url), p = new URL(pattern.replace('://*.', '://wildcard.'));
  const wildcard = pattern.startsWith('https://*.');
  const host = wildcard ? p.hostname.slice(9) : p.hostname;
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !(u.hostname === host || wildcard && u.hostname.endsWith(`.${host}`))) return false;
  const glob = p.pathname + p.search, text = u.pathname + u.search;
  let i = 0, j = 0, star = -1, retry = 0;
  while (j < text.length) {
    if (glob[i] === text[j]) { i++; j++; }
    else if (glob[i] === '*') { star = i++; retry = j; }
    else if (star >= 0) { i = star + 1; j = ++retry; }
    else return false;
  }
  while (glob[i] === '*') i++;
  return i === glob.length;
}

class CaptureEngine {
  constructor(api, runPage, {now = () => Date.now()} = {}) {
    this.api = api; this.runPage = runPage; this.now = now;
    this.sessions = new Map(); this.requests = new Map(); this.sampling = false;
    this.timer = setInterval(() => this.tick().catch(() => {}), 500);
    this.timer.unref?.();
    api.webRequest.onBeforeRequest.addListener(d => this.before(d), {urls:['https://*/*']}, ['blocking']);
    api.webRequest.onHeadersReceived.addListener(d => this.headers(d), {urls:['https://*/*']}, ['responseHeaders']);
    api.webRequest.onErrorOccurred.addListener(d => this.finish(d.requestId, true), {urls:['https://*/*']});
    api.webRequest.onBeforeRedirect.addListener(d => { this.headers(d); const r = this.requests.get(d.requestId); try { r?.filter?.disconnect(); } catch {} this.finish(d.requestId,true); }, {urls:['https://*/*']});
    api.webRequest.onCompleted.addListener(d => { this.headers(d); const r = this.requests.get(d.requestId); if (r && (!r.filter || r.bodyFinished)) this.finish(d.requestId); }, {urls:['https://*/*']}, ['responseHeaders']);
    api.tabs.onRemoved.addListener(tabId => { for (const s of this.sessions.values()) if (s.tabId === tabId) this.stop(s); });
  }
  active(s) { if (s.active && s.expiresAt <= this.now()) this.stop(s); return s.active; }
  status(s) { return {sessionId:s.id, active:this.active(s), seq:s.seq, ackedSeq:s.ackedSeq, dropped:s.dropped, bufferedBytes:s.bytes, expiresAt:s.expiresAt, diagnostics:{...s.diagnostics,inFlight:[...this.requests.values()].filter(r => r.session === s).map(r => ({bytes:r.bytes,statusCode:r.statusCode,filterStatus:r.filter?.status || null}))}}; }
  stop(s) { s.active = false; for (const [id,r] of this.requests) if (r.session === s) { try { r.filter?.disconnect(); } catch {} this.finish(id,true); } }
  push(s,event) {
    event = {...event, sessionId:s.id, tabId:s.tabId, sequence:++s.seq, timestamp:new Date(this.now()).toISOString()};
    const size = bytesOf(event);
    const total = [...this.sessions.values()].reduce((n,v) => n + v.bytes,0);
    if (s.events.length >= s.options.maxEvents || s.bytes + size > s.options.maxBufferBytes || total + size > 67108864) { s.dropped++; return; }
    s.events.push({event,size}); s.bytes += size;
  }
  async sample(s) {
    if (!this.active(s) || s.samplePending) return;
    let tab;
    try { tab = await this.api.tabs.get(s.tabId); } catch { this.stop(s); return; }
    if (tab.incognito !== false || !s.options.origins.includes(new URL(tab.url).origin)) { this.stop(s); return; }
    try {
      const pending = Promise.resolve(this.runPage(s.tabId, samplePage, [s.options.page?.selectors || []]));
      s.samplePending = pending;
      const release = () => { if (s.samplePending === pending) s.samplePending = null; };
      pending.then(release,release);
      let timer;
      const deadline = new Promise((_,reject) => { timer = setTimeout(() => reject(fault('CAPTURE_PAGE_TIMEOUT')),2000); timer.unref?.(); });
      let page;
      try { page = await Promise.race([pending,deadline]); } finally { clearTimeout(timer); }
      if (!this.active(s) || !page || !s.options.origins.includes(new URL(page.url).origin)) return;
      if (s.pageUrl !== page.url) { s.pageUrl = page.url; s.navigationId = globalThis.crypto.randomUUID(); }
      const identity = JSON.stringify(page);
      if (identity !== s.lastPage) { s.lastPage = identity; this.push(s,{kind:'page',...page,navigationId:s.navigationId}); }
    } catch { s.dropped++; }
  }
  async tick() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      for (const [id,s] of this.sessions) {
        if (this.active(s)) await this.sample(s);
        else if (this.now() > s.expiresAt + 300000) this.sessions.delete(id);
      }
    } finally { this.sampling = false; }
  }
  async call(action, data) {
    if (!Number.isSafeInteger(data.tabId) || !/^[a-f0-9]{64}$/.test(data.owner || '')) throw fault('INVALID_ARGUMENT');
    let s;
    if (action === 'capture_start') {
      const options = validateOptions(data.options);
      const tab = await this.api.tabs.get(data.tabId);
      if (tab.incognito !== false) throw fault('PRIVATE_TAB_UNSUPPORTED');
      if (!options.origins.includes(new URL(tab.url).origin)) throw fault('CAPTURE_SCOPE_INVALID');
      s = [...this.sessions.values()].find(v => v.tabId === data.tabId && v.owner === data.owner);
      if (s && JSON.stringify(s.options) !== JSON.stringify(options)) throw fault('CAPTURE_SCOPE_INVALID');
      // Resuming a retained session must obey the same tab exclusivity as a new one.
      if ([...this.sessions.values()].some(v => v !== s && v.tabId === data.tabId && this.active(v))) throw fault('CAPTURE_LIMIT');
      if (!s) {
        if (this.sessions.size >= 8) throw fault('CAPTURE_LIMIT');
        s = {id:globalThis.crypto.randomUUID(),tabId:data.tabId,owner:data.owner,options,events:[],bytes:0,seq:0,ackedSeq:0,dropped:0,readSeq:0,diagnostics:{requestsSeen:0,requestsMatched:0,privacyRejected:0,scopeRejected:0,filterErrors:0},pageUrl:tab.url,navigationId:globalThis.crypto.randomUUID()};
        this.sessions.set(s.id,s);
      }
      s.active = true; s.expiresAt = this.now() + options.ttlMs;
      this.sample(s).catch(() => { s.dropped++; });
    } else {
      s = this.sessions.get(data.sessionId);
      if (!s || s.tabId !== data.tabId || s.owner !== data.owner) throw fault('CAPTURE_NOT_FOUND');
    }
    if (action === 'capture_stop') this.stop(s);
    if (action === 'capture_ack') {
      if (!Number.isSafeInteger(data.throughSeq) || data.throughSeq < s.ackedSeq || data.throughSeq > s.readSeq) throw fault('CAPTURE_ACK_INVALID');
      s.ackedSeq = data.throughSeq;
      s.events = s.events.filter(v => { if (v.event.sequence <= s.ackedSeq) { s.bytes -= v.size; return false; } return true; });
    }
    if (action === 'capture_read') {
      const after = data.afterSeq ?? s.ackedSeq, limit = data.limit ?? 20, max = data.maxBytes ?? 3145728;
      if (!Number.isSafeInteger(after) || after < 0 || after > s.readSeq || !Number.isSafeInteger(limit) || limit < 1 || limit > 256 || !Number.isSafeInteger(max) || max < 1024 || max > 4194304) throw fault('INVALID_ARGUMENT');
      const events = []; let size = 0, oversizedEvent = false;
      for (const item of s.events.filter(v => v.event.sequence > after)) {
        if (size + item.size > max) { oversizedEvent = !events.length; break; }
        if (events.length >= limit) break;
        size += item.size; events.push(item.event);
      }
      // Never let a dropped tail cursor skip a queued, unread event.
      const cursor = events.at(-1)?.sequence ?? (s.events.some(v => v.event.sequence > after) ? after : s.seq);
      s.readSeq = Math.max(s.readSeq,cursor);
      return {...this.status(s),events,seq:cursor,oversizedEvent};
    }
    return this.status(s);
  }
  before(d) {
    for (const s of this.sessions.values()) {
      if (!this.active(s) || d.tabId !== s.tabId) continue;
      const diag = s.diagnostics;
      diag.requestsSeen++;
      if (d.incognito !== false) { diag.privacyRejected++; continue; }
      if (d.frameId !== 0 || !s.options.urlPatterns.some(p => patternMatches(p,d.url))) continue;
      diag.requestsMatched++;
      // A top-level navigation belongs to its destination document. Its
      // initiator can be an extension or about:blank, which is not the page
      // whose response is being observed. Subresources retain document scope.
      const documentUrl = d.type === 'main_frame' ? d.url : d.documentUrl || s.pageUrl;
      try { if (!s.options.origins.includes(new URL(documentUrl).origin)) { diag.scopeRejected++; continue; } } catch { diag.scopeRejected++; continue; }
      if (s.pageUrl !== documentUrl) { s.pageUrl = documentUrl; s.navigationId = globalThis.crypto.randomUUID(); }
      const r = {session:s,url:d.url,pageUrl:documentUrl,navigationId:s.navigationId,requestId:d.requestId,headers:{},statusCode:0,chunks:[],bytes:0,truncated:false};
      if (this.requests.size >= 16) { s.dropped++; continue; }
      this.requests.set(d.requestId,r);
      if (s.options.captureBodies) {
        try {
          const filter = this.api.webRequest.filterResponseData(d.requestId); r.filter = filter;
          filter.ondata = e => {
            // Pass bytes through before making bounded copies for observation.
            filter.write(e.data);
            const chunk = new Uint8Array(e.data);
            const inFlight = [...this.requests.values()].reduce((n,v) => n + v.bytes,0);
            const remaining = Math.max(0,Math.min(s.options.maxBodyBytes - r.bytes,16777216 - inFlight));
            if (remaining > 0) { const part = chunk.slice(0,remaining); r.chunks.push(part); r.bytes += part.length; }
            if (chunk.length > remaining) { r.truncated = true; filter.disconnect(); this.finish(d.requestId); }
          };
          filter.onstop = () => { filter.close(); this.finish(d.requestId); };
          filter.onerror = () => this.finish(d.requestId,true);
        } catch { r.truncated = true; s.diagnostics.filterErrors++; }
      }
    }
  }
  headers(d) {
    const r = this.requests.get(d.requestId); if (!r) return;
    if (Number.isInteger(d.statusCode)) r.statusCode = d.statusCode;
    for (const h of d.responseHeaders || []) if (['content-type','content-length','content-range','accept-ranges'].includes(h.name.toLowerCase())) r.headers[h.name.toLowerCase()] = String(h.value).slice(0,1024);
    if (r.bodyFinished) this.finish(d.requestId);
  }
  finish(id,failed = false) {
    const r = this.requests.get(id); if (!r) return;
    r.bodyFinished = true;
    if (!failed && !r.statusCode) return; // Firefox may dispatch body EOF before header metadata.
    this.requests.delete(id);
    const data = new Uint8Array(r.bytes); let offset = 0;
    for (const chunk of r.chunks) { data.set(chunk,offset); offset += chunk.length; }
    let binary = '';
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i,i+8192));
    this.push(r.session,{kind:'response',url:r.url,requestId:r.requestId,pageUrl:r.pageUrl,navigationId:r.navigationId,statusCode:r.statusCode,headers:r.headers,body:{encoding:'base64',data:btoa(binary),truncated:r.truncated || failed}});
  }
  reset() { for (const s of this.sessions.values()) this.stop(s); this.sessions.clear(); }
  dispose() { clearInterval(this.timer); this.reset(); }
}

function createMethods(api) {
  return {
    async handleNetworkCapture(action, payload) {
      try {
        if (typeof api.webRequest?.filterResponseData !== 'function') throw fault('CAPABILITY_UNSUPPORTED');
        this.captureEngine ||= new CaptureEngine(api, (tabId,fn,args) => this._runPageInteract(tabId,fn,args));
        const result = await this.captureEngine.call(action,payload);
        this.sendMessage({type:`${action}_complete`,requestId:payload.requestId,result});
      } catch (e) { this.sendMessage({type:'error',requestId:payload.requestId,code:e.code || 'CAPTURE_FAILED',message:e.code || 'Capture failed'}); }
      finally { this.queueManager?.remove(payload.requestId); this.deduplicator?.markCompleted(payload.requestId); }
    },
  };
}
const exported = {createMethods,CaptureEngine,validateOptions,patternMatches};
if (typeof module !== 'undefined' && module.exports) module.exports = exported;
globalThis.JSEyesNetworkCaptureMethods = exported;
})();
