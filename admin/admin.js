(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let csrfToken = '', currentUsername = '', filter = 'all', page = 1, pages = 1, selected = null, listRequest = 0, detailRequest = 0;
  const date = (value) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const localeNames = { es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán' };
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function showLogin(message = '') {
    csrfToken = ''; currentUsername = ''; selected = null; listRequest++; detailRequest++;
    $('inbox').hidden = true; $('logout').hidden = true; $('login-panel').hidden = false;
    $('password-panel').hidden = true; $('open-password-account').hidden = true; $('password-form').reset();
    $('password').value = ''; $('login-success').textContent = '';
    $('initial-loading').hidden = true; $('login-error').textContent = message;
    $('contact-list').replaceChildren(); $('detail').replaceChildren();
  }
  async function api(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
      credentials: 'same-origin', signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !['/login', '/change-password'].includes(path)) showLogin('Tu sesión ha caducado. Vuelve a entrar.');
      throw new Error(result.message || 'No se pudo completar la operación.');
    }
    return result;
  }
  function emptyDetail() {
    const box = element('div', undefined, 'empty');
    box.append(element('h2', 'Elige una solicitud'), element('p', 'Sus datos y el mensaje aparecerán aquí.'));
    $('detail').replaceChildren(box);
  }
  async function openInbox(session) {
    csrfToken = session.csrfToken;
    currentUsername = session.username;
    $('initial-loading').hidden = true; $('login-panel').hidden = true; $('inbox').hidden = false; $('logout').hidden = false;
    $('password-panel').hidden = true; $('open-password-account').hidden = false;
    $('password').value = ''; emptyDetail();
    await loadList();
    const id = location.hash.slice(1);
    if (/^[1-9]\d*$/.test(id)) await loadDetail(Number(id));
  }
  async function loadList() {
    const request = ++listRequest;
    $('inbox-error').textContent = '';
    $('contact-list').setAttribute('aria-busy', 'true');
    try {
      const data = await api(`/contacts?status=${filter}&page=${page}`);
      if (request !== listRequest) return;
      pages = data.pages;
      if (page > pages) { page = pages; return loadList(); }
      $('summary').textContent = `${data.counts.total} ${data.counts.total === 1 ? 'solicitud' : 'solicitudes'} · ${data.counts.pending} ${data.counts.pending === 1 ? 'pendiente' : 'pendientes'}`;
      $('contact-list').replaceChildren();
      for (const contact of data.contacts) {
        const row = element('button', undefined, 'contact-row');
        row.type = 'button'; row.dataset.id = contact.id; row.setAttribute('aria-current', String(contact.id === selected));
        const heading = element('span', undefined, 'row-heading');
        heading.append(element('span', contact.name, 'contact-name'), element('span', contact.status === 'pending' ? 'Pendiente' : 'Atendida', `badge ${contact.status}`));
        row.append(heading, element('span', contact.service, 'contact-service'), element('span', date(contact.created_at), 'contact-date'));
        row.addEventListener('click', () => loadDetail(contact.id, true));
        $('contact-list').append(row);
      }
      if (!data.contacts.length) {
        const box = element('div', undefined, 'empty');
        box.append(element('h2', filter === 'all' ? 'Todavía no hay solicitudes' : 'No hay solicitudes en este estado'), element('p', 'Las solicitudes enviadas desde la web aparecerán en esta bandeja.'));
        $('contact-list').append(box);
      }
      $('pagination').hidden = pages <= 1;
      $('page-label').textContent = `${page} / ${pages}`;
      $('previous').disabled = page <= 1; $('next').disabled = page >= pages;
    } catch (error) { if (request === listRequest) $('inbox-error').textContent = error.message; }
    finally { if (request === listRequest) $('contact-list').removeAttribute('aria-busy'); }
  }
  async function loadDetail(id, focus = false) {
    selected = id;
    const request = ++detailRequest;
    document.querySelectorAll('.contact-row').forEach((row) => row.setAttribute('aria-current', String(Number(row.dataset.id) === id)));
    $('detail').setAttribute('aria-busy', 'true');
    try {
      const contact = await api(`/contacts/${id}`);
      if (request !== detailRequest) return;
      history.replaceState(null, '', `#${id}`);
      const detail = $('detail'); detail.replaceChildren();
      const heading = element('div', undefined, 'detail-heading');
      heading.append(element('h2', contact.name), element('span', contact.status === 'pending' ? 'Pendiente' : 'Atendida', `badge ${contact.status}`));
      detail.append(heading, element('p', `Solicitud #${id} · ${date(contact.created_at)}`, 'detail-date'));
      const grid = element('dl', undefined, 'details-grid');
      for (const [label, value, href] of [['Email', contact.email, `mailto:${contact.email}`], ['Teléfono', contact.phone], ['Servicio', contact.service], ['Idioma', localeNames[contact.language]]]) {
        const wrapper = element('div'), dd = element('dd');
        if (href) { const link = element('a', value); link.href = href; dd.append(link); } else dd.textContent = value;
        wrapper.append(element('dt', label), dd); grid.append(wrapper);
      }
      detail.append(grid, element('h3', 'Mensaje', 'message-label'), element('p', contact.message, 'message'));
      const actions = element('div', undefined, 'detail-actions');
      const changeStatus = element('button', contact.status === 'pending' ? 'Marcar como atendida' : 'Marcar como pendiente', 'button primary');
      const reply = element('a', 'Responder por email', 'button secondary'); reply.href = `mailto:${contact.email}`;
      const feedback = element('p', '', 'error'); feedback.setAttribute('role', 'alert');
      changeStatus.addEventListener('click', async () => {
        changeStatus.disabled = true;
        try {
          await api(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ status: contact.status === 'pending' ? 'handled' : 'pending' }) });
          await loadList(); await loadDetail(id);
        } catch (error) { feedback.textContent = error.message; changeStatus.disabled = false; }
      });
      actions.append(changeStatus, reply); detail.append(actions, feedback);
      const mail = element('div', undefined, 'mail-panel');
      mail.append(element('p', contact.mail_status === 'sent' ? `Aviso por correo enviado · ${date(contact.mail_sent_at)}` : contact.mail_error === 'FORMSUBMIT_ACTIVATION_REQUIRED' ? 'Activa el formulario desde el correo de FormSubmit recibido en el buzón destinatario. Después pulsa «Reintentar aviso ahora». La solicitud está guardada; el reintento automático será dentro de 24 horas.' : contact.mail_status === 'failed' ? 'El aviso por correo no se ha podido enviar. Se reintentará automáticamente; la solicitud está guardada.' : 'El aviso por correo está pendiente de envío. La solicitud ya está guardada.'));
      if (contact.mail_status === 'failed') {
        const retry = element('button', 'Reintentar aviso ahora', 'button secondary');
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { await api(`/contacts/${id}/retry-email`, { method: 'POST' }); await loadDetail(id); }
          catch (error) { feedback.textContent = error.message; retry.disabled = false; }
        });
        mail.append(retry);
      }
      mail.append(element('p', `Privacidad aceptada · ${date(contact.privacy_accepted_at)}`)); detail.append(mail);
      if (focus) detail.focus({ preventScroll: innerWidth > 760 });
    } catch (error) { if (request === detailRequest) $('detail').replaceChildren(element('p', error.message, 'error')); }
    finally { if (request === detailRequest) $('detail').removeAttribute('aria-busy'); }
  }
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Entrando…'; $('login-error').textContent = ''; $('login-success').textContent = '';
    try { await openInbox(await api('/login', { method: 'POST', body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }) })); }
    catch (error) { $('login-error').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Entrar'; }
  });
  function openPasswordForm() {
    listRequest++; detailRequest++;
    $('password-form').reset(); $('password-error').textContent = '';
    $('change-username').value = currentUsername || $('username').value.trim();
    $('password').value = '';
    $('login-panel').hidden = true; $('inbox').hidden = true; $('password-panel').hidden = false;
    $('open-password-account').hidden = true;
    ($('change-username').value ? $('current-password') : $('change-username')).focus();
  }
  $('open-password-login').addEventListener('click', openPasswordForm);
  $('open-password-account').addEventListener('click', openPasswordForm);
  $('cancel-password').addEventListener('click', async () => {
    $('password-form').reset();
    if (csrfToken) {
      try { await openInbox(await api('/session')); }
      catch { showLogin('Vuelve a entrar para continuar.'); }
    } else { showLogin(); $('username').focus(); }
  });
  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    $('password-error').textContent = '';
    if ($('new-password').value !== $('confirm-password').value) {
      $('password-error').textContent = 'Las contraseñas nuevas no coinciden.';
      $('confirm-password').focus(); return;
    }
    button.disabled = true; button.textContent = 'Guardando…'; $('cancel-password').disabled = true; $('logout').disabled = true;
    const username = $('change-username').value.trim();
    try {
      await api('/change-password', { method: 'POST', body: JSON.stringify({
        username, currentPassword: $('current-password').value,
        newPassword: $('new-password').value, confirmPassword: $('confirm-password').value
      }) });
      showLogin(); $('username').value = username;
      $('login-success').textContent = 'Contraseña cambiada. Inicia sesión con la nueva contraseña.';
      $('password').focus();
    } catch (error) { $('password-error').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Guardar contraseña'; $('cancel-password').disabled = false; $('logout').disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await api('/logout', { method: 'POST' }); history.replaceState(null, '', location.pathname); showLogin(); $('username').focus(); }
    catch (error) { $('inbox-error').textContent = error.message; }
    finally { $('logout').disabled = false; }
  });
  document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.status; page = 1;
    document.querySelectorAll('[data-status]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    void loadList();
  }));
  $('previous').addEventListener('click', () => { page = Math.max(1, page - 1); void loadList(); });
  $('next').addEventListener('click', () => { page = Math.min(pages, page + 1); void loadList(); });
  $('refresh').addEventListener('click', async () => { $('refresh').disabled = true; await loadList(); if (selected) await loadDetail(selected); $('refresh').disabled = false; });
  api('/session').then(openInbox).catch(() => showLogin());
})();
