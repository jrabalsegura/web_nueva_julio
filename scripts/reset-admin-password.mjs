import { existsSync } from 'node:fs';
import { openDatabase } from '../server/database.mjs';
import { validPasswordHash } from '../server/security.mjs';

// Explicit maintenance command, available only to someone with server access.
// Never run at startup: environment bootstrap values may be obsolete.
if (!process.argv.includes('--from-env')) throw new Error('Para restablecer expresamente desde el entorno, añade --from-env.');
const path = process.env.DATABASE_PATH || './data/contacts.sqlite';
if (!existsSync(path)) throw new Error('No se encuentra la base de datos existente.');
if (!validPasswordHash(process.env.ADMIN_PASSWORD_HASH) || !process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME.length > 100) {
  throw new Error('Configura un usuario y un hash de contraseña válidos en el entorno.');
}
process.umask(0o077);
const db = openDatabase(path);
try {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO admin_account (id, username, password_hash, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, updated_at = excluded.updated_at')
    .run(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD_HASH, new Date().toISOString());
  db.prepare('DELETE FROM sessions').run();
  db.exec('COMMIT');
  console.log('Credenciales restablecidas desde el entorno. Todas las sesiones se han cerrado.');
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
