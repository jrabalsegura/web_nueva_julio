import test from 'node:test';
import assert from 'node:assert/strict';
import { formSubmitTransport, mailTransport } from '../server/mail.mjs';

const to = 'owner@example.test';
const origin = 'https://solar.example';
const mail = { replyTo: { name: 'Cliente', address: 'cliente@example.test' }, subject: 'Solicitud #1', text: 'Mensaje completo\nIdioma: es' };

test('FormSubmit envía al destinatario configurado sin SMTP y conserva Reply-To y URL pública', async () => {
  let calls = 0;
  const transport = mailTransport({ MAIL_TRANSPORT: 'formsubmit', MAIL_TO: to }, origin, async (url, options) => {
    calls++;
    assert.equal(url, 'https://formsubmit.co/ajax/owner%40example.test');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.email, mail.replyTo.address);
    assert.equal(body._replyto, mail.replyTo.address);
    assert.equal(body.message, mail.text);
    assert.equal(body._subject, mail.subject);
    assert.equal(body._url, `${origin}/contacto.html`);
    return Response.json({ success: 'true', message: 'The form was submitted successfully.' });
  });
  assert.deepEqual(await transport.sendMail(mail), { accepted: [to], rejected: [] });
  assert.equal(calls, 1);
});

test('FormSubmit nunca trata activación, rechazo, error HTTP o respuesta inválida como entrega', async () => {
  const cases = [
    [() => Response.json({ success: 'false', message: 'Check your email and activate the form.' }), 'FORMSUBMIT_ACTIVATION_REQUIRED'],
    [() => Response.json({ success: true, message: 'Confirm your email first.' }), 'FORMSUBMIT_ACTIVATION_REQUIRED'],
    [() => Response.json({ success: false }), 'FORMSUBMIT_REJECTED'],
    [() => Response.json(null), 'FORMSUBMIT_REJECTED'],
    [() => new Response('Blocked', { status: 429 }), 'FORMSUBMIT_HTTP_ERROR'],
    [() => new Response('<html>Failure</html>'), 'FORMSUBMIT_INVALID_RESPONSE'],
  ];
  for (const [response, code] of cases) {
    const transport = formSubmitTransport({ to, origin, fetchRequest: async () => response() });
    await assert.rejects(transport.sendMail(mail), { code });
  }
  const offline = formSubmitTransport({ to, origin, fetchRequest: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.sendMail(mail), /fetch failed/);
});

test('La configuración falla al arrancar si falta destinatario, proveedor válido o SMTP requerido', () => {
  assert.throws(() => mailTransport({ MAIL_TRANSPORT: 'formsubmit' }, origin), /MAIL_TO/);
  assert.throws(() => mailTransport({ MAIL_TRANSPORT: 'formsubmit', MAIL_TO: 'invalid' }, origin), /dirección/);
  assert.throws(() => mailTransport({ MAIL_TRANSPORT: 'unknown', MAIL_TO: to }, origin), /MAIL_TRANSPORT/);
  assert.throws(() => mailTransport({ MAIL_TO: to }, origin), /SMTP_HOST/);
});
