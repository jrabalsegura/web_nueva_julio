import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp, readConfig } from '../server/app.mjs';
import { openDatabase } from '../server/database.mjs';
import { createMailer } from '../server/mail.mjs';
import { hashPassword, verifyPassword } from '../server/security.mjs';

const password = 'Una-contraseña-de-pruebas-482';
const passwordHash = await hashPassword(password);
const origin = 'http://localhost:3080';
const quiet = { warn() {}, error() {} };
const payload = (changes = {}) => ({
  name: 'Prueba <script>alert(1)</script>', email: 'cliente@example.test', phone: '+34 600 123 456',
  service: 'fotovoltaica', message: 'Quiero información para instalar paneles solares.', language: 'es',
  privacy: 'on', submission_id: randomUUID(), ...changes
});

async function fixture(t, sendMail) {
  const directory = await mkdtemp(join(tmpdir(), 'rse-backend-'));
  let db = openDatabase(join(directory, 'contacts.sqlite'));
  const sent = [];
  const transport = { sendMail: sendMail || (async (mail) => { sent.push(mail); return { accepted: ['owner@example.test'], rejected: [] }; }) };
  let mailer = createMailer({ db, transport, from: 'web@example.test', to: 'owner@example.test', origin, logger: quiet });
  const config = { origin, username: 'admin', passwordHash, secure: false, publicDir: resolve('.'), adminDir: resolve('admin'), trustProxy: false };
  let server = createApp({ config, db, mailer, logger: quiet }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  let url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((done) => server.close(done));
    db.close(); await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { body, method = 'GET', headers = {} } = {}) {
    return fetch(url + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  }
  async function login(currentPassword = password) {
    const response = await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: currentPassword } });
    assert.equal(response.status, 200);
    const session = await response.json();
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    return { Cookie: cookie.split(';')[0], 'X-CSRF-Token': session.csrfToken };
  }
  async function restart() {
    await new Promise((done) => server.close(done)); db.close();
    db = openDatabase(join(directory, 'contacts.sqlite'));
    mailer = createMailer({ db, transport, from: 'web@example.test', to: 'owner@example.test', origin, logger: quiet });
    server = createApp({ config, db, mailer, logger: quiet }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}`;
  }
  return { request, login, get db() { return db; }, mailer, sent, url, config, restart };
}

test('Sirve las cuatro versiones con backend y conserva FormSubmit en los archivos estáticos', async (t) => {
  const { request } = await fixture(t);
  for (const locale of ['', 'en/', 'fr/', 'de/']) {
    const response = await request(`/${locale}contacto.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.match(html, /data-self-hosted="true" action="\/api\/contact"/);
    assert.match(html, /name="submission_id" value="[a-f0-9-]{36}"/);
    assert.match(html, new RegExp(`name="language" value="${locale.slice(0, 2) || 'es'}"`));
    const source = await readFile(`${locale}contacto.html`, 'utf8');
    assert.match(source, /action="https:\/\/formsubmit.co\//);
    assert.doesNotMatch(source, /data-self-hosted/);
  }
  for (const path of ['/', '/en/', '/admin/', '/admin/admin.js', '/assets/css/styles.css']) assert.equal((await request(path)).status, 200);
  for (const path of ['/.env', '/data/contacts.sqlite', '/server/app.mjs', '/package.json', '/.local/admin-credentials.txt', '/DEPLOYMENT.md']) {
    assert.equal((await request(path)).status, 404, path);
  }
});

