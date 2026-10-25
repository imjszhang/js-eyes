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
function response(f,id='r',bytes='1234') {
 f.listeners.before({requestId:id,tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback?range=0-3',documentUrl:'https://www.youtube.com/watch?v=AAAAAAAAAAA'});
 f.listeners.headers({requestId:id,statusCode:206,responseHeaders:[{name:'Content-Range',value:'bytes 0-3/8'},{name:'Set-Cookie',value:'secret'}]});
 const filter=f.filters.get(id);filter.ondata({data:Uint8Array.from(Buffer.from(bytes)).buffer});if(!filter.disconnected)filter.onstop();
}
test('capture preserves browser bytes and exposes only bounded selected response headers',async t => {
 const f=fixture(t),s=await start(f.engine);response(f);
 const batch=await f.engine.call('capture_read',payload(s));
 assert.equal(batch.events[0].kind,'page');assert.equal(batch.events[1].headers['content-range'],'bytes 0-3/8');
 assert.equal(batch.events[1].headers['set-cookie'],undefined);assert.equal(Buffer.from(batch.events[1].body.data,'base64').toString(),'1234');
 assert.equal(Buffer.concat(f.writes).toString(),'1234');
 assert.deepEqual((await f.engine.call('capture_read',payload(s))).events,batch.events);
 await f.engine.call('capture_ack',payload(s,{throughSeq:batch.seq}));assert.equal((await f.engine.call('capture_read',payload(s))).events.length,0);
});
test('capture truncates oversized bodies while passing their full bytes to Firefox',async t => {
 const f=fixture(t),s=await start(f.engine);response(f,'r','0123456789');
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
  response(f);
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
 const f=fixture(t),s=await start(f.engine);response(f);
 await assert.rejects(f.engine.call('capture_ack',payload(s,{throughSeq:2})),{code:'CAPTURE_ACK_INVALID'});
 const first=await f.engine.call('capture_read',payload(s,{limit:1}));assert.equal(first.seq,1);
 await assert.rejects(f.engine.call('capture_ack',payload(s,{throughSeq:2})),{code:'CAPTURE_ACK_INVALID'});
});
test('overflow preserves queued events and reports a dropped tail cursor after draining',async t => {
 const f=fixture(t),s=await start(f.engine,{maxEvents:1});response(f);
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
 f.listeners.before({requestId:'private',tabId:1,frameId:0,incognito:true,url:'https://rr1.googlevideo.com/videoplayback'});
 assert.equal(f.filters.has('private'),false);
 f.listeners.before({requestId:'broken',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 f.listeners.error({requestId:'broken'});
 const batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events[1].body.truncated,true);
});

test('top-level navigation is scoped to destination, never the extension initiator',async t=>{
 const f=fixture(t),s=await start(f.engine,{urlPatterns:['https://www.youtube.com/robots.txt*']});
 f.listeners.before({requestId:'navigation',type:'main_frame',tabId:1,frameId:0,incognito:false,url:'https://www.youtube.com/robots.txt?test=1',originUrl:'moz-extension://local/background.html'});
 assert.equal(f.filters.has('navigation'),true);
 f.filters.get('navigation').ondata({data:Uint8Array.from(Buffer.from('robots')).buffer});f.filters.get('navigation').onstop();f.listeners.headers({requestId:'navigation',statusCode:200});
 const b=await f.engine.call('capture_read',payload(s));assert.equal(b.events[1].pageUrl,'https://www.youtube.com/robots.txt?test=1');
});

test('response EOF waits for late Firefox header metadata',async t=>{
 const f=fixture(t),s=await start(f.engine);
 f.listeners.before({requestId:'late-headers',tabId:1,frameId:0,incognito:false,url:'https://rr1.googlevideo.com/videoplayback'});
 const filter=f.filters.get('late-headers');filter.ondata({data:Uint8Array.from(Buffer.from('bytes')).buffer});filter.onstop();
 let batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events.filter(e=>e.kind==='response').length,0);
 f.listeners.headers({requestId:'late-headers',statusCode:206,responseHeaders:[{name:'Content-Range',value:'bytes 0-4/5'}]});
 batch=await f.engine.call('capture_read',payload(s));assert.equal(batch.events[1].statusCode,206);assert.equal(batch.events[1].headers['content-range'],'bytes 0-4/5');
});
