import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ImManager } from '../../server/im/manager.ts';
import { DeliveryError } from '../../server/im/types.ts';
import { beginQueuedTurn } from '../../server/queue.ts';
import { splitReply } from '../../server/im/text.ts';

function harness() {
  const db = new DatabaseSync(':memory:');
  const sessions = [], delivered = [], factories = [], errors = [], calls = [];
  const factory = (bot, events) => {
    factories.push(bot.id);
    return {
      async start(signal) { events.state('connected'); await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true})); },
      async send(item) { const failure = errors.shift(); if (failure) throw failure; delivered.push({...item}); return item.id; },
      close() {},
    };
  };
  const hooks = {
    rolledBack() {}, session: id => sessions.find(session => session.id === id),
    submit(bot, input, route) {
      let session = sessions.find(session => session.id === route.sessionId);
      if (!session) { session={id:route.sessionId,workspace:'/work',title:'个人助手',messages:[],queue:[]};sessions.push(session); }
      session.queue.push({id:input.id,text:input.text,attachments:[],mode:'标准模式',permission:'完全权限',agent:'codex',model:'',origin:bot.channel,createdAt:Date.now(),im:{routeId:route.id,context:input.context}});
      return session.id;
    },
    committed() {}, run: id => calls.push(id), stop() {},
  };
  const manager = new ImManager(db,hooks,factory);
  const enable = id => manager.save(id,{enabled:true,appId:'test-app',appSecret:'not-a-real-secret',token:'not-a-real-token'});
  const input = (id, chat='peer') => ({id,conversation:chat,sender:chat,label:chat,text:'问题 '+id,files:[],context:{chatId:chat,messageId:id,contextToken:'reply-context'},timestamp:Date.now()});
  return {db,sessions,delivered,factories,errors,calls,hooks,factory,manager,enable,input,close(){manager.close();db.close();}};
}
test('三个官方渠道默认关闭，不创建连接或回传机器人凭据',()=>{
  const h=harness();try{
    h.manager.start();assert.equal(h.manager.view().bots.length,3);assert.deepEqual(h.factories,[]);
    h.manager.save('qq',{appId:'test',appSecret:'secret-value',enabled:false});
    h.manager.save('weixin',{token:'token-value',enabled:false});
    const text=JSON.stringify(h.manager.view());assert.ok(!text.includes('secret-value')&&!text.includes('token-value'));assert.deepEqual(h.factories,[]);
  }finally{h.close();}
});
test('QQ 入站去重、来源图标标识和原始回复上下文保存在同一会话队列',async()=>{
  const h=harness();try{
    h.enable('qq');await h.manager.receive('qq',h.input('1'));await h.manager.receive('qq',h.input('1'));
    assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].queue[0].origin,'QQ');assert.equal(h.calls.length,1);assert.equal(h.sessions[0].queue.length,1);
    const turn=beginQueuedTurn(h.sessions[0]);const reply=h.sessions[0].messages.at(-1);
    assert.equal(reply.origin,'QQ');assert.equal(reply.im.context.messageId,'1');assert.ok(turn.replyId);
    reply.text='实际回答';reply.runStatus='complete';h.manager.enqueueReply(h.sessions[0],reply);h.manager.enqueueReply(h.sessions[0],reply);
    await h.manager.drain('qq');assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].context.messageId,'1');
  }finally{h.close();}
});
test('四端共用会话，同时提问只回原机器人、聊天和消息，Web 回合不出站',async()=>{
  const h=harness();try {
    for (const id of ['qq','weixin','telegram']) h.enable(id);
    const questions=[['qq','qq1','alice'],['weixin','wx1','peer'],['telegram','tg1','peer'],['qq','qq2','bob']];
    for (const [bot,id,chat] of questions) await h.manager.receive(bot,h.input(id,chat));
    assert.equal(h.sessions.length,1);
    const session=h.sessions[0];
    for (const [,id] of questions) {
      beginQueuedTurn(session);
      const reply=session.messages.at(-1);reply.text='回复 '+id;
      h.manager.enqueueReply(session,reply);h.manager.enqueueReply(session,reply);session.running=false;
    }
    h.manager.enqueueReply(session,{id:'web',role:'assistant',text:'仅网页',origin:'web'});
    for (const bot of ['qq','weixin','telegram']) await h.manager.drain(bot);
    assert.deepEqual(h.delivered.map(m=>[m.bot,m.context.messageId,m.context.chatId,m.text]).sort(),
      questions.map(([bot,id,chat])=>[bot,id,chat,'回复 '+id]).sort());
  }finally{h.close();}
});
test('未知投递结果不自动重发，手动重试只重投回答、不重新运行 Agent',async()=>{
  const h=harness();try{
    h.enable('qq');await h.manager.receive('qq',h.input('1'));const s=h.sessions[0];beginQueuedTurn(s);
    const reply={...s.messages.at(-1),text:'需要投递的答案'};h.manager.enqueueReply(s,reply);h.errors.push(new DeliveryError('超时',true));
    await h.manager.drain('qq');assert.equal(h.manager.view().deliveries[0].state,'unknown');
    await h.manager.drain('qq');assert.equal(h.delivered.length,0);
    h.manager.retry(h.manager.view().deliveries[0].id);await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.delivered.length,1);assert.equal(h.calls.length,1);assert.equal(h.manager.view().deliveries[0].state,'sent');
  }finally{h.close();}
});
test('分段投递失败时保留已送达部分，后续分段不越过未确认部分',async()=>{
  const h=harness();try{
    h.enable('weixin');await h.manager.receive('weixin',h.input('1'));const s=h.sessions[0];beginQueuedTurn(s);
    h.manager.enqueueReply(s,{...s.messages.at(-1),text:'字'.repeat(4000)});h.errors.push(new DeliveryError('频率限制',false,30));
    await h.manager.drain('weixin');assert.equal(h.delivered.length,0);assert.equal(h.manager.view().deliveries.length,3);assert.ok(h.manager.view().deliveries.every(item=>item.state==='pending'));
  }finally{h.close();}
});
test('新会话指令不会创建空历史，旧任务仍按原上下文回传',async()=>{
  const h=harness();try{
    h.enable('qq');await h.manager.receive('qq',h.input('1'));const s=h.sessions[0];beginQueuedTurn(s);const original={...s.messages.at(-1),text:'原任务答案'};
    await h.manager.receive('qq',{...h.input('new'),text:'/new'});assert.equal(h.sessions.length,1);assert.equal(h.manager.store.routes()[0].sessionId,s.id);
    await h.manager.receive('qq',h.input('2'));assert.equal(h.sessions.length,1);
    h.manager.enqueueReply(s,original);await h.manager.drain('qq');await new Promise(resolve=>setTimeout(resolve,0));await h.manager.drain('qq');
    const sent=h.delivered.find(item=>item.text==='原任务答案');assert.ok(sent);assert.equal(sent.context.messageId,'1');
  }finally{h.close();}
});
test('入站事务失败时不推进去重记录；重启保留绑定与未确认投递',async()=>{
  const h=harness();try{
    h.enable('qq');const original=h.hooks.submit;h.hooks.submit=()=>{throw Error('提交失败');};
    await assert.rejects(h.manager.receive('qq',h.input('1')));assert.equal(h.manager.store.seen('qq','1'),false);
    h.hooks.submit=original;await h.manager.receive('qq',h.input('1'));const s=h.sessions[0];beginQueuedTurn(s);h.manager.enqueueReply(s,{...s.messages.at(-1),text:'待投递'});
    const delivery=h.manager.view().deliveries[0];h.manager.store.setDelivery(delivery.id,'sending');h.manager.close();
    const next=new ImManager(h.db,h.hooks,h.factory);
    assert.equal(next.view().routes.length,1);assert.equal(next.view().deliveries[0].state,'unknown');
    await next.receive('qq',h.input('1'));assert.equal(h.calls.length,1);next.close();
  }finally{h.close();}
});
test('旧广播投递升级后不会自动发送，也不能从设置重试',async()=>{
  const h=harness();
  try {
    h.enable('qq');
    await h.manager.receive('qq',h.input('legacy'));
    const session=h.sessions[0];
    beginQueuedTurn(session);
    h.manager.enqueueReply(session,{...session.messages.at(-1),text:'历史回答'});
    const id=h.manager.view().deliveries[0].id;
    h.db.prepare("UPDATE im_outbox SET body=json_remove(body,'$.sourceOnly') WHERE id=?").run(id);
    h.manager.close();
    const next=new ImManager(h.db,h.hooks,h.factory);
    try {
      assert.equal(next.view().deliveries[0].state,'cancelled');
      assert.throws(()=>next.retry(id));
      assert.equal(next.store.next('qq'),undefined);
    } finally {next.close();}
  } finally {h.close();}
});
test('Unicode 分段不拆坏 emoji，消息内容可以完整还原',()=>{
 const text='你好🙂'.repeat(2000),parts=splitReply(text,1800);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>Array.from(part).length<=1800));
});

test('坏附件通知用户并确认去重，不创建空会话或阻塞下一条消息',async()=>{
 const h=harness();try{
  h.enable('weixin');await h.manager.receive('weixin',{...h.input('broken'),text:'',rejected:'附件已失效，请重新发送'});
  await new Promise(resolve=>setTimeout(resolve,0));await h.manager.drain('weixin');
  assert.equal(h.sessions.length,0);assert.equal(h.manager.store.seen('weixin','broken'),true);assert.equal(h.delivered[0].text,'附件已失效，请重新发送');
  await h.manager.receive('weixin',h.input('valid'));assert.equal(h.sessions.length,1);assert.equal(h.calls.length,1);
 }finally{h.close();}
});
