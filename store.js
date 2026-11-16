// CLUTCH — stockage des comptes
// - DATABASE_URL défini (ex. Neon) → Postgres, table clutch_users(id, data jsonb)
// - sinon → fichier data/db.json (local / VPS)
// Tout est chargé en mémoire au démarrage puis écrit en différé (toutes les 2 s + à l'arrêt).
const fs = require('fs');
const path = require('path');

class Store {
  constructor() {
    this.users = new Map();   // id -> user
    this.byName = new Map();  // nom en minuscules -> id
    this.byEmail = new Map(); // email en minuscules -> id
    this.meta = {};
    this.dirty = new Set();
    this.kind = 'memory';
  }

  async init() {
    if (process.env.DATABASE_URL) {
      const { Pool } = require('pg');
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
      await this.pool.query('CREATE TABLE IF NOT EXISTS clutch_users (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
      const r = await this.pool.query('SELECT id, data FROM clutch_users');
      r.rows.forEach((row) => { if (row.id === '__meta') this.meta = row.data; else this._index(row.data); });
      this.kind = 'postgres';
    } else {
      this.file = path.join(__dirname, 'data', 'db.json');
      try {
        const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        (j.users || []).forEach((u) => this._index(u));
        this.meta = j.meta || {};
      } catch { /* première fois */ }
      this.kind = 'file';
      if (process.env.RENDER) console.warn("⚠️  Render sans DATABASE_URL : les comptes seront PERDUS à chaque mise en veille. Configure Neon (voir DEPLOY.md).");
    }
    this.timer = setInterval(() => this.flush(), 2000);
    console.log(`Comptes : stockage ${this.kind} (${this.users.size} comptes)`);
  }

  _index(u) {
    this.users.set(u.id, u);
    this.byName.set(u.name.toLowerCase(), u.id);
    if (u.email) this.byEmail.set(u.email.toLowerCase(), u.id);
  }
  get(id) { return this.users.get(id) || null; }
  findByName(name) { const id = this.byName.get(String(name || '').trim().toLowerCase()); return id ? this.users.get(id) : null; }
  findByEmail(email) { const id = this.byEmail.get(String(email || '').trim().toLowerCase()); return id ? this.users.get(id) : null; }
  rename(u, name) { this.byName.delete(u.name.toLowerCase()); u.name = name; this.byName.set(name.toLowerCase(), u.id); this.save(u); }
  setEmail(u, email) { if (u.email) this.byEmail.delete(u.email.toLowerCase()); u.email = email; this.byEmail.set(email.toLowerCase(), u.id); this.save(u); }
  create(u) { this._index(u); this.save(u); }
  save(u) { this.dirty.add(u.id); }
  setMeta(k, v) { this.meta[k] = v; this.dirty.add('__meta'); }

  async flush() {
    if (!this.dirty.size || this.flushing) return;
    this.flushing = true;
    const ids = [...this.dirty];
    this.dirty.clear();
    try {
      if (this.kind === 'postgres') {
        for (const id of ids) {
          const data = id === '__meta' ? this.meta : this.users.get(id);
          if (!data) continue;
          await this.pool.query('INSERT INTO clutch_users (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, JSON.stringify(data)]);
        }
      } else if (this.kind === 'file') {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ meta: this.meta, users: [...this.users.values()] }));
        fs.renameSync(tmp, this.file);
      }
    } catch (e) {
      console.error('Sauvegarde des comptes échouée, nouvel essai :', e.message);
      ids.forEach((id) => this.dirty.add(id));
    } finally {
      this.flushing = false;
    }
  }

  async close() {
    clearInterval(this.timer);
    while (this.flushing) await new Promise((r) => setTimeout(r, 50));
    await this.flush();
    if (this.pool) await this.pool.end();
  }
}

module.exports = new Store();
