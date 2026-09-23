import nodemailer from 'nodemailer';

export function mailTransport(env, origin, fetchRequest = fetch) {
  if (!env.MAIL_TO) throw new Error('Falta la configuración MAIL_TO.');
  const provider = env.MAIL_TRANSPORT || 'smtp';
  if (provider === 'formsubmit') return formSubmitTransport({ to: env.MAIL_TO, origin, fetchRequest });
  if (provider !== 'smtp') throw new Error('MAIL_TRANSPORT debe ser smtp o formsubmit.');
  for (const key of ['SMTP_HOST', 'MAIL_FROM']) {
    if (!env[key]) throw new Error(`Falta la configuración ${key}.`);
  }
  return smtpTransport(env);
}

export function formSubmitTransport({ to, origin, fetchRequest = fetch }) {
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(to)) throw new Error('MAIL_TO debe ser una dirección de correo.');
  const formUrl = `${origin}/contacto.html`;
  const failure = (code) => Object.assign(new Error(code), { code });
  return {
    async sendMail(mail) {
      const response = await fetchRequest(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: formUrl },
        body: JSON.stringify({
          name: mail.replyTo.name, email: mail.replyTo.address, message: mail.text,
          _replyto: mail.replyTo.address, _subject: mail.subject,
          _url: formUrl, _captcha: 'false', _template: 'table'
        }),
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      if (!response.ok) throw failure('FORMSUBMIT_HTTP_ERROR');
      let result;
      try { result = await response.json(); } catch { throw failure('FORMSUBMIT_INVALID_RESPONSE'); }
      if (/activat|confirm.*email|check.*email/i.test(result?.message || '')) {
        throw failure('FORMSUBMIT_ACTIVATION_REQUIRED');
      }
      if (result?.success !== true && result?.success !== 'true') throw failure('FORMSUBMIT_REJECTED');
      return { accepted: [to], rejected: [] };
    }
  };
}

export function smtpTransport(env) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

export function createMailer({ db, transport, from, to, origin, logger = console }) {
  let running = false;
  async function flush() {
    if (running) return;
    running = true;
    try {
      const rows = db.prepare("SELECT * FROM contacts WHERE mail_status != 'sent' AND mail_next_attempt <= ? ORDER BY id LIMIT 10").all(Date.now());
      for (const row of rows) {
        try {
          const result = await transport.sendMail({
            from, to, replyTo: { name: row.name, address: row.email },
            messageId: `<contact-${row.submission_id}@${new URL(origin).hostname}>`,
            subject: `Nueva solicitud #${row.id} · Resolution Solar Energy`,
            text: [
              `Nombre: ${row.name}`, `Email: ${row.email}`, `Teléfono: ${row.phone}`,
              `Servicio: ${row.service}`, `Idioma: ${row.language}`, `Fecha: ${row.created_at}`,
              '', row.message, '', `Consultar solicitud: ${origin}/admin/#${row.id}`
            ].join('\n')
          });
          if (!result.accepted?.length || result.rejected?.length) throw new Error('MAIL_RECIPIENT_REJECTED');
          db.prepare("UPDATE contacts SET mail_status = 'sent', mail_sent_at = ?, mail_attempts = mail_attempts + 1, mail_error = NULL WHERE id = ?")
            .run(new Date().toISOString(), row.id);
        } catch (error) {
          const attempts = row.mail_attempts + 1;
          // Activation needs the owner's click. Avoid repeating that email frequently.
          const delay = error.code === 'FORMSUBMIT_ACTIVATION_REQUIRED' ? 24 * 60 * 60 * 1000
            : Math.min(60 * 60 * 1000, 30000 * 2 ** Math.min(attempts - 1, 7));
          // Do not persist provider responses: they can contain addresses or credentials.
          const code = /^[A-Z_]{2,40}$/.test(error.code || '') ? error.code : 'MAIL_ERROR';
          db.prepare("UPDATE contacts SET mail_status = 'failed', mail_attempts = ?, mail_next_attempt = ?, mail_error = ? WHERE id = ?")
            .run(attempts, Date.now() + delay, code, row.id);
          logger.warn(`Aviso de correo #${row.id} pendiente de reintento (${code}).`);
        }
      }
    } finally { running = false; }
  }
  return { flush };
}
