import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DeskStore, readStoredDesk } from "../../server/desk-store.ts";
import { workspaceView } from "../../server/views.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE desks(id TEXT PRIMARY KEY,body TEXT NOT NULL)");
  const messages = Array.from({length: 2000}, (_, i) => ({ id: 'm'+i, role: i%2 ? 'assistant' : 'user', text: '历史'.repeat(2000) }));
  const desk = { revision: 0, folders: ['/project'], workspaces: ['/project'], jobs: [], sessions: [{id:'long',workspace:'/project',title:'长会话',messages}] };
  db.prepare("INSERT INTO desks VALUES ('personal',?)").run(JSON.stringify(desk));
  const store = new DeskStore(db);
  return { db, store };
}
test("旧 JSON 无损迁移；流式更新只写一条消息，侧栏不带全部历史", () => {
  const { db, store } = fixture();
  try {
    const desk = store.get();
    db.exec('BEGIN'); store.save(desk); db.exec('COMMIT');
    assert.equal(JSON.parse(db.prepare("SELECT body FROM desks").get().body).storageVersion, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM desk_messages').get().n, 2000);
    db.exec("CREATE TABLE audit(kind TEXT); CREATE TRIGGER changed AFTER UPDATE ON desk_messages BEGIN INSERT INTO audit VALUES ('update'); END; CREATE TRIGGER inserted AFTER INSERT ON desk_messages BEGIN INSERT INTO audit VALUES ('insert'); END; CREATE TRIGGER removed AFTER DELETE ON desk_messages BEGIN INSERT INTO audit VALUES ('delete'); END;");
    const start = performance.now();
    for (let i=0;i<5;i++) {
      const state=store.get();state.sessions[0].messages.at(-1).text='增量'+i;
      state.revision++; db.exec('BEGIN');store.save(state);db.exec('COMMIT');
    }
    console.log('约 8MB 中文历史，5 次增量读写:', Math.round(performance.now()-start), 'ms');
    assert.deepEqual(db.prepare('SELECT kind,count(*) n FROM audit GROUP BY kind').all().map(r=>({...r})),[{kind:'update',n:5}]);
    assert.equal(readStoredDesk(db).sessions[0].messages.at(-1).text, '增量4');
    const view=workspaceView(desk,'long');
    assert.equal(view.sessions[0].messages.length,20);
    assert.equal(workspaceView(desk,null).sessions[0].messages.length,0);
    assert.ok(String(db.prepare('SELECT body FROM desks').get().body).length < 1000);
  } finally {db.close();}
});
test("会话改名、队列、复制、删除和历史消息修改在重开后保留",()=>{
  const {db,store}=fixture();
  try {
    let desk=store.get();db.exec('BEGIN');store.save(desk);db.exec('COMMIT');
    desk.sessions[0].title='新标题';desk.sessions[0].queue=[{id:'queue'}];
    desk.sessions[0].messages[0].text='修改旧消息';
    desk.sessions.unshift({...JSON.parse(JSON.stringify(desk.sessions[0])),id:'copy'});
    db.exec('BEGIN');store.save(desk);db.exec('COMMIT');
    store.invalidate();desk=store.get();
    assert.equal(desk.sessions[1].messages[0].text,'修改旧消息');
    assert.equal(desk.sessions[0].title,'新标题');
    assert.equal(desk.sessions[0].queue[0].id,'queue');
    desk.sessions=desk.sessions.filter(s=>s.id!=='long');db.exec('BEGIN');store.save(desk);db.exec('COMMIT');
    assert.equal(db.prepare("SELECT count(*) n FROM desk_messages WHERE session='long'").get().n,0);
  } finally {db.close();}
});
