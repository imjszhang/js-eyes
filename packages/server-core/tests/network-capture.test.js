'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const net = require('node:net');
const WebSocket = require('ws');
const {createServer} = require('../index');
const {BrowserAutomation} = require('../../client-sdk');
const {createState,_internal:{handleExtensionMessage}} = require('../ws-handler');
const {handleCaptureRequest} = require('../network-capture');
const token='test-capture-authentication-0123456789';
const ownerToken='a'.repeat(64);
const options={origins:['https://www.youtube.com'],urlPatterns:['https://*.googlevideo.com/*'],captureBodies:true};
const quiet={info(){},warn(){},error(){}};
function socket() {return {readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw));}};}
function fixture() {
 const state=createState(),auto=socket(),ext=socket();state.security={enforcement:'off'};state.policyGeneration=1;
 state.automationClients.set('a',{socket:auto});state.extensionClients.set('f',{socket:ext,browserName:'firefox',tabs:[{id:1,url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',incognito:false}],activeTabId:1});
 state.extensionClients.get('f').capabilities.push('browser.network.capture');
 return {state,auto,ext};
}
function message(action,extra={}) {return {type:`capture_${action}`,target:'f',requestId:'q',tabId:1,ownerToken,options,...extra};}
test('capture requires explicit Firefox feature advertisement and explicit tab privacy',async()=>{
 const {state,auto}=fixture(),browser=state.extensionClients.get('f');
 browser.capabilities=[];await handleCaptureRequest(message('start'),'a',auto,state,async()=>{});assert.equal(auto.messages.at(-1).code,'CAPABILITY_UNSUPPORTED');
 browser.capabilities=['browser.network.capture'];browser.tabs[0].incognito=undefined;
 await handleCaptureRequest(message('start'),'a',auto,state,async()=>{});assert.equal(auto.messages.at(-1).code,'PRIVACY_CAPABILITY_UNAVAILABLE');
 browser.tabs[0].incognito=true;await handleCaptureRequest(message('start'),'a',auto,state,async()=>{});assert.equal(auto.messages.at(-1).code,'PRIVATE_TAB_UNSUPPORTED');
});
test('capture grants permit authenticated reconnect and retired-tab replay, isolate owners, revoke on policy change',async()=>{
 const {state,auto}=fixture();let calls=0;
 const request=async(_browser,_action,payload)=>{calls++;assert.equal(payload.ownerToken,undefined);return {result:{sessionId:'s',events:[]}};};
 await handleCaptureRequest(message('start'),'a',auto,state,request);assert.equal(auto.messages.at(-1).status,'success');
 state.extensionClients.get('f').tabs=[];
 state.automationClients.set('b',{socket:auto});
 await handleCaptureRequest(message('read',{sessionId:'s'}),'b',auto,state,request);assert.equal(auto.messages.at(-1).status,'success');
 await handleCaptureRequest(message('read',{sessionId:'s',ownerToken:'b'.repeat(64)}),'b',auto,state,request);assert.equal(auto.messages.at(-1).code,'CAPTURE_NOT_FOUND');
 state.policyGeneration++;
 await handleCaptureRequest(message('read',{sessionId:'s'}),'b',auto,state,request);assert.equal(auto.messages.at(-1).code,'CAPTURE_NOT_FOUND');assert.equal(calls,2);
});
test('capture denies anonymous automation and out-of-task-origin reads with raw eval disabled',async()=>{
 const {state,auto}=fixture();state.automationClients.get('a').anonymous=true;
 await handleCaptureRequest(message('start'),'a',auto,state,async()=>{});assert.equal(auto.messages.at(-1).code,'AUTH_REQUIRED');
 state.automationClients.get('a').anonymous=false;state.security={enforcement:'soft',allowRawEval:false,taskOrigin:{enabled:true,sources:[]}};
 await handleCaptureRequest(message('start'),'a',auto,state,async()=>{});assert.equal(auto.messages.at(-1).code,'POLICY_SOFT_BLOCK');
});
test('legacy Firefox and Chrome never inherit network capture through init',()=>{
 const {state}=fixture();handleExtensionMessage(JSON.stringify({type:'init',userAgent:'Firefox/150'}),'f',state);
 assert.equal(state.extensionClients.get('f').capabilities.includes('browser.network.capture'),false);
 handleExtensionMessage(JSON.stringify({type:'init',userAgent:'Chrome/150',capabilities:['browser.network.capture']}),'f',state);
 assert.equal(state.extensionClients.get('f').capabilities.includes('browser.network.capture'),false);
});
test('real WebSocket SDK/server/extension roundtrip exercises all five capture calls', {timeout:15000}, async t=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const server=createServer({host:'127.0.0.1',port,token,security:require('@js-eyes/protocol').resolveSecurityConfig({security:{enforcement:'off',allowRawEval:false}}),hotReloadConfig:false,logger:quiet});await server.start();
 const ext=new WebSocket(`ws://127.0.0.1:${port}/?type=extension`,[`jse-token.${token}`],{origin:`http://127.0.0.1:${port}`});
 const calls=[];let extId;
 ext.on('message',raw=>{
  const msg=JSON.parse(raw);
  if(msg.type==='auth_result') {extId=msg.clientId;ext.send(JSON.stringify({type:'init',userAgent:'Firefox/150',capabilities:['browser.network.capture']}));}
  else if(msg.type==='init_ack')ext.send(JSON.stringify({type:'data',tabs:[{id:1,url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',incognito:false}],active_tab_id:1}));
  else if(msg.type.startsWith('capture_')) {calls.push(msg.type);assert.equal(msg.ownerToken,undefined);ext.send(JSON.stringify({type:`${msg.type}_complete`,requestId:msg.requestId,result:{sessionId:'session',active:msg.type!=='capture_stop',seq:1,events:msg.type==='capture_read'?[{kind:'page',sequence:1}]:undefined}}));}
 });
 const client=new BrowserAutomation(`ws://127.0.0.1:${port}`,{token,logger:quiet,defaultTimeout:3});
 t.after(async()=>{client.disconnect();ext.close();await server.stop();});await client.connect();
 let tabs;for(let i=0;i<10;i++){tabs=await client.getTabs();if(tabs.browsers.some(b=>b.tabs.length))break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(extId);assert.equal(tabs.browsers[0].capabilities.includes('browser.network.capture'),true);
 const opts={target:extId,ownerToken:randomBytes(32).toString('hex')};
 const started=await client.startCapture(1,options,opts);assert.equal(started.sessionId,'session');
 await client.getCaptureStatus(1,'session',opts);assert.equal((await client.readCaptureEvents(1,'session',opts)).events.length,1);
 await client.ackCaptureEvents(1,'session',1,opts);await client.stopCapture(1,'session',opts);
 assert.deepEqual(calls,['capture_start','capture_status','capture_read','capture_ack','capture_stop']);
 await assert.rejects(client.readCaptureEvents(1,'session',{...opts,ownerToken:'b'.repeat(64)}),{code:'CAPTURE_NOT_FOUND'});
});

test('an unrelated extension cannot forge capture replies or errors',()=>{
 const {state,auto}=fixture(),browser=state.extensionClients.get('f');
 const timer=setTimeout(()=>{},5000);timer.unref();
 state.pendingResponses.set('pending',{captureBrowser:browser,socket:auto,operationType:'capture_read',timeoutId:timer});
 state.extensionClients.set('other',{socket:socket(),browserName:'firefox',tabs:[]});
 handleExtensionMessage(JSON.stringify({type:'capture_read_complete',requestId:'pending',result:{events:['forged']}}),'other',state);
 handleExtensionMessage(JSON.stringify({type:'error',requestId:'pending',code:'FORGED'}),'other',state);
 handleExtensionMessage(JSON.stringify({type:'execute_script_complete',requestId:'pending',result:'forged'}),'other',state);
 assert.equal(auto.messages.length,0);assert.ok(state.pendingResponses.has('pending'));
 handleExtensionMessage(JSON.stringify({type:'capture_read_complete',requestId:'pending',result:{events:[]}}),'f',state);
 assert.equal(auto.messages[0].status,'success');assert.equal(state.pendingResponses.has('pending'),false);
 clearTimeout(timer);
});
