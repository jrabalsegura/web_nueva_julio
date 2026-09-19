import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest, equalSecret, hashPassword, token, validPasswordHash, verifyPassword } from './security.mjs';

const services = {
  fotovoltaica: 'Solar fotovoltaica', 'solar-termica': 'Solar térmica', eolica: 'Eólica',
  aerotermia: 'Aerotermia / climatización', geotermia: 'Geotermia', hvac: 'HVAC / recuperación de calor',
  'suelo-radiante': 'Suelo radiante', 'fontaneria-gas': 'Fontanería y gas', drones: 'Inspección con drones',
  cargadores: 'Cargadores vehículo eléctrico', 'baja-tension': 'Baja tensión', 'alta-tension': 'Alta tensión',
  'industria-registro': 'Industria y registro', sat: 'SAT', mantenimiento: 'Mantenimiento preventivo / correctivo',
  'certificado-energetico': 'Certificados energéticos', aislamiento: 'Aislamiento térmico y acústico', otro: 'Otro servicio técnico'
};
const languages = ['es', 'en', 'fr', 'de'];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const errorJson = (res, status, message) => res.status(status).json({ success: false, message });

export function readConfig(env = process.env) {
  const url = new URL(env.APP_ORIGIN || 'http://localhost:3080');
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== url.href.replace(/\/$/, '') || url.username || url.password) {
    throw new Error('APP_ORIGIN debe contener únicamente el origen público, sin rutas.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('El acceso público requiere HTTPS. HTTP solo está permitido en localhost.');
  }
  if (!validPasswordHash(env.ADMIN_PASSWORD_HASH)) throw new Error('Configura ADMIN_PASSWORD_HASH: ejecuta npm run setup:local.');
  if (!env.ADMIN_USERNAME || env.ADMIN_USERNAME.length > 100) throw new Error('Configura ADMIN_USERNAME.');
  return {
    origin: url.origin, secure: url.protocol === 'https:',
    username: env.ADMIN_USERNAME, passwordHash: env.ADMIN_PASSWORD_HASH,
    publicDir: resolve(env.PUBLIC_DIR || '.'), adminDir: resolve('admin'),
    trustProxy: env.TRUST_PROXY || false
  };
}