test('La API privada exige sesión, origen correcto y CSRF; logout revoca la cookie', async (t) => {
  const { request, login, db } = await fixture(t);
  for (const path of ['/api/admin/session', '/api/admin/contacts', '/api/admin/contacts/1']) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/api/admin/contacts/1', { method: 'PATCH', body: { status: 'handled' } })).status, 401);
  assert.equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  assert.equal((await request('/api/admin/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { username: 'admin', password } })).status, 403);
  const headers = await login();
  assert.equal((await request('/api/admin/session', { headers })).status, 200);
  assert.equal((await request('/api/contact', { method: 'POST', body: payload() })).status, 201);
  const id = db.prepare('SELECT id FROM contacts').get().id;
  assert.equal((await request(`/api/admin/contacts/${id}`, { headers: { Cookie: headers.Cookie }, method: 'PATCH', body: { status: 'handled' } })).status, 403);
  assert.equal((await request(`/api/admin/contacts/${id}`, { headers: { ...headers, Origin: 'https://evil.example' }, method: 'PATCH', body: { status: 'handled' } })).status, 403);
  assert.equal((await request(`/api/admin/contacts/${id}`, { headers, method: 'PATCH', body: { status: 'handled' } })).status, 200);
  const filtered = await (await request('/api/admin/contacts?status=handled', { headers })).json();
  assert.equal(filtered.total, 1); assert.equal(filtered.counts.pending, 0);
  const detailResponse = await request(`/api/admin/contacts/${id}`, { headers });
  assert.equal(detailResponse.headers.get('cache-control'), 'no-store');
  const detail = await detailResponse.json();
  assert.equal(detail.status, 'handled'); assert.equal(detail.submission_id, undefined);
  assert.equal((await request('/api/admin/logout', { headers, method: 'POST' })).status, 200);
  assert.equal((await request('/api/admin/contacts', { headers })).status, 401);
});

test('Valida en servidor, filtra el honeypot y no duplica mensajes ni correos al reintentar', async (t) => {
  const { request, db, sent } = await fixture(t);
  for (const invalid of [{ privacy: false }, { email: 'bad' }, { name: 'x\r\nBcc: evil@test.com' }, { service: 'invalid' }, { language: 'xx' }]) {
    assert.equal((await request('/api/contact', { method: 'POST', body: payload(invalid) })).status, 400);
  }
  assert.equal((await request('/api/contact', { method: 'POST', body: payload({ _honey: 'spam' }) })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contacts').get().count, 0);
  const contact = payload();
  assert.equal((await request('/api/contact', { method: 'POST', body: contact })).status, 201);
  assert.equal((await request('/api/contact', { method: 'POST', body: contact })).status, 200);
  assert.equal((await request('/api/contact', { method: 'POST', body: { ...contact, message: 'Un texto diferente para el mismo identificador.' } })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contacts').get().count, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0].replyTo.address, contact.email);
  assert.equal(sent[0].to, 'owner@example.test'); assert.match(sent[0].text, /Idioma: es/);
  assert.equal(db.prepare('SELECT mail_status FROM contacts').get().mail_status, 'sent');
  const adminCode = await readFile('admin/admin.js', 'utf8');
  assert.doesNotMatch(adminCode, /innerHTML|insertAdjacentHTML/);
});

test('El formulario funciona sin JavaScript y devuelve confirmación en el idioma correcto', async (t) => {
  const { url, db } = await fixture(t);
  const form = new URLSearchParams(payload({ language: 'fr' }));
  const response = await fetch(`${url}/api/contact`, { method: 'POST', headers: { Origin: origin }, body: form });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /Demande reçue/);
  assert.equal(db.prepare('SELECT language FROM contacts').get().language, 'fr');
});

test('Conserva solicitudes cuando falla SMTP y la cola se recupera desde SQLite', async (t) => {
  let broken = true;
  const { request, login, db, config } = await fixture(t, async () => {
    if (broken) throw Object.assign(new Error('Secret SMTP response'), { code: 'ECONNECTION' });
    return { accepted: ['owner@example.test'], rejected: [] };
  });
  assert.equal((await request('/api/contact', { method: 'POST', body: payload() })).status, 201);
  for (let i = 0; i < 30 && db.prepare('SELECT mail_status FROM contacts').get().mail_status !== 'failed'; i++) await delay(10);
  const row = db.prepare('SELECT * FROM contacts').get();
  assert.equal(row.mail_status, 'failed'); assert.equal(row.mail_error, 'ECONNECTION'); assert.ok(row.message);
  assert.ok(row.mail_next_attempt > Date.now());
  broken = false;
  // A fresh mailer reads the durable queue, as it would after a process restart.
  const recovered = createMailer({ db, origin: config.origin, from: 'web@example.test', to: 'owner@example.test', logger: quiet,
    transport: { sendMail: async () => ({ accepted: ['owner@example.test'], rejected: [] }) } });
  db.prepare('UPDATE contacts SET mail_next_attempt = 0').run();
  await recovered.flush();
  const sent = db.prepare('SELECT * FROM contacts').get();
  assert.equal(sent.mail_status, 'sent'); assert.equal(sent.mail_attempts, 2); assert.equal(sent.mail_error, null);
  const headers = await login();
  assert.equal((await request(`/api/admin/contacts/${row.id}/retry-email`, { method: 'POST', headers })).status, 200);
  assert.equal(db.prepare('SELECT mail_attempts FROM contacts').get().mail_attempts, 2);
});

test('Caducan las sesiones y se limita la fuerza bruta en el login', async (t) => {
  const { request, login, db } = await fixture(t);
  const headers = await login();
  db.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await request('/api/admin/session', { headers })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  const response = await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password } });
  assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'));
});

test('La configuración pública exige HTTPS y un hash de contraseña válido', () => {
  const env = { APP_ORIGIN: 'https://solar.example', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: passwordHash };
  assert.equal(readConfig(env).secure, true);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://solar.example' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'https://solar.example/path' }), /origen público/);
  assert.throws(() => readConfig({ ...env, ADMIN_PASSWORD_HASH: 'plaintext' }), /ADMIN_PASSWORD_HASH/);
});

test('Cambiar contraseña desde el acceso revoca todas las sesiones y persiste después de reiniciar', async (t) => {
  const f = await fixture(t);
  const first = await f.login(), second = await f.login();
  const newPassword = 'Una frase nueva y privada 735';
  const response = await f.request('/api/admin/change-password', { method: 'POST', body: {
    username: 'admin', currentPassword: password, newPassword, confirmPassword: newPassword
  } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true); assert.equal(result.password, undefined); assert.equal(result.passwordHash, undefined);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  const stored = f.db.prepare('SELECT password_hash FROM admin_account').get().password_hash;
  assert.notEqual(stored, newPassword); assert.notEqual(stored, passwordHash);
  assert.equal(await verifyPassword(newPassword, stored), true);
  for (const headers of [first, second]) assert.equal((await f.request('/api/admin/contacts', { headers })).status, 401);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { username: 'admin', password } })).status, 401);
  await f.login(newPassword);
  await f.restart();
  assert.equal(f.db.prepare('SELECT password_hash FROM admin_account').get().password_hash, stored);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { username: 'admin', password } })).status, 401);
  await f.login(newPassword);
});

