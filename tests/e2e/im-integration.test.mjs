import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchBrowser } from '../browser.mjs';
const waitFor=async(check)=>{for(let i=0;i<200;i++){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('等待本地模拟交互超时');};
test('本地官方协议模拟：四端单会话、网页总览、按源回复和重启去重',async()=>{
 const root=await mkdtemp(join(tmpdir(),'thindesk-im-integration-'));
 let app,browser;
 const tgUpdates=[],wxUpdates=[],sent=[];
 const mock=createServer((req,res)=>{void(async()=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(req.url.endsWith('/getMe'))return json({ok:true,result:{id:77,username:'ThinDeskLocalTest'}});
  if(req.url.endsWith('/getUpdates'))return setTimeout(()=>json({ok:true,result:tgUpdates.splice(0)}),25);
  if(req.url.endsWith('/getupdates'))return setTimeout(()=>json({ret:0,msgs:wxUpdates.splice(0),get_updates_buf:'wx-cursor'}),25);
  if(req.url.endsWith('/sendMessage')){sent.push({channel:'Telegram',text:body.text});return json({ok:true,result:{message_id:sent.length}});}
  if(req.url.endsWith('/sendmessage')){sent.push({channel:'微信',text:body.msg.item_list[0].text_item.text});return json({ret:0});}
  if(req.url.endsWith('/sendChatAction')||req.url.endsWith('/sendtyping'))return json({ok:true,result:true,ret:0});
  if(req.url.endsWith('/getconfig'))return json({ret:0,typing_ticket:'LOCAL_TICKET'});
  res.writeHead(404);res.end();
 })().catch(()=>{res.writeHead(500);res.end();});});
 mock.listen(0,'127.0.0.1');await once(mock,'listening');const mockUrl='http://127.0.0.1:'+mock.address().port;
 async function start(){
  app=spawn(process.execPath,['server/index.ts'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',THINDESK_DATA:root,THINDESK_CODEX:resolve('tests/fixtures/codex.mjs'),THINDESK_PI:resolve('tests/fixtures/pi.mjs')},stdio:['ignore','pipe','inherit']});
  const [output]=await once(app.stdout,'data');return String(output).trim();
 }
 async function stop(){if(app?.exitCode===null){const done=once(app,'exit');app.kill();await done;}}
 try{
  let url=await start();
  const post=async body=>{const response=await fetch(url+'/api/im',{method:'POST',headers:{'content-type':'application/json',Origin:url},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const desk=async()=> (await fetch(url+'/api/desk')).json();
  const db=new DatabaseSync(join(root,'workspace.sqlite'));
  for(const id of ['telegram','weixin']){
   const bot=JSON.parse(db.prepare('SELECT body FROM im_bots WHERE id=?').get(id).body);
   bot.credentials={token:'LOCAL_TOKEN',baseUrl:mockUrl};
   db.prepare('UPDATE im_bots SET body=? WHERE id=?').run(JSON.stringify(bot),id);
  }db.close();
  await post({action:'save',bot:'telegram',enabled:true});
  await post({action:'save',bot:'weixin',enabled:true});
  const tg={update_id:1,message:{message_id:1,date:Math.floor(Date.now()/1000),chat:{id:10,type:'private'},from:{id:10,first_name:'TG 本地用户'},text:'TG 来源图标测试'}};
  const wx={message_id:'wx-1',message_type:1,from_user_id:'WX_LOCAL_USER',context_token:'LOCAL_CONTEXT',create_time_ms:Date.now(),item_list:[{type:1,text_item:{text:'微信来源图标测试'}}]};
  tgUpdates.push(tg);wxUpdates.push(wx);
  const personalId='personal-assistant';
  const initial=await waitFor(async()=>{const session=(await desk()).sessions.find(s=>s.id===personalId);return session?.messages.length===4&&!session.running&&session;});
  assert.deepEqual((await desk()).workspaces,[]);
  assert.equal(initial.title,'个人助手');
  await waitFor(()=>sent.length===2);
  assert.deepEqual(sent.map(s=>s.channel).sort(),['Telegram','微信'].sort());
  browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(url);
  await page.getByRole('button',{name:'个人助手',exact:true}).click();
  await page.locator('.bubble').filter({hasText:'TG 来源图标测试'}).waitFor();
  await page.locator('.bubble').filter({hasText:'微信来源图标测试'}).waitFor();
  assert.equal(await page.locator('.recentList .sessionRow').count(),0);
  const input=page.getByRole('textbox',{name:'消息',exact:true});await input.fill('网页续聊');await input.press('Enter');
  await waitFor(async()=>{const s=(await desk()).sessions.find(s=>s.id===personalId);return s.messages.length===6&&!s.running;});
  const updated=(await desk()).sessions.find(s=>s.id===personalId);
  assert.deepEqual(new Set(updated.messages.filter(m=>m.role==='user').map(m=>m.origin)),new Set(['Telegram','微信','web']));
  assert.equal(sent.length,2);
  await page.reload();await input.waitFor();assert.equal(new URL(page.url()).hash.slice(1),personalId);
  await browser.close();browser=undefined;
  await stop();url=await start();sent.length=0;
  tgUpdates.push(tg);wxUpdates.push(wx);await new Promise(resolve=>setTimeout(resolve,250));
  const restored=(await desk()).sessions.find(session=>session.id===personalId);assert.equal(restored.messages.filter(message=>message.role==='user').length,3);assert.equal(sent.length,0);
  const state=await(await fetch(url+'/api/im')).json();assert.equal(state.routes.length,2);assert.ok(state.deliveries.every(item=>item.state==='sent'));
  assert.ok(!JSON.stringify(state).includes('LOCAL_TOKEN'));assert.ok(!JSON.stringify(state).includes('LOCAL_CONTEXT'));
  const removed=await fetch(url+'/api/desk',{method:'POST',headers:{'content-type':'application/json',Origin:url},body:JSON.stringify({action:'delete-session',session:personalId})});assert.equal(removed.status,400);
  assert.equal((await desk()).sessions.find(s=>s.id===personalId).messages.length,6);

 }finally{
  await browser?.close();await stop();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await rm(root,{recursive:true,force:true});
 }
});
