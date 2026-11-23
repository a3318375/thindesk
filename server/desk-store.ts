import type { DatabaseSync } from "node:sqlite";
import type { Desk, Session, Message } from "../shared/workspace.ts";

export const sessionVersions = new WeakMap<object, number>();

// Metadata stays small; only dirty messages are serialized on streaming updates.
export class DeskStore {
  private cached?: Desk;
  private raw = "";
  private legacy = false;
  private sessions = new Set<Session>();
  private messages = new Map<Session, Set<Message>>();
  private structure = new Set<Session>();
  private proxies = new WeakMap<object, object>();
  constructor(privateDb: DatabaseSync) {
    this.db = privateDb;
    privateDb.exec(`CREATE TABLE IF NOT EXISTS desk_sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desk_messages (session TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS desk_message_order ON desk_messages(session,position);`);
  }
  private db: DatabaseSync;
  private wrap<T extends object>(value: T, kind: string, session?: Session, message?: Message): T {
    const cached = this.proxies.get(value);
    if (cached) return cached as T;
    const mark = () => {
      if (session) {
        const proxy = this.proxies.get(session);
        if (proxy) sessionVersions.set(proxy, (sessionVersions.get(proxy) || 0) + 1);
      }
      if (kind === "message" && session && message) {
        if (!this.messages.has(session)) this.messages.set(session, new Set());
        this.messages.get(session)!.add(message);
      } else if (session) {
        this.sessions.add(session);
        if (kind === "messages") this.structure.add(session);
      }
    };
    const proxy = new Proxy(value, {
      get: (target, key, receiver) => {
        const item = Reflect.get(target, key, receiver);
        if (!item || typeof item !== "object") return item;
        if (kind === "desk" && key === "sessions") return this.wrap(item, "sessions");
        if (kind === "sessions" && /^\d+$/.test(String(key))) return this.wrap(item, "session", item as unknown as Session);
        if (kind === "session" && key === "messages") return this.wrap(item, "messages", session);
        if (kind === "messages" && /^\d+$/.test(String(key))) return this.wrap(item, "message", session, item as unknown as Message);
        return this.wrap(item, kind, session, message);
      },
      set: (target, key, item) => {
        if (Reflect.get(target, key) !== item) { Reflect.set(target, key, item); mark();
          if (kind === "session" && key === "messages" && session) this.structure.add(session);
        }
        return true;
      },
      deleteProperty: (target, key) => { if (Reflect.has(target, key)) { Reflect.deleteProperty(target, key); mark(); } return true; },
    });
    this.proxies.set(value, proxy);
    this.proxies.set(proxy, proxy);
    if (kind === "session") sessionVersions.set(proxy, 0);
    return proxy;
  }
  get(): Desk {
    const raw = String(this.db.prepare("SELECT body FROM desks WHERE id='personal'").get()!.body);
    if (this.cached && raw === this.raw) return this.cached;
    const stored = JSON.parse(raw);
    let desk: Desk;
    if (stored.storageVersion === 2) {
      const meta = new Map(this.db.prepare("SELECT id,body FROM desk_sessions").all().map(r => [String(r.id), JSON.parse(String(r.body))]));
      desk = { ...stored, sessions: stored.sessions.map((id: string) => {
        const session = meta.get(id);
        session.messages = this.db.prepare("SELECT body FROM desk_messages WHERE session=? ORDER BY position").all(id).map(r => JSON.parse(String(r.body)));
        return session;
      }) };
      delete (desk as any).storageVersion;
    } else desk = stored;
    this.raw = raw; this.proxies = new WeakMap();
    this.legacy = stored.storageVersion !== 2;
    this.sessions = new Set(this.legacy ? desk.sessions : []);
    this.structure = new Set(this.legacy ? desk.sessions : []);
    this.messages.clear();
    this.cached = this.wrap(desk, "desk");
    // Legacy JSON is migrated on the next save, inside its caller's transaction.
    return this.cached;
  }
  save(desk: Desk) {
    // Incoming legacy fixture/reset is adopted through get(), just like an old installation.
    const ids = new Set(desk.sessions.map(s => s.id));
    const upsertSession = this.db.prepare("INSERT OR REPLACE INTO desk_sessions VALUES (?,?)");
    const upsertMessage = this.db.prepare("INSERT OR REPLACE INTO desk_messages VALUES (?,?,?,?)");
    for (const row of this.db.prepare("SELECT id FROM desk_sessions").all()) if (!ids.has(String(row.id))) {
      this.db.prepare("DELETE FROM desk_sessions WHERE id=?").run(row.id);
      this.db.prepare("DELETE FROM desk_messages WHERE session=?").run(row.id);
    }
    const storedIds = new Set(this.db.prepare("SELECT id FROM desk_sessions").all().map(r => String(r.id)));
    for (const proxy of desk.sessions) {
      // Dirty sets hold raw session objects; match by id, not proxy identity.
      const raw = [...this.sessions, ...this.structure, ...this.messages.keys()].find(s => s.id === proxy.id);
      const fresh = !storedIds.has(proxy.id);
      if (fresh || (raw && this.sessions.has(raw))) {
        const { messages, ...meta } = proxy;
        upsertSession.run(proxy.id, JSON.stringify(meta));
      }
      if (fresh || (raw && this.structure.has(raw))) {
        const positions = new Map(this.db.prepare("SELECT id,position FROM desk_messages WHERE session=?").all(proxy.id).map(row => [String(row.id), Number(row.position)]));
        const retained = new Set(proxy.messages.map(message => message.id));
        for (const messageId of positions.keys()) if (!retained.has(messageId))
          this.db.prepare("DELETE FROM desk_messages WHERE session=? AND id=?").run(proxy.id, messageId);
        proxy.messages.forEach((message, index) => {
          if (this.legacy || !positions.has(message.id)) upsertMessage.run(proxy.id, message.id, index, JSON.stringify(message));
          else if (positions.get(message.id) !== index)
            this.db.prepare("UPDATE desk_messages SET position=? WHERE session=? AND id=?").run(index, proxy.id, message.id);
        });
      }
      if (raw) for (const message of this.messages.get(raw) || []) {
        this.db.prepare("UPDATE desk_messages SET body=? WHERE session=? AND id=?").run(JSON.stringify(message), proxy.id, message.id);
      }
    }
    const { sessions, ...meta } = desk;
    this.raw = JSON.stringify({ ...meta, sessions: sessions.map(s => s.id), storageVersion: 2 });
    this.db.prepare("INSERT OR REPLACE INTO desks VALUES ('personal',?)").run(this.raw);
    this.cached = desk;
    this.legacy = false;
    this.sessions.clear(); this.structure.clear(); this.messages.clear();
  }
  invalidate() { this.cached = undefined; this.raw = ""; }
}

export function readStoredDesk(db: DatabaseSync): Desk {
  return JSON.parse(JSON.stringify(new DeskStore(db).get()));
}