test('El cambio rechaza origen ajeno, contraseña actual incorrecta y contraseñas nuevas no válidas', async (t) => {
  const { request, login, db } = await fixture(t);
  const session = await login();
  const input = { username: 'admin', currentPassword: password, newPassword: 'Una frase nueva y privada 735', confirmPassword: 'Una frase nueva y privada 735' };
  assert.equal((await request('/api/admin/change-password', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: input })).status, 403);
  for (const [changes, status] of [
    [{ currentPassword: 'incorrecta' }, 401], [{ username: 'otro' }, 401],
    [{ confirmPassword: 'No coincide' }, 400], [{ newPassword: 'corta', confirmPassword: 'corta' }, 400],
    [{ newPassword: password, confirmPassword: password }, 400]
  ]) assert.equal((await request('/api/admin/change-password', { method: 'POST', body: { ...input, ...changes } })).status, status);
  assert.equal(db.prepare('SELECT password_hash FROM admin_account').get().password_hash, passwordHash);
  assert.equal((await request('/api/admin/session', { headers: session })).status, 200);
});

test('Login y cambio de contraseña comparten el límite de intentos', async (t) => {
  const { request } = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const change = i % 2 === 0;
    const body = change ? { username: 'admin', currentPassword: 'incorrecta', newPassword: 'Otra contraseña de prueba 123', confirmPassword: 'Otra contraseña de prueba 123' } : { username: 'admin', password: 'incorrecta' };
    assert.equal((await request(`/api/admin/${change ? 'change-password' : 'login'}`, { method: 'POST', body })).status, 401);
  }
  assert.equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password } })).status, 429);
});

test('Dos cambios simultáneos no pueden sobrescribirse usando la misma contraseña antigua', async (t) => {
  const { request, login } = await fixture(t);
  const passwords = ['Primera contraseña nueva 483', 'Segunda contraseña nueva 936'];
  const responses = await Promise.all(passwords.map((newPassword) => request('/api/admin/change-password', { method: 'POST', body: {
    username: 'admin', currentPassword: password, newPassword, confirmPassword: newPassword
  } })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winner = responses.findIndex((response) => response.status === 200);
  await login(passwords[winner]);
  assert.equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: passwords[1 - winner] } })).status, 401);
});
