import { hashPassword } from '../server/security.mjs';

if (process.stdin.isTTY) {
  console.error('Introduce la contraseña por stdin para no dejarla en el historial. Consulta DEPLOYMENT.md.');
  process.exit(1);
}
let value = '';
for await (const chunk of process.stdin) {
  value += chunk;
  if (value.length > 260) throw new Error('La contraseña es demasiado larga.');
}
const password = value.replace(/\r?\n$/, '');
if (password.length < 14 || password.length > 256) throw new Error('Usa una contraseña de entre 14 y 256 caracteres.');
console.log(await hashPassword(password));