export function createApp({ config, db, mailer, logger = console }) {
  const app = express();
  const cookieName = config.secure ? '__Host-rse_admin' : 'rse_admin';
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' };
  // Environment credentials only bootstrap the account. A restart must never
  // restore an old password after the administrator has changed it in the UI.
  db.prepare('INSERT OR IGNORE INTO admin_account (id, username, password_hash, updated_at) VALUES (1, ?, ?, ?)')
    .run(config.username, config.passwordHash, new Date().toISOString());
  const account = () => db.prepare('SELECT * FROM admin_account WHERE id = 1').get();
  const versionOf = (admin) => digest(`${admin.username}:${admin.password_hash}`);
  const sessionDuration = 8 * 60 * 60 * 1000;
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    strictTransportSecurity: config.secure ? undefined : false,
    contentSecurityPolicy: { directives: {
      'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'], 'form-action': ["'self'"],
      'upgrade-insecure-requests': config.secure ? [] : null
    } }
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/admin', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 30 }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.origin) {
      return errorJson(res, 403, 'Origen de la petición no permitido.');
    }
    next();
  });
  const limiter = (limit, windowMs, extra = {}) => rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' }, ...extra
  });
  // Share the budget: changing passwords must not offer a second login oracle.
  const authLimits = [
    limiter(5, 15 * 60 * 1000, { skipSuccessfulRequests: true }),
    limiter(30, 15 * 60 * 1000, { keyGenerator: () => 'all-logins', skipSuccessfulRequests: true })
  ];
  function sessionFor(req) {
    const raw = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(raw || '')) return undefined;
    return db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND credential_version = ? AND expires_at > ?')
      .get(digest(raw), versionOf(account()), Date.now());
  }
  function requireSession(req, res, next) {
    const session = sessionFor(req);
    if (!session) return errorJson(res, 401, 'Inicia sesión para continuar.');
    if (!['GET', 'HEAD'].includes(req.method) && !equalSecret(req.get('x-csrf-token'), session.csrf_token)) {
      return errorJson(res, 403, 'La sesión no permite esta operación. Recarga la página.');
    }
    req.adminSession = session;
    next();
  }
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  app.post('/api/admin/login', ...authLimits, async (req, res) => {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || username.length > 100 || typeof password !== 'string' || password.length > 256) {
        return errorJson(res, 400, 'Introduce el usuario y la contraseña.');
      }
      const admin = account();
      const correctPassword = await verifyPassword(password, admin.password_hash);
      if (!equalSecret(username, admin.username) || !correctPassword || versionOf(account()) !== versionOf(admin)) {
        return errorJson(res, 401, 'Usuario o contraseña incorrectos.');
      }
      const credentialVersion = versionOf(admin);
      const old = sessionFor(req);
      if (old) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(old.token_hash);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR credential_version != ?').run(Date.now(), credentialVersion);
      const sessionToken = token();
      const csrfToken = token();
      db.prepare('INSERT INTO sessions (token_hash, csrf_token, credential_version, expires_at) VALUES (?, ?, ?, ?)')
        .run(digest(sessionToken), csrfToken, credentialVersion, Date.now() + sessionDuration);
      res.cookie(cookieName, sessionToken, { ...cookieOptions, maxAge: sessionDuration });
      res.json({ username: admin.username, csrfToken });
    });
  // Available from the login form, with explicit reauthentication. Origin checks
  // and the shared attempt limit also apply without an existing session.
  app.post('/api/admin/change-password', ...authLimits, async (req, res) => {
    const { username, currentPassword, newPassword, confirmPassword } = req.body || {};
    if (typeof username !== 'string' || username.length > 100 || typeof currentPassword !== 'string' || currentPassword.length > 256) {
      return errorJson(res, 400, 'Introduce el usuario y la contraseña actual.');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 14 || newPassword.length > 256) {
      return errorJson(res, 400, 'La nueva contraseña debe tener entre 14 y 256 caracteres.');
    }
    if (newPassword !== confirmPassword) return errorJson(res, 400, 'Las contraseñas nuevas no coinciden.');
    const admin = account();
    const correctPassword = await verifyPassword(currentPassword, admin.password_hash);
    if (!equalSecret(username, admin.username) || !correctPassword) return errorJson(res, 401, 'Usuario o contraseña actual incorrectos.');
    if (equalSecret(currentPassword, newPassword)) return errorJson(res, 400, 'Elige una contraseña diferente a la actual.');
    const newHash = await hashPassword(newPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE admin_account SET password_hash = ?, updated_at = ? WHERE id = 1 AND username = ? AND password_hash = ?')
        .run(newHash, new Date().toISOString(), admin.username, admin.password_hash);
      if (result.changes !== 1) {
        db.exec('ROLLBACK');
        return errorJson(res, 409, 'La contraseña ha cambiado durante la operación. Utiliza la contraseña vigente.');
      }
      db.prepare('DELETE FROM sessions').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.clearCookie(cookieName, cookieOptions);
    res.json({ success: true, message: 'Contraseña cambiada. Inicia sesión con la nueva contraseña.' });
  });
  app.use('/api/admin', requireSession);
  app.get('/api/admin/session', (req, res) => res.json({ username: account().username, csrfToken: req.adminSession.csrf_token }));
  app.post('/api/admin/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.adminSession.token_hash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ success: true });
  });
  app.get('/api/admin/contacts', (req, res) => {
    const status = req.query.status || 'all';
    const page = Number(req.query.page || 1);
    if (!['all', 'pending', 'handled'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
      return errorJson(res, 400, 'Filtro no válido.');
    }
    const where = status === 'all' ? '' : 'WHERE status = ?';
    const params = status === 'all' ? [] : [status];
    const total = db.prepare(`SELECT COUNT(*) AS count FROM contacts ${where}`).get(...params).count;
    const contacts = db.prepare(`SELECT id, name, email, service, language, created_at, status, mail_status FROM contacts ${where} ORDER BY id DESC LIMIT 25 OFFSET ?`).all(...params, (page - 1) * 25);
    const counts = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'pending'), 0) AS pending FROM contacts").get();
    res.json({ contacts, total, page, pages: Math.max(1, Math.ceil(total / 25)), counts });
  });
  app.param('id', (req, res, next, value) => {
    if (!/^[1-9]\d{0,14}$/.test(value)) return errorJson(res, 404, 'Solicitud no encontrada.');
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(value));
    if (!contact) return errorJson(res, 404, 'Solicitud no encontrada.');
    req.contact = contact;
    next();
  });
  app.get('/api/admin/contacts/:id', (req, res) => {
    const { submission_id, payload_hash, ...contact } = req.contact;
    res.json(contact);
  });
  app.patch('/api/admin/contacts/:id', (req, res) => {
    if (!['pending', 'handled'].includes(req.body?.status)) return errorJson(res, 400, 'Estado no válido.');
    db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run(req.body.status, req.contact.id);
    res.json({ success: true });
  });
  app.post('/api/admin/contacts/:id/retry-email', limiter(10, 60 * 1000), (req, res) => {
    if (req.contact.mail_status !== 'sent') {
      db.prepare("UPDATE contacts SET mail_status = 'pending', mail_next_attempt = 0 WHERE id = ?").run(req.contact.id);
      void mailer.flush().catch(() => logger.error('No se pudo procesar la cola de correo.'));
    }
    res.json({ success: true });
  });

  app.post('/api/contact', limiter(10, 15 * 60 * 1000), (req, res) => {
    const body = req.body || {};
    if (body._honey) return res.json({ success: true });
    const fields = {};
    for (const [key, min, max] of [['name', 1, 120], ['email', 3, 254], ['phone', 6, 40], ['message', 10, 5000]]) {
      if (typeof body[key] !== 'string') return errorJson(res, 400, 'Revisa los campos del formulario.');
      fields[key] = body[key].trim();
      if (fields[key].length < min || fields[key].length > max || (key !== 'message' && /[\r\n\x00-\x1f]/.test(fields[key]))) {
        return errorJson(res, 400, 'Revisa los campos del formulario.');
      }
    }
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email) ||
      !Object.hasOwn(services, body.service) || !languages.includes(body.language) ||
      ![true, 'on', 'true'].includes(body.privacy) || !uuidPattern.test(body.submission_id || '')) {
      return errorJson(res, 400, 'Revisa los campos y acepta la política de privacidad.');
    }
    fields.service = services[body.service];
    fields.language = body.language;
    const payloadHash = digest(JSON.stringify(fields));
    const existing = db.prepare('SELECT payload_hash FROM contacts WHERE submission_id = ?').get(body.submission_id);
    if (existing && existing.payload_hash !== payloadHash) return errorJson(res, 409, 'Este envío ya se recibió con otros datos. Recarga el formulario.');
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO contacts (submission_id, payload_hash, name, email, phone, service, message, language, privacy_accepted_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(body.submission_id, payloadHash, fields.name, fields.email, fields.phone, fields.service, fields.message, fields.language, now, now);
    }
    void mailer.flush().catch(() => logger.error('No se pudo procesar la cola de correo.'));
    if (req.is('application/json')) return res.status(existing ? 200 : 201).json({ success: true });
    const labels = {
      es: ['Solicitud recibida', 'Gracias. Nos pondremos en contacto contigo.', 'Volver a contacto'],
      en: ['Request received', 'Thank you. We will be in touch.', 'Back to contact'],
      fr: ['Demande reçue', 'Merci. Nous vous contacterons prochainement.', 'Retour au contact'],
      de: ['Anfrage erhalten', 'Vielen Dank. Wir melden uns bei Ihnen.', 'Zurück zum Kontakt']
    }[fields.language];
    const back = fields.language === 'es' ? '/contacto.html' : `/${fields.language}/contacto.html`;
    res.type('html').send(`<!doctype html><html lang="${fields.language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${labels[0]}</title><link rel="stylesheet" href="/assets/css/styles.css"><main class="container section"><h1>${labels[0]}</h1><p>${labels[1]}</p><a class="btn btn-primary" href="${back}">${labels[2]}</a></main></html>`);
  });

  app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(join(config.adminDir, 'index.html')));
  for (const asset of ['admin.css', 'admin.js']) {
    app.get(`/admin/${asset}`, (_req, res) => res.sendFile(join(config.adminDir, asset)));
  }
  // Only public assets and named pages are served; never expose the repository root.
  app.use('/assets', express.static(join(config.publicDir, 'assets'), { dotfiles: 'deny', index: false, maxAge: '1h' }));
  app.get(/^\/(?:(en|fr|de)\/)?(?:(index|contacto|servicios|proyectos|sobre-nosotros)\.html)?$/, async (req, res) => {
    const locale = req.params[0] || '';
    const page = req.params[1] || 'index';
    let html = await readFile(join(config.publicDir, locale, `${page}.html`), 'utf8');
    if (page === 'contacto') {
      html = html.replace(/data-contact-form action="[^"]+"/, 'data-contact-form data-self-hosted="true" action="/api/contact"');
      html = html.replace(/(<form[^>]*data-contact-form[^>]*>)/, `$1\n<input type="hidden" name="language" value="${locale || 'es'}"><input type="hidden" name="submission_id" value="${randomUUID()}">`);
      res.set('Cache-Control', 'no-store');
    }
    res.type('html').send(html);
  });
  app.use((_req, res) => errorJson(res, 404, 'Página no encontrada.'));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) logger.error('Error interno en la petición.', error.code || error.name);
    errorJson(res, status, status === 500 ? 'No se pudo completar la operación. Inténtalo de nuevo.' : 'La petición no es válida.');
  });
  return app;
}
