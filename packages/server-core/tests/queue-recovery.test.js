'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const WebSocket=require('ws');
const {createServer}=require('../index');
const {BrowserAutomation}=require('../../client-sdk');
const {RequestQueueManager,RequestDeduplicator}=require('../../../extensions/shared/utils');
const messaging=require('../../../extensions/shared/messaging-methods');
const token='queue-test-authentication-0123456789';
const quiet={info(){},warn(){},error(){},debug(){}};
test('authenticated SDK/server recovery roundtrip and legacy capability refusal',{timeout:15000},async t=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const server=createServer({host:'127.0.0.1',port,token,hotReloadConfig:false,logger:quiet});await server.start();
 const ext=new WebSocket(`ws://127.0.0.1:${port}/?type=extension`,[`jse-token.${token}`],{origin:`http://127.0.0.1:${port}`});
 const ctx={queueManager:new RequestQueueManager(100,1800000),deduplicator:new RequestDeduplicator(1800000)};
 Object.assign(ctx,messaging.createMethods({}));ctx.sendRawMessage=m=>{ext.send(JSON.stringify(m));return true;};
 for(let i=0;i<100;i++)ctx.queueManager.add('old-'+i,'list_downloads');
 let extId;
 ext.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='auth_result'){extId=m.clientId;ext.send(JSON.stringify({type:'init',userAgent:'Firefox/150',capabilities:['browser.queue.manage']}));}
 else if(m.type==='queue_status'||m.type==='queue_clear')ctx.handleQueueControl(m.type,m);
 });
 const client=new BrowserAutomation(`ws://127.0.0.1:${port}`,{token,logger:quiet,defaultTimeout:2});
 t.after(async()=>{client.disconnect();ext.close();await server.stop();});await client.connect();
 for(let i=0;i<30;i++){if((await client.listClients()).some(c=>c.capabilities?.includes('queue.status')))break;await new Promise(r=>setTimeout(r,10));}
 const opts={target:extId};assert.equal((await client.getQueueStatus(opts)).size,100);
 assert.equal((await client.clearQueue({},opts)).cleared,0);
 assert.equal((await client.clearQueue({all:true},opts)).cleared,100);
 assert.equal((await client.getQueueStatus(opts)).size,0);
 ext.send(JSON.stringify({type:'init',userAgent:'Firefox/150',capabilities:[]}));
 for(let i=0;i<30;i++){if(!(await client.listClients()).some(c=>c.capabilities?.includes('queue.status')))break;await new Promise(r=>setTimeout(r,10));}
 await assert.rejects(client.getQueueStatus(opts),{code:'CAPABILITY_UNSUPPORTED'});
});

test('queue recovery rejects anonymous callers even when anonymous connections are enabled',async()=>{
 const {createState,_internal:{handleAutomationMessage}}=require('../ws-handler');
 const state=createState();const messages=[];const socket={readyState:1,send:s=>messages.push(JSON.parse(s))};
 state.automationClients.set('anon',{socket,anonymous:true});
 for(const action of ['queue_status','queue_clear']){
  await handleAutomationMessage(JSON.stringify({action,requestId:action,all:true}),'anon',socket,state);
  assert.equal(messages.at(-1).code,'AUTH_REQUIRED');
 }
 assert.equal(state.pendingResponses.size,0);
});
