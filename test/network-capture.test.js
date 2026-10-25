'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {CaptureEngine,validateOptions,patternMatches} = require('../extensions/shared/network-capture-methods');
const options = {origins:['https://www.youtube.com'],urlPatterns:['https://*.googlevideo.com/*','https://www.youtube.com/youtubei/*'],captureBodies:true,maxBodyBytes:8,maxBufferBytes:4096,maxEvents:8,ttlMs:1000,page:{selectors:[{name:'player',selector:'#movie_player',properties:['className']}]}};
const owner = 'a'.repeat(64);
function fixture(t) {
 const listeners = {}, filters = new Map(), writes = [];
 let now = 10000, tab = {id:1,url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',incognito:false};
 const event = name => ({addListener(fn) {listeners[name]=fn;}});
 const api = {tabs:{get:async () => tab,onRemoved:event('removed')},webRequest:{onBeforeRequest:event('before'),onHeadersReceived:event('headers'),onBeforeRedirect:event('redirect'),onCompleted:event('completed'),onErrorOccurred:event('error'),filterResponseData(id) {
  const f = {write(data) {writes.push(Buffer.from(data));},disconnect() {f.disconnected=true;},close() {f.closed=true;}}; filters.set(id,f);return f;
 }}};
 const engine = new CaptureEngine(api,async () => ({url:tab.url,values:{player:[{properties:{className:'ad-showing'}}]}}),{now:() => now});
 t.after(() => engine.dispose());
 return {engine,listeners,filters,writes,setTab:v => {tab=v;},advance:ms => {now+=ms;}};
}
async function start(engine, extra={}) {const result=await engine.call('capture_start',{tabId:1,owner,options:{...options,...extra}});await new Promise(setImmediate);return result;}
function payload(s,extra={}) {return {tabId:1,owner,sessionId:s.sessionId,...extra};}
async function response(f,id='r',bytes='1234') {
 await f.listeners.before({requestId:id,tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback?range=0-3',documentUrl:'https://www.youtube.com/watch?v=AAAAAAAAAAA'});
 f.listeners.headers({requestId:id,statusCode:206,responseHeaders:[{name:'Content-Range',value:'bytes 0-3/8'},{name:'Set-Cookie',value:'secret'}]});
 const filter=f.filters.get(id);filter.ondata({data:Uint8Array.from(Buffer.from(bytes)).buffer});if(!filter.disconnected)filter.onstop();
}
test('capture preserves browser bytes and exposes only bounded selected response headers',async t => {
 const f=fixture(t),s=await start(f.engine);await response(f);
 const batch=await f.engine.call('capture_read',payload(s));
 assert.equal(batch.events[0].kind,'page');assert.equal(batch.events[1].headers['content-range'],'bytes 0-3/8');
 assert.equal(batch.events[1].headers['set-cookie'],undefined);assert.equal(Buffer.from(batch.events[1].body.data,'base64').toString(),'1234');
 assert.equal(Buffer.concat(f.writes).toString(),'1234');
 assert.deepEqual((await f.engine.call('capture_read',payload(s))).events,batch.events);
 await f.engine.call('capture_ack',payload(s,{throughSeq:batch.seq}));assert.equal((await f.engine.call('capture_read',payload(s))).events.length,0);
});
test('capture truncates oversized bodies while passing their full bytes to Firefox',async t => {
 const f=fixture(t),s=await start(f.engine);await response(f,'r','0123456789');
 const b=await f.engine.call('capture_read',payload(s));assert.equal(b.events[1].body.truncated,true);
 assert.equal(Buffer.from(b.events[1].body.data,'base64').length,8);assert.equal(Buffer.concat(f.writes).length,10);assert.equal(f.filters.get('r').disconnected,true);
});
test('private tabs and unknown privacy never create a session',async t => {
 const f=fixture(t);for(const incognito of [true,undefined]) {f.setTab({id:1,url:'https://www.youtube.com',incognito});await assert.rejects(start(f.engine),{code:'PRIVATE_TAB_UNSUPPORTED'});}assert.equal(f.engine.sessions.size,0);
});
test('owner and tab isolation survive stop and queued events remain replayable',async t => {
 const f=fixture(t),s=await start(f.engine);
 await assert.rejects(f.engine.call('capture_read',payload(s,{owner:'b'.repeat(64)})),{code:'CAPTURE_NOT_FOUND'});
 await assert.rejects(f.engine.call('capture_read',payload(s,{tabId:2})),{code:'CAPTURE_NOT_FOUND'});
 await f.engine.call('capture_stop',payload(s));assert.equal((await f.engine.call('capture_read',payload(s))).events.length,1);
 const resumed=await start(f.engine);assert.equal(resumed.sessionId,s.sessionId);
});
for (const retirement of ['stop', 'expiry']) {
 test(`resuming after ${retirement} cannot steal an active owner's tab`, async t => {
  const f = fixture(t), a = await start(f.engine);
  const original = await f.engine.call('capture_read', payload(a));
  if (retirement === 'stop') await f.engine.call('capture_stop', payload(a));
  else f.advance(1001);
  const otherOwner = 'b'.repeat(64);
  const b = await f.engine.call('capture_start', {tabId:1,owner:otherOwner,options});
  await assert.rejects(start(f.engine), {code:'CAPTURE_LIMIT'});
  assert.equal((await f.engine.call('capture_status', payload(a))).active, false);
  assert.equal((await f.engine.call('capture_status', payload(b,{owner:otherOwner}))).active, true);
  await response(f);
  const captured = await f.engine.call('capture_read', payload(b,{owner:otherOwner}));
  assert.equal(captured.events.filter(e => e.kind === 'response').length, 1);
  assert.equal(Buffer.concat(f.writes).toString(), '1234');
  assert.deepEqual((await f.engine.call('capture_read', payload(a))).events, original.events);
  await f.engine.call('capture_stop', payload(b,{owner:otherOwner}));
  const resumed = await start(f.engine);
  assert.equal(resumed.sessionId, a.sessionId);
  assert.equal(resumed.active, true);
  assert.equal((await start(f.engine)).sessionId, a.sessionId);
 });
}
test('TTL and leaving authorized origin stop observation, reset revokes all stored bodies',async t => {
 const f=fixture(t),s=await start(f.engine);f.advance(1001);assert.equal((await f.engine.call('capture_status',payload(s))).active,false);
 await start(f.engine);f.setTab({id:1,url:'https://example.com',incognito:false});await f.engine.tick();assert.equal((await f.engine.call('capture_status',payload(s))).active,false);
 f.engine.reset();await assert.rejects(f.engine.call('capture_read',payload(s)),{code:'CAPTURE_NOT_FOUND'});
});
test('ACK cannot discard unread queued events and an oversized first event cannot advance cursor',async t => {
 const f=fixture(t),s=await start(f.engine);await response(f);
 await assert.rejects(f.engine.call('capture_ack',payload(s,{throughSeq:2})),{code:'CAPTURE_ACK_INVALID'});
 const first=await f.engine.call('capture_read',payload(s,{limit:1}));assert.equal(first.seq,1);
 await assert.rejects(f.engine.call('capture_ack',payload(s,{throughSeq:2})),{code:'CAPTURE_ACK_INVALID'});
});
test('overflow preserves queued events and reports a dropped tail cursor after draining',async t => {
 const f=fixture(t),s=await start(f.engine,{maxEvents:1});await response(f);
 const first=await f.engine.call('capture_read',payload(s));assert.equal(first.dropped,1);assert.equal(first.seq,1);
 await f.engine.call('capture_ack',payload(s,{throughSeq:1}));const tail=await f.engine.call('capture_read',payload(s,{afterSeq:1}));assert.equal(tail.seq,2);
 await f.engine.call('capture_ack',payload(s,{throughSeq:2}));
});
test('capture rejects script-like options and restricts HTTPS URL patterns',() => {
 assert.throws(() => validateOptions({...options,page:{selectors:[{name:'x',selector:'video',properties:['innerHTML']}]}}),{code:'CAPTURE_SCOPE_INVALID'});
 assert.throws(() => validateOptions({...options,code:'alert(1)'}),{code:'CAPTURE_SCOPE_INVALID'});
 for(const url of ['http://rr1.googlevideo.com/a','https://googlevideo.com.evil/a','https://evil.com/a'])assert.equal(patternMatches('https://*.googlevideo.com/*',url),false);
 assert.equal(patternMatches('https://*.googlevideo.com/*','https://rr1.googlevideo.com/a?q=1'),true);
});

test('Firefox fallback discovery preserves an explicit local service port',()=>{
 const methods=require('../extensions/firefox/background/platform-connection-methods').createMethods();
 const instance={serverUrl:'http://127.0.0.1:18081',defaultServerUrl:'http://localhost:18080',defaultServerUrls:['ws://localhost:18080'],httpBaseUrl:'http://127.0.0.1:18081'};
 methods._applyFallbackDiscovery.call(instance);assert.equal(instance.serverUrl,'ws://127.0.0.1:18081');
});

test('starting capture never waits for a loading page injection',async t=>{
 const f=fixture(t);f.engine.runPage=()=>new Promise(()=>{});
 const result=await start(f.engine);assert.equal(result.active,true);
 assert.ok(f.engine.sessions.get(result.sessionId).samplePending);
});

test('oversized unread event cannot advance read or ACK cursor',async t=>{
 const f=fixture(t),s=await start(f.engine);
 f.engine.push(f.engine.sessions.get(s.sessionId),{kind:'response',body:{data:'x'.repeat(2000)}});
 const first=await f.engine.call('capture_read',payload(s,{limit:1}));assert.equal(first.seq,1);
 const blocked=await f.engine.call('capture_read',payload(s,{afterSeq:1,maxBytes:1024}));
 assert.equal(blocked.oversizedEvent,true);assert.equal(blocked.seq,1);assert.equal(blocked.events.length,0);
 await assert.rejects(f.engine.call('capture_read',payload(s,{afterSeq:2})),{code:'INVALID_ARGUMENT'});
 await assert.rejects(f.engine.call('capture_ack',payload(s,{throughSeq:2})),{code:'CAPTURE_ACK_INVALID'});
});
test('request errors retain partial evidence and explicit private requests never attach filters',async t=>{
 const f=fixture(t),s=await start(f.engine);
 await f.listeners.before({requestId:'private',tabId:1,frameId:0,incognito:true,url:'https://rr1.googlevideo.com/videoplayback'});
 assert.equal(f.filters.has('private'),false);
 await f.listeners.before({requestId:'broken',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 f.listeners.error({requestId:'broken'});
 const batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events[1].body.truncated,true);
});

test('top-level navigation is scoped to destination, never the extension initiator',async t=>{
 const f=fixture(t),s=await start(f.engine,{urlPatterns:['https://www.youtube.com/robots.txt*']});
 await f.listeners.before({requestId:'navigation',type:'main_frame',tabId:1,frameId:0,incognito:false,url:'https://www.youtube.com/robots.txt?test=1',originUrl:'moz-extension://local/background.html'});
 assert.equal(f.filters.has('navigation'),true);
 f.filters.get('navigation').ondata({data:Uint8Array.from(Buffer.from('robots')).buffer});f.filters.get('navigation').onstop();f.listeners.headers({requestId:'navigation',statusCode:200});
 const b=await f.engine.call('capture_read',payload(s));assert.equal(b.events[1].pageUrl,'https://www.youtube.com/robots.txt?test=1');
});

test('response EOF waits for late Firefox header metadata',async t=>{
 const f=fixture(t),s=await start(f.engine);
 await f.listeners.before({requestId:'late-headers',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 const filter=f.filters.get('late-headers');filter.ondata({data:Uint8Array.from(Buffer.from('bytes')).buffer});filter.onstop();
 let batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events.filter(e=>e.kind==='response').length,0);
 f.listeners.headers({requestId:'late-headers',statusCode:206,responseHeaders:[{name:'Content-Range',value:'bytes 0-4/5'}]});
 batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events[1].statusCode,206);assert.equal(batch.events[1].headers['content-range'],'bytes 0-4/5');
});

test('origin-only request document URLs cannot churn SPA navigation or detach responses',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 const initialNavigation=session.navigationId;
 for(const requestId of ['root-document-1','root-document-2']){
  await f.listeners.before({requestId,type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback',documentUrl:'https://www.youtube.com/'});
  f.listeners.headers({requestId,statusCode:200});f.filters.get(requestId).onstop();await f.engine.sample(session);
 }
 const batch=await f.engine.call('capture_read',payload(s));
 assert.equal(session.navigationId,initialNavigation);
 for(const e of batch.events){assert.equal(e.navigationId,initialNavigation);assert.equal(e.pageUrl||e.url,'https://www.youtube.com/watch?v=AAAAAAAAAAA');}
 assert.equal(batch.events.filter(e=>e.kind==='page').length,1);
});
test('live tab navigation separates old in-flight responses before the next page sample',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 const before=async requestId=>f.listeners.before({requestId,type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback',documentUrl:'https://www.youtube.com/'});
 await before('old');const oldNavigation=session.navigationId;
 f.setTab({id:1,url:'https://www.youtube.com/watch?v=BBBBBBBBBBB',incognito:false});
 await before('new');const newNavigation=session.navigationId;assert.notEqual(newNavigation,oldNavigation);
 for(const requestId of ['old','new']){f.listeners.headers({requestId,statusCode:200});f.filters.get(requestId).onstop();}
 await f.engine.sample(session);
 const batch=await f.engine.call('capture_read',payload(s));
 assert.equal(batch.events.find(e=>e.requestId==='old').navigationId,oldNavigation);
 assert.equal(batch.events.find(e=>e.requestId==='new').navigationId,newNavigation);
 assert.equal(batch.events.at(-1).navigationId,newNavigation);
 assert.equal(batch.events.find(e=>e.requestId==='new').pageUrl,'https://www.youtube.com/watch?v=BBBBBBBBBBB');
});
test('unmatched top-level reload still advances identity; requests cannot capture another origin or private tab',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId),old=session.navigationId;
 await f.listeners.before({requestId:'reload',type:'main_frame',tabId:1,frameId:0,incognito:false,url:session.pageUrl});
 assert.notEqual(session.navigationId,old);assert.equal(f.filters.has('reload'),false);
 await f.listeners.before({requestId:'foreign',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback',documentUrl:'https://example.org/'});
 assert.equal(f.filters.has('foreign'),false);
 f.setTab({id:1,url:session.pageUrl,incognito:true});
 await f.listeners.before({requestId:'private-now',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 assert.equal(f.filters.has('private-now'),false);
});

test('late page sampling cannot roll navigation identity back after a new request',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 let resolvePage;f.engine.runPage=()=>new Promise(resolve=>{resolvePage=resolve;});
 const pending=f.engine.sample(session);await new Promise(setImmediate);
 f.setTab({id:1,url:'https://www.youtube.com/watch?v=BBBBBBBBBBB',incognito:false});
 await f.listeners.before({requestId:'spa-new',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback',documentUrl:'https://www.youtube.com/'});
 const navigation=session.navigationId;
 resolvePage({url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',values:{}});await pending;
 assert.equal(session.navigationId,navigation);assert.equal(session.pageUrl,'https://www.youtube.com/watch?v=BBBBBBBBBBB');
});
test('a late request from another allowed origin cannot attach to the new page',async t=>{
 const f=fixture(t),s=await start(f.engine,{origins:['https://www.youtube.com','https://example.org']});
 f.setTab({id:1,url:'https://example.org/new',incognito:false});
 await f.listeners.before({requestId:'other-document',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback',documentUrl:'https://www.youtube.com/'});
 assert.equal(f.filters.has('other-document'),false);
 assert.equal((await f.engine.call('capture_status',payload(s))).diagnostics.scopeRejected,1);
});

test('a pending request lookup cannot cross a stop and resume boundary',async t=>{
 const f=fixture(t),s=await start(f.engine);
 const getTab=f.engine.api.tabs.get;
 let resolveTab;
 f.engine.api.tabs.get=()=>new Promise(resolve=>{resolveTab=resolve;});
 const pending=f.listeners.before({requestId:'before-stop',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 await f.engine.call('capture_stop',payload(s));
 f.engine.api.tabs.get=getTab;
 await start(f.engine);
 resolveTab(await getTab());await pending;
 assert.equal(f.filters.has('before-stop'),false);
 assert.equal(f.engine.requests.size,0);
 await response(f,'after-resume');
 const batch=await f.engine.call('capture_read',payload(s));
 assert.deepEqual(batch.events.filter(e=>e.kind==='response').map(e=>e.requestId),['after-resume']);
});

test('an out-of-order tab lookup cannot roll a newer navigation back',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 const getTab=f.engine.api.tabs.get,oldTab=await getTab();
 let resolveTab;
 f.engine.api.tabs.get=()=>new Promise(resolve=>{resolveTab=resolve;});
 const pending=f.listeners.before({requestId:'stale-lookup',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 f.engine.api.tabs.get=getTab;
 f.setTab({id:1,url:'https://www.youtube.com/watch?v=BBBBBBBBBBB',incognito:false});
 await response(f,'new-page');
 const navigation=session.navigationId;
 resolveTab(oldTab);await pending;
 assert.equal(session.navigationId,navigation);
 assert.equal(session.pageUrl,'https://www.youtube.com/watch?v=BBBBBBBBBBB');
 assert.equal(f.filters.has('stale-lookup'),false);
});

test('pending request lookup cannot migrate into a new session after reset',async t=>{
 const f=fixture(t);await start(f.engine);
 const getTab=f.engine.api.tabs.get;
 let resolveTab;
 f.engine.api.tabs.get=()=>new Promise(resolve=>{resolveTab=resolve;});
 const pending=f.listeners.before({requestId:'before-reset',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 f.engine.reset();f.engine.api.tabs.get=getTab;
 await start(f.engine);
 resolveTab(await getTab());await pending;
 assert.equal(f.filters.has('before-reset'),false);
 assert.equal(f.engine.requests.size,0);
});

test('a page sample from before stop cannot change a resumed session',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 let resolvePage;f.engine.runPage=()=>new Promise(resolve=>{resolvePage=resolve;});
 const pending=f.engine.sample(session);await new Promise(setImmediate);
 await f.engine.call('capture_stop',payload(s));await start(f.engine);
 const navigation=session.navigationId;
 resolvePage({url:'https://www.youtube.com/watch?v=OLDOLDOLD00',values:{}});await pending;
 assert.equal(session.navigationId,navigation);
 assert.equal(session.pageUrl,'https://www.youtube.com/watch?v=AAAAAAAAAAA');
 assert.equal((await f.engine.call('capture_read',payload(s))).events.length,1);
});

test('pending request lookups do not attach to a same-URL reload',async t=>{
 const f=fixture(t),s=await start(f.engine),session=f.engine.sessions.get(s.sessionId);
 const getTab=f.engine.api.tabs.get,oldTab=await getTab();
 let resolveTab;
 f.engine.api.tabs.get=()=>new Promise(resolve=>{resolveTab=resolve;});
 const pending=f.listeners.before({requestId:'before-reload',type:'xmlhttprequest',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 f.engine.api.tabs.get=getTab;
 await f.listeners.before({requestId:'reload',type:'main_frame',tabId:1,frameId:0,incognito:false,url:oldTab.url});
 const navigation=session.navigationId;
 resolveTab(oldTab);await pending;
 assert.equal(session.navigationId,navigation);
 assert.equal(f.filters.has('before-reload'),false);
});

test('concurrent requests resolving the same new SPA page retain both responses',async t=>{
 const f=fixture(t),s=await start(f.engine);
 f.setTab({id:1,url:'https://www.youtube.com/watch?v=BBBBBBBBBBB',incognito:false});
 await Promise.all([response(f,'concurrent-1'),response(f,'concurrent-2')]);
 const batch=await f.engine.call('capture_read',payload(s));
 const responses=batch.events.filter(e=>e.kind==='response');
 assert.equal(responses.length,2);
 assert.equal(responses[0].navigationId,responses[1].navigationId);
 assert.ok(responses.every(e=>e.pageUrl==='https://www.youtube.com/watch?v=BBBBBBBBBBB'));
});
