/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Banco SQLite: criação das tabelas e acesso compartilhado. */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, uploadsDir } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, 'estudio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','editor')),
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- sha256 do token do cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  post_id    INTEGER,
  detail     TEXT,                        -- JSON
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS logs_user ON logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS logs_action ON logs(action, created_at);
CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('post','carrossel')),
  title      TEXT NOT NULL,
  model      TEXT,
  color      TEXT,
  data       TEXT NOT NULL,               -- JSON com textos e ajustes
  caption    TEXT,
  thumb      TEXT,                        -- data URL JPEG pequeno
  photos     INTEGER NOT NULL DEFAULT 0,  -- quantidade de fotos salvas em data/uploads/<id>/
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS posts_updated ON posts(updated_at);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ig_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  media_id   TEXT NOT NULL,
  permalink  TEXT,
  kind       TEXT NOT NULL,               -- post | carrossel
  username   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ig_posts_post ON ig_posts(post_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS ml_listings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company      TEXT NOT NULL DEFAULT 'megadino',
  title        TEXT NOT NULL,
  data         TEXT NOT NULL,              -- JSON: textos, ficha, fotos, dados do AnyMarket
  thumb        TEXT,                       -- URL da foto principal
  status       TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | enviado | erro
  am_product_id TEXT,
  am_message   TEXT,
  sent_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ml_listings_company ON ml_listings(company, updated_at);
`);

// Migrações: várias empresas (colunas novas em bancos antigos).
function addColumn(table: string, col: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('posts', 'company', "company TEXT NOT NULL DEFAULT 'megadino'");
addColumn('ig_posts', 'company', "company TEXT NOT NULL DEFAULT 'megadino'");
addColumn('ml_listings', 'am_sku_id', 'am_sku_id TEXT');
db.exec('CREATE INDEX IF NOT EXISTS posts_company ON posts(company, updated_at)');
{
  // A conta do Instagram conectada antes de existirem várias empresas era da Megadino.
  const old = db.prepare("SELECT value FROM settings WHERE key = 'ig_account'").get() as { value: string } | undefined;
  if (old) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ig_account:megadino', ?)").run(old.value);
    db.prepare("DELETE FROM settings WHERE key = 'ig_account'").run();
  }
}

/** Configurações simples guardadas no banco (chave → texto). */
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}
export function setSetting(key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export type Role = 'admin' | 'editor';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: number;
  must_change: number;
  created_at: string;
  last_login_at: string | null;
}

/** Remove sessões vencidas (roda no início e a cada hora). */
export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}
