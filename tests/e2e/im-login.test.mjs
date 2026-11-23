import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { ImLogin } from '../../server/im/login.ts';

async function waitFor(view, state) {
  for (let i = 0; i < 250 && view.state !== state; i++) await sleep(20);
  assert.equal(view.state, state);
}

test('微信扫码通过 POST 获取二维码、切换节点并提交配对码；仅在确认后启用', async () => {
  const previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const saved = [];
  const login = new ImLogin({
    store: { bot: () => ({ channel: '微信', credentials: {} }) },
    setCredentials: (...args) => saved.push(args),
  });
  const issue = { method: 'POST', path: '/ilink/bot/get_bot_qrcode?bot_type=3', body: '{"local_token_list":[]}' };
  const qr = { qrcode: 'q1', qrcode_img_content: 'https://example.test/q1' };
  try {
    const first = agent.get('https://ilinkai.weixin.qq.com');
    const redirected = agent.get('https://region.example.test');
    const poll = '/ilink/bot/get_qrcode_status?qrcode=q1';
    first.intercept(issue).reply(200, qr);
    first.intercept({ path: poll }).reply(200, { status: 'scaned_but_redirect', redirect_host: 'region.example.test' });
    redirected.intercept({ path: poll }).reply(200, { status: 'confirmed_but_need_verifycode' });
    redirected.intercept({ path: poll + '&verify_code=0102' }).reply(200, { status: 'confirmed', bot_token: 'fixture' });
    const view = login.begin('weixin', true);
    await waitFor(view, 'verify');
    assert.match(view.image, /^data:image\/png/);
    assert.deepEqual(saved, []);
    assert.throws(() => login.verify(view.id, 'abc'));
    login.verify(view.id, '0102');
    await waitFor(view, 'success');
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0], 'weixin');
    assert.equal(saved[0][1].token, 'fixture');
    assert.equal(saved[0][2], true);
    assert.ok(!JSON.stringify(view).includes('fixture'));
    first.intercept(issue).reply(200, qr);
    first.intercept({ path: poll }).reply(200, { status: 'expired' });
    const expired = login.begin('weixin', true);
    await waitFor(expired, 'expired');
    assert.equal(saved.length, 1);
    login.cancel(expired.id);
    assert.throws(() => login.get(expired.id));
    agent.assertNoPendingInterceptors();
  } finally {
    login.close();
    setGlobalDispatcher(previous);
    await agent.close();
  }
});
