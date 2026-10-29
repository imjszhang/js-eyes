'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RequestQueueManager,RequestDeduplicator}=require('../extensions/shared/utils');
const messaging=require('../extensions/shared/messaging-methods');
const interactions=require('../extensions/shared/page-interact-methods');
function runtime(){
 const sent=[];
 const ctx={queueManager:new RequestQueueManager(100,1800000),deduplicator:new RequestDeduplicator(1800000)};
 Object.assign(ctx,messaging.createMethods({}),interactions.createMethods({downloads:{search:async()=>[]}}));
 ctx.sendRawMessage=m=>{sent.push(m);return true;};
 return {ctx,sent};
}
test('more than 100 completed downloads never exhaust slots',async()=>{
 const {ctx}=runtime();
 for(let i=0;i<150;i++){
  const requestId=String(i);assert.equal(ctx.queueManager.add(requestId,'list_downloads').accepted,true);
  await ctx.handleListDownloads({requestId});assert.equal(ctx.queueManager.requests.size,0);
 }
});
test('errors release slots, progress does not, transport failure still releases',()=>{
 const {ctx}=runtime();ctx.queueManager.add('a','wait_download');
 ctx.sendMessage({type:'progress',requestId:'a'});assert.equal(ctx.queueManager.requests.size,1);
 ctx.sendRawMessage=()=>false;ctx._fail('a',new Error('failed'),'DOWNLOADS_ERROR');assert.equal(ctx.queueManager.requests.size,0);
});
test('clear defaults to expired slots and explicit all reports uncertainty without payloads',()=>{
 const {ctx,sent}=runtime();ctx.queueManager.add('old','list_downloads');
 ctx.queueManager.add('active','wait_download',{secret:'never expose'});ctx.queueManager.requests.get('old').timestamp=0;
 ctx.handleQueueControl('queue_clear',{requestId:'clear'});
 assert.equal(ctx.queueManager.requests.size,1);assert.equal(sent.at(-1).result.cleared,1);
 assert.equal(JSON.stringify(sent).includes('never expose'),false);
 ctx.handleQueueControl('queue_clear',{requestId:'clear2',all:true});
 assert.equal(ctx.queueManager.requests.size,0);assert.equal(sent.at(-1).result.cleared,1);
 assert.match(sent.find(m=>m.requestId==='active').message,/may still finish/);
});
test('diagnostics and recovery remain usable with a full queue',()=>{
 const {ctx,sent}=runtime();for(let i=0;i<100;i++)ctx.queueManager.add(String(i),'wait_download');
 ctx.handleQueueControl('queue_status',{requestId:'status'});assert.equal(sent.at(-1).result.size,100);
 ctx.handleQueueControl('queue_clear',{requestId:'clear',all:true});assert.equal(ctx.queueManager.requests.size,0);
});
for (const platform of ['chrome','firefox']) {
 test(`${platform} dispatch admits recovery at capacity but retains rate/auth gates`,async()=>{
  const {ctx,sent}=runtime();
  const methods=require(`../extensions/${platform}/background/platform-server-methods`).createMethods();
  Object.assign(ctx,methods);
  for(let i=0;i<100;i++)ctx.queueManager.add(String(i),'wait_download');
  ctx.authState='authenticating';
  await ctx.handleMessage(JSON.stringify({type:'queue_status',requestId:'status'}));assert.equal(sent.length,0);
  ctx.authState='authenticated';ctx.rateLimiter={check:()=>({allowed:false,reason:'limited'})};
  await ctx.handleMessage(JSON.stringify({type:'queue_clear',requestId:'clear',all:true}));assert.equal(sent.at(-1).code,'RATE_LIMITED');assert.equal(ctx.queueManager.requests.size,100);
  ctx.rateLimiter={check:()=>({allowed:true})};
  await ctx.handleMessage(JSON.stringify({type:'queue_status',requestId:'status2'}));assert.equal(sent.at(-1).result.size,100);
  await ctx.handleMessage(JSON.stringify({type:'queue_clear',requestId:'clear2',all:true}));assert.equal(sent.at(-1).result.size,0);
 });
}
