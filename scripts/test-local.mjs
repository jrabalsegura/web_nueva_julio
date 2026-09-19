import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const env = parseEnv(await readFile(new URL('.env', root), 'utf8'));
const origin = env.APP_ORIGIN;
assert.equal(new URL(origin).hostname, 'localhost', 'Esta prueba solo se ejecuta en localhost.');
assert.equal(env.MAIL_TO, 'admin@resolution.test', 'Esta prueba requiere el destinatario de Mailpit.');
assert.equal(env.SMTP_HOST, 'mailpit', 'Esta prueba requiere el SMTP local de Mailpit.');
const credentials = await readFile(new URL('.local/admin-credentials.txt', root), 'utf8');
const username = credentials.match(/^Usuario: (.+)$/m)[1];
const password = credentials.match(/^Contraseña: (.+)$/m)[1];
const call = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(10000), headers: { Origin: origin, ...options.headers } });
assert.equal((await call('/healthz')).status, 200);
assert.equal((await call('/admin/')).status, 200);
assert.equal((await call('/api/admin/contacts')).status, 401);
const login = await call('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
assert.equal(login.status, 200);
const { csrfToken } = await login.json();
const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' };

if (process.argv.includes('--verify-persistence')) {
  const previous = JSON.parse(await readFile(new URL('.local/last-test.json', root), 'utf8'));
  const response = await call(`/api/admin/contacts/${previous.id}`, { headers });
  assert.equal(response.status, 200);
  const contact = await response.json();
  assert.equal(contact.message, previous.message);
  assert.equal(contact.status, 'pending');
  assert.equal(contact.mail_status, 'sent');
  console.log(`Persistencia comprobada: solicitud #${contact.id} conservada después de recrear el contenedor.`);
} else {
  const before = await (await call('/api/admin/contacts', { headers })).json();
  const html = await (await call('/contacto.html')).text();
  assert.match(html, /action="\/api\/contact"/);
  const name = 'Prueba local · instalación fotovoltaica';
  const message = `PRUEBA LOCAL ${randomUUID()}\nSolicitud de ejemplo para comprobar el formulario, la bandeja privada y el aviso por correo.\nInterés en paneles solares para una vivienda en Murcia.`;
  const body = {
    name, email: 'cliente@example.test', phone: '+34 600 123 456', service: 'fotovoltaica', message,
    language: 'es', privacy: 'on', submission_id: html.match(/name="submission_id" value="([^"]+)"/)[1], _honey: ''
  };
  assert.equal((await call('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 201);
  assert.equal((await call('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 200);
  const after = await (await call('/api/admin/contacts', { headers })).json();
  assert.equal(after.counts.total, before.counts.total + 1, 'Un reintento no debe duplicar la solicitud.');
  const id = after.contacts[0].id;
  let contact;
  for (let i = 0; i < 30; i++) {
    contact = await (await call(`/api/admin/contacts/${id}`, { headers })).json();
    if (contact.mail_status === 'sent') break;
    await delay(500);
  }
  assert.equal(contact.message, message);
  assert.equal(contact.mail_status, 'sent', `Aviso SMTP pendiente: ${contact.mail_error}`);
  const mailbox = await (await fetch('http://localhost:8025/api/v1/messages')).json();
  const email = mailbox.messages.find((item) => item.Subject.includes(`#${id} ·`));
  assert.ok(email, 'El correo debe aparecer en Mailpit.');
  const received = await (await fetch(`http://localhost:8025/api/v1/message/${email.ID}`)).json();
  assert.ok(received.Text.replaceAll('\r\n', '\n').includes(message), 'El correo debe contener el mensaje completo.');
  assert.equal(received.ReplyTo[0].Address, body.email);
  assert.equal((await call(`/api/admin/contacts/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'handled' }) })).status, 200);
  const handled = await (await call('/api/admin/contacts?status=handled', { headers })).json();
  assert.ok(handled.contacts.some((item) => item.id === id));
  await call(`/api/admin/contacts/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'pending' }) });
  await writeFile(new URL('.local/last-test.json', root), JSON.stringify({ id, message }), { mode: 0o600 });
  console.log(`Prueba completa superada: solicitud #${id}, reintento sin duplicados, login, consulta, cambio de estado y correo recibido en Mailpit.`);
}
assert.equal((await call('/api/admin/logout', { method: 'POST', headers })).status, 200);
assert.equal((await call('/api/admin/contacts', { headers })).status, 401);
console.log('Cierre de sesión comprobado.');
