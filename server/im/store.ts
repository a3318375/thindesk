import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ImChannel, ImDeliveryView } from "../../shared/im.ts";
import type { ImBot, ImRoute, Outbound } from "./types.ts";
export class ImStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS im_bots (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS im_routes (id TEXT PRIMARY KEY, bot TEXT NOT NULL, conversation TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(bot,conversation));
      CREATE TABLE IF NOT EXISTS im_inbox (bot TEXT NOT NULL, message TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(bot,message));
      CREATE TABLE IF NOT EXISTS im_cursors (bot TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS im_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, route TEXT NOT NULL, message TEXT NOT NULL, part INTEGER NOT NULL, bot TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, remote_id TEXT, UNIQUE(route,message,part));
      CREATE INDEX IF NOT EXISTS im_outbox_ready ON im_outbox(state,bot,due,sequence);`);
    // Old deliveries may be mirrors. They cannot be retried under source-only routing.
    db.exec(`UPDATE im_outbox SET state='cancelled',error='旧同步规则的投递已取消'
      WHERE state NOT IN ('sent','cancelled') AND json_extract(body,'$.sourceOnly') IS NULL`);
    db.prepare(
      "UPDATE im_outbox SET state='unknown',error='服务在投递期间重启，请确认是否收到后再重试' WHERE state='sending'",
    ).run();
  }
  bots() {
    return this.db
      .prepare("SELECT body FROM im_bots ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(String(row.body)) as ImBot);
  }
  bot(id: string) {
    const row = this.db.prepare("SELECT body FROM im_bots WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.body)) as ImBot) : undefined;
  }
  saveBot(bot: ImBot) {
    this.db
      .prepare("INSERT OR REPLACE INTO im_bots VALUES (?,?)")
      .run(bot.id, JSON.stringify(bot));
  }
  routes(bot?: string) {
    return this.db
      .prepare("SELECT body FROM im_routes" + (bot ? " WHERE bot=?" : ""))
      .all(...(bot ? [bot] : []))
      .map((row) => JSON.parse(String(row.body)) as ImRoute);
  }
  routeById(id: string) {
    const row = this.db.prepare("SELECT body FROM im_routes WHERE id=?").get(id);
    return row ? JSON.parse(String(row.body)) as ImRoute : undefined;
  }
  route(bot: string, conversation: string) {
    const row = this.db
      .prepare("SELECT body FROM im_routes WHERE bot=? AND conversation=?")
      .get(bot, conversation);
    return row ? (JSON.parse(String(row.body)) as ImRoute) : undefined;
  }
  saveRoute(route: ImRoute) {
    this.db
      .prepare(
        "INSERT INTO im_routes VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(route.id, route.bot, route.conversation, JSON.stringify(route));
  }
  seen(bot: string, message: string) {
    return !!this.db
      .prepare("SELECT 1 FROM im_inbox WHERE bot=? AND message=?")
      .get(bot, message);
  }
  remember(bot: string, message: string) {
    this.db
      .prepare("INSERT INTO im_inbox VALUES (?,?,?)")
      .run(bot, message, Date.now());
  }
  cursor(bot: string) {
    return String(
      this.db.prepare("SELECT value FROM im_cursors WHERE bot=?").get(bot)
        ?.value || "",
    );
  }
  setCursor(bot: string, value: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO im_cursors VALUES (?,?)")
      .run(bot, value);
  }
  enqueue(
    route: ImRoute,
    messageId: string,
    text: string,
    part: number,
    context = route.context,
  ) {
    const item: Outbound = {
      id: randomUUID(),
      route: route.id,
      bot: route.bot,
      sessionId: route.sessionId,
      messageId,
      text,
      part,
      context,
    };
    this.db
      .prepare(
        "INSERT OR IGNORE INTO im_outbox(id,route,message,part,bot,body,state,updated) VALUES (?,?,?,?,?,?,'pending',?)",
      )
      .run(
        item.id,
        route.id,
        messageId,
        part,
        route.bot,
        JSON.stringify({ ...item, sourceOnly: true }),
        Date.now(),
      );
  }
  next(bot: string) {
    const row = this.db
      .prepare(
        `SELECT o.* FROM im_outbox o WHERE o.bot=? AND o.state='pending' AND o.due<=? AND NOT EXISTS(SELECT 1 FROM im_outbox p WHERE p.route=o.route AND p.message=o.message AND p.part<o.part AND p.state!='sent') ORDER BY o.sequence LIMIT 1`,
      )
      .get(bot, Date.now());
    return row
      ? {
          item: {
            ...JSON.parse(String(row.body)),
            sequence: Number(row.sequence),
          } as Outbound,
          attempts: Number(row.attempts),
        }
      : undefined;
  }
  setDelivery(
    id: string,
    state: ImDeliveryView["state"],
    error?: string,
    due = 0,
    remoteId?: string,
  ) {
    this.db
      .prepare(
        "UPDATE im_outbox SET state=?,error=?,due=?,updated=?,remote_id=coalesce(?,remote_id),attempts=attempts+? WHERE id=?",
      )
      .run(
        state,
        error || null,
        due,
        Date.now(),
        remoteId || null,
        state === "sending" ? 1 : 0,
        id,
      );
  }
  deliveries(channels: Map<string, ImChannel>): ImDeliveryView[] {
    return this.db
      .prepare("SELECT * FROM im_outbox ORDER BY sequence DESC LIMIT 60")
      .all()
      .map((row) => {
        const item = JSON.parse(String(row.body)) as Outbound;
        return {
          id: item.id,
          channel: channels.get(item.bot)!,
          sessionId: item.sessionId,
          messageId: item.messageId,
          preview: item.text.slice(0, 120),
          state: String(row.state) as ImDeliveryView["state"],
          error: row.error ? String(row.error) : undefined,
          updatedAt: Number(row.updated),
        };
      });
  }
  retry(id: string) {
    const row = this.db
      .prepare("SELECT state FROM im_outbox WHERE id=?")
      .get(id);
    if (!row || !["failed", "unknown"].includes(String(row.state)))
      throw Error("这条投递当前不能重试");
    this.db.prepare("UPDATE im_outbox SET attempts=0 WHERE id=?").run(id);
    this.setDelivery(id, "pending");
  }
  deleteSession(sessionId: string) {
    const routes = this.routes().filter(
      (route) => route.sessionId === sessionId,
    );
    for (const route of routes) {
      this.db.prepare("DELETE FROM im_routes WHERE id=?").run(route.id);
      this.db
        .prepare("DELETE FROM im_outbox WHERE route=? AND state!='sent'")
        .run(route.id);
    }
  }
}
