import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) throw new Error('La base de datos requiere una versión más reciente de la aplicación.');
  if (version === 0) {
    db.exec(`
      BEGIN;
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY,
        submission_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        service TEXT NOT NULL,
        message TEXT NOT NULL,
        language TEXT NOT NULL,
        privacy_accepted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'handled')),
        mail_status TEXT NOT NULL DEFAULT 'pending' CHECK(mail_status IN ('pending', 'sent', 'failed')),
        mail_attempts INTEGER NOT NULL DEFAULT 0,
        mail_next_attempt INTEGER NOT NULL DEFAULT 0,
        mail_sent_at TEXT,
        mail_error TEXT
      );
      CREATE INDEX idx_contacts_status_id ON contacts(status, id DESC);
      CREATE INDEX idx_contacts_mail_due ON contacts(mail_next_attempt) WHERE mail_status != 'sent';
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        credential_version TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }
  if (version < 2) {
    db.exec(`
      BEGIN;
      CREATE TABLE admin_account (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }
  return db;
}
