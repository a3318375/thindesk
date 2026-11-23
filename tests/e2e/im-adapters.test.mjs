import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCipheriv } from 'node:crypto';
import { TelegramAdapter } from '../../server/im/telegram.ts';
import { WeixinAdapter, weixinMediaKey } from '../../server/im/weixin.ts';
import { QqAdapter, qqInbound } from '../../server/im/qq.ts';
import { ApiError } from '@tencent-connect/qqbot-nodejs';
const config=(channel,baseUrl)=>({id:channel,channel,enabled:true,credentials:{token:'LOCAL_TOKEN',appId:'LOCAL_APP',appSecret:'LOCAL_SECRET',baseUrl}});
const outbound=(context)=>({id:'stable-id',bot:'test',route:'r',sessionId:'s',messageId:'reply',text:'网页同步答案',context,part:0,sequence:42});
async function fixture(handler){
 const server=createServer((req,res)=>{void(async()=>{const parts=[];for await(const part of req)parts.push(part);await handler(req,res,parts.length?JSON.parse(Buffer.concat(parts).toString()):{});})().catch(error=>{res.writeHead(500);res.end(String(error));});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {url:'http://127.0.0.1:'+server.address().port,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
const json=(res,body)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));};
test('Telegram 真实 Bot API 适配在本地服务收图、确认游标并发送网页回答',async()=>{
 const calls=[],incoming=[],cursors=[],abort=new AbortController();
 const http=await fixture((req,res,body)=>{
  calls.push({url:req.url,body});
  if(req.url.endsWith('/getMe'))return json(res,{ok:true,result:{id:77,username:'ThinDeskTest'}});
  if(req.url.endsWith('/getUpdates'))return json(res,{ok:true,result:[{update_id:9,message:{message_id:8,date:1,chat:{id:10,type:'private'},from:{id:11,first_name:'测试'},caption:'查看图片',photo:[{file_id:'image'}]}}]});
  if(req.url.endsWith('/getFile'))return json(res,{ok:true,result:{file_path:'photos/test.png'}});
  if(req.url.includes('/file/'))return res.end(Buffer.from('LOCAL_IMAGE'));
  if(req.url.endsWith('/sendMessage'))return json(res,{ok:true,result:{message_id:99}});
  throw Error('unexpected local endpoint');
 });
 const events={state(){},cursor:value=>cursors.push(value),async receive(message){incoming.push(message);abort.abort();}};
 const adapter=new TelegramAdapter(config('Telegram',http.url),events,'');
 try{
  await adapter.start(abort.signal);assert.equal(incoming.length,1);assert.equal(incoming[0].files[0].bytes.toString(),'LOCAL_IMAGE');assert.equal(incoming[0].context.chatId,'10');assert.deepEqual(cursors,['10']);
  const sender=new TelegramAdapter(config('Telegram',http.url),events,'');
  assert.equal(await sender.send(outbound(incoming[0].context)),'99');sender.close();
  assert.equal(calls.find(item=>item.url.endsWith('/sendMessage')).body.text,'网页同步答案');
 }finally{abort.abort();adapter.close();await http.close();}
});
test('微信真实 iLink 适配在本地解密附件、保存游标，并用原回复凭据回传',async()=>{
 const key=Buffer.alloc(16,7),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(Buffer.from('WECHAT_IMAGE')),cipher.final()]);
 const received=[],cursors=[],sent=[],abort=new AbortController();let base;
 const http=await fixture((req,res,body)=>{
  if(req.url==='/media')return res.end(encrypted);
  if(req.url.endsWith('/getupdates'))return json(res,{ret:0,get_updates_buf:'next-cursor',msgs:[{message_id:'wx-1',message_type:1,from_user_id:'wx-user',context_token:'REPLY_CONTEXT',item_list:[{type:1,text_item:{text:'微信问题'}},{type:2,image_item:{media:{full_url:base+'/media',aes_key:Buffer.from(key.toString('hex')).toString('base64')}}}]}]});
  if(req.url.endsWith('/sendmessage')){sent.push({body,auth:req.headers.authorization});return json(res,{ret:0});}
  throw Error('unexpected local endpoint');
 });base=http.url;
 const adapter=new WeixinAdapter(config('微信',base),{state(){},cursor:value=>cursors.push(value),async receive(message){received.push(message);abort.abort();}},'');
 try{
  await adapter.start(abort.signal);assert.equal(received[0].files[0].bytes.toString(),'WECHAT_IMAGE');assert.deepEqual(cursors,['next-cursor']);
  const sender=new WeixinAdapter(config('微信',base),{state(){},cursor(){},async receive(){}},'');
  await sender.send(outbound(received[0].context));sender.close();
  assert.equal(sent[0].body.msg.context_token,'REPLY_CONTEXT');assert.equal(sent[0].body.msg.client_id,'thindesk-stable-id');assert.equal(sent[0].body.msg.item_list[0].text_item.text,'网页同步答案');assert.equal(sent[0].auth,'Bearer LOCAL_TOKEN');
  assert.throws(()=>weixinMediaKey({media:{aes_key:'bad'}}));
 }finally{abort.abort();adapter.close();await http.close();}
});
test('QQ 官方 SDK 适配过滤群非 @ 消息，Markdown 明确拒绝后才降级文本',async()=>{
 const handlers={},sends=[],abort=new AbortController(),received=[];
 let rejectMarkdown=true;
 const sdk={on(name,fn){handlers[name]=fn;},async start(signal){handlers.ready();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));},stop(){},async send(options){sends.push(options);if(rejectMarkdown&&options.msgType===2){rejectMarkdown=false;throw new ApiError('no markdown',400,'/messages',123);}return{id:'qq-sent'};},async sendTyping(){}};
 const adapter=new QqAdapter(config('QQ'),{state(){},cursor(){},async receive(message){received.push(message);}},()=>sdk);
 const running=adapter.start(abort.signal);
 try{
  const message={kind:'c2c',rawEventType:'C2C_MESSAGE_CREATE',senderId:'user',senderName:'测试QQ',messageId:'qq-in',timestamp:new Date().toISOString(),content:'QQ问题',replyTarget:{scope:'c2c',targetId:'user',msgId:'qq-in'}};
  handlers.message({},message);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(received.length,1);
  assert.equal(qqInbound({...message,kind:'group',rawEventType:'GROUP_MESSAGE_CREATE'}),null);
  assert.equal(await adapter.send(outbound(received[0].context)),'qq-sent');assert.deepEqual(sends.map(item=>item.msgType),[2,0]);assert.equal(sends[0].extra.msg_seq,42);assert.equal(sends[0].target.msgId,'qq-in');
  sdk.send=async()=>{throw Error('unknown network outcome');};await assert.rejects(adapter.send(outbound(received[0].context)),error=>error.uncertain===true);
 }finally{abort.abort();adapter.close();await running;}
});

test('发送遇到网关 5xx 时标为结果未知，避免误判后自动重复发送',async()=>{
 const http=await fixture((req,res)=>{res.writeHead(503);res.end();});
 const adapter=new TelegramAdapter(config('Telegram',http.url),{state(){},cursor(){},async receive(){}},'');
 try{await assert.rejects(adapter.send(outbound({chatId:'local'})),error=>error.uncertain===true);}finally{adapter.close();await http.close();}
});
