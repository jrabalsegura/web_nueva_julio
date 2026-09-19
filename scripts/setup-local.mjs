import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/security.mjs';

const root = new URL('../', import.meta.url);
try {
  await access(new URL('.env', root));
  console.log('Ya existe .env; se conserva su configuración. Credenciales locales, si se generaron aquí: .local/admin-credentials.txt');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(18).toString('base64url');
  const hash = await hashPassword(password);
  const example = await readFile(new URL('.env.example', root), 'utf8');
  await mkdir(new URL('.local/', root), { recursive: true, mode: 0o700 });
  await writeFile(new URL('.local/admin-credentials.txt', root), `Usuario: admin\nContraseña: ${password}\nPanel: http://localhost:3080/admin/\n\nEsta es la contraseña inicial. Al cambiarla desde /admin, la nueva se guarda únicamente como hash en la base de datos y este archivo no se actualiza.\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(new URL('.env', root), example.replace('ADMIN_PASSWORD_HASH=\n', `ADMIN_PASSWORD_HASH=${hash}\n`), { flag: 'wx', mode: 0o600 });
  console.log(`Entorno local preparado. Credenciales: ${fileURLToPath(new URL('.local/admin-credentials.txt', root))}`);
  console.log('Arrancar: docker compose up -d --build');
}
