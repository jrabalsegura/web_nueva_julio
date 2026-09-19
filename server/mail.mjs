import nodemailer from 'nodemailer';

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
          if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP_RECIPIENT_REJECTED');
          db.prepare("UPDATE contacts SET mail_status = 'sent', mail_sent_at = ?, mail_attempts = mail_attempts + 1, mail_error = NULL WHERE id = ?")
            .run(new Date().toISOString(), row.id);
        } catch (error) {
          const attempts = row.mail_attempts + 1;
          const delay = Math.min(60 * 60 * 1000, 30000 * 2 ** Math.min(attempts - 1, 7));
          // Do not persist SMTP responses: they can contain addresses or credentials.
          const code = /^[A-Z_]{2,40}$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
          db.prepare("UPDATE contacts SET mail_status = 'failed', mail_attempts = ?, mail_next_attempt = ?, mail_error = ? WHERE id = ?")
            .run(attempts, Date.now() + delay, code, row.id);
          logger.warn(`Aviso de correo #${row.id} pendiente de reintento (${code}).`);
        }
      }
    } finally { running = false; }
  }
  return { flush };
}
