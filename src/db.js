import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const DB_PATH = process.env.CRUMB_DB || join(ROOT, 'data', 'crumb.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS cakes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    tagline       TEXT    NOT NULL DEFAULT '',
    description   TEXT    NOT NULL DEFAULT '',
    price_per_kg  INTEGER NOT NULL,
    min_kg        REAL    NOT NULL DEFAULT 0.5,
    lead_days     INTEGER NOT NULL DEFAULT 2,
    tags          TEXT    NOT NULL DEFAULT '',
    palette       TEXT    NOT NULL DEFAULT '',
    image         TEXT    NOT NULL DEFAULT '',
    image_alt     TEXT    NOT NULL DEFAULT '',
    position      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    NOT NULL UNIQUE,
    cake_id      INTEGER NOT NULL REFERENCES cakes(id),
    size_kg      REAL    NOT NULL,
    eggless      INTEGER NOT NULL DEFAULT 0,
    candles      INTEGER NOT NULL DEFAULT 0,
    inscription  TEXT    NOT NULL DEFAULT '',
    wanted_date  TEXT    NOT NULL,
    slot         TEXT    NOT NULL,
    fulfilment   TEXT    NOT NULL DEFAULT 'pickup',
    name         TEXT    NOT NULL,
    phone        TEXT    NOT NULL,
    address      TEXT    NOT NULL DEFAULT '',
    total        INTEGER NOT NULL,
    deposit      INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'new',
    created_at   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS day_overrides (
    date    TEXT PRIMARY KEY,
    slots   INTEGER,
    closed  INTEGER NOT NULL DEFAULT 0,
    reason  TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(wanted_date, status);
`);

export const nowIso = () => new Date().toISOString();

// Older demo databases predate the photograph columns.
const cakeColumns = db.prepare('PRAGMA table_info(cakes)').all().map((c) => c.name);
if (!cakeColumns.includes('image')) {
  db.exec("ALTER TABLE cakes ADD COLUMN image TEXT NOT NULL DEFAULT ''");
}
if (!cakeColumns.includes('image_alt')) {
  db.exec("ALTER TABLE cakes ADD COLUMN image_alt TEXT NOT NULL DEFAULT ''");
}

export const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `CRB-${out}`;
}
