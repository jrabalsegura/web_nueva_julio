import { DatabaseSync, backup } from 'node:sqlite';

process.umask(0o077);
const destination = process.argv[2];
if (!destination) throw new Error('Uso: node scripts/backup.mjs /ruta/copia.sqlite');
const db = new DatabaseSync(process.env.DATABASE_PATH || './data/contacts.sqlite');
try { await backup(db, destination); console.log('Copia de seguridad creada.'); }
finally { db.close(); }
