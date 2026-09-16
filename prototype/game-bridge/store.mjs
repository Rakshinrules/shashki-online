import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';

export class EventStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        actor TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL,
        reply_to TEXT UNIQUE REFERENCES events(id));`);
    this.signal = new EventEmitter();
    this.signal.setMaxListeners(40);
    this.agentSeen = 0;
    this.activeWaits = 0;
  }
  list(after = 0) {
    return this.db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT 100').all(after);
  }
  pending() {
    return this.db.prepare(`SELECT * FROM events AS e WHERE actor='player'
      AND NOT EXISTS (SELECT 1 FROM events AS r WHERE r.reply_to=e.id)
      ORDER BY seq LIMIT 20`).all();
  }
  append({ id, actor, text, replyTo = null }) {
    const existing = this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (existing) {
      if (existing.actor !== actor || existing.text !== text || existing.reply_to !== replyTo)
        throw new Error('Этот идентификатор уже использован для другого сообщения.');
      return existing;
    }
    if (replyTo) {
      const source = this.db.prepare("SELECT * FROM events WHERE id=? AND actor='player'").get(replyTo);
      if (!source) throw new Error('Исходное событие не найдено.');
      const answer = this.db.prepare('SELECT * FROM events WHERE reply_to=?').get(replyTo);
      if (answer) throw new Error('На это событие уже есть ответ.');
    }
    this.db.prepare('INSERT INTO events(id,actor,text,created,reply_to) VALUES(?,?,?,?,?)')
      .run(id, actor, text, Date.now(), replyTo);
    const event = this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    this.signal.emit('change');
    return event;
  }
  async wait(select, ms, signal) {
    const ready = select();
    if (ready.length || ms === 0 || signal?.aborted) return ready;
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        this.signal.off('change', changed);
        signal?.removeEventListener('abort', finish);
        resolve(select());
      };
      const changed = () => { if (select().length) finish(); };
      this.signal.on('change', changed);
      signal?.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, ms);
      changed();
      if (signal?.aborted) finish();
    });
  }
  close() { this.db.close(); }
}
