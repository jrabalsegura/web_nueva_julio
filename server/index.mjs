import { createApp, readConfig } from './app.mjs';
import { openDatabase } from './database.mjs';
import { createMailer, mailTransport } from './mail.mjs';

process.umask(0o077);
const config = readConfig();
const transport = mailTransport(process.env, config.origin);
const db = openDatabase(process.env.DATABASE_PATH || './data/contacts.sqlite');
const mailer = createMailer({ db, transport, from: process.env.MAIL_FROM, to: process.env.MAIL_TO, origin: config.origin });
const app = createApp({ config, db, mailer });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`Resolution Solar Energy: ${config.origin} (puerto interno ${port})`));
const flush = () => mailer.flush().catch(() => console.error('Error al procesar la cola de correo.'));
const timer = setInterval(flush, 15000);
timer.unref();
void flush();
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 20000).unref();
  });
}
