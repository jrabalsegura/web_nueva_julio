# Publicar Resolution Solar Energy en `ssh remote`

Guía adaptada al servidor y a los despliegues existentes de Finanzas y Radar.
Los comandos indican dónde ejecutarse; no se ha desplegado la aplicación al preparar esta guía.

## Configuración comprobada el 23 de septiembre de 2026

- `remote`: `jrabal@157.180.32.241`, Ubuntu 24.04.4 LTS.
- Podman 4.9.3, Quadlet, Nginx y Certbot ya instalados. Docker no está instalado en el servidor.
- Finanzas y Radar usan contenedores gestionados por systemd mediante Quadlet.
- El puerto `3089` estaba libre; volver a comprobarlo antes de arrancar.
- Ambos dominios resolvían a `157.180.32.241`, sin registros AAAA.
- Hay un temporizador `certbot.timer` activo. La revisión por SSH fue de solo lectura;
  los comandos con `sudo` requieren tu contraseña y no se ejecutaron.

```text
https://julio.joserabalsegura.com ─┐
                                ├─ Nginx :443 → 127.0.0.1:3089 → contenedor :3000
https://resolutionsolarenergy.es ─┘                                │
                                          SQLite en /var/lib/resolution-solar/data
                                                                 │
                                     FormSubmit → juliorabal@hotmail.com
```

Ambos nombres sirven la web y el panel; no se redirige uno al otro. El dominio
principal para enlaces de correo y referencias de idiomas es `resolutionsolarenergy.es`.
La sesión del administrador es independiente en cada dominio. `www` no forma parte
de este despliegue ni del certificado.

## 1. Preparar las carpetas en el servidor

Desde el Mac:

```bash
ssh remote
```

En el servidor:

```bash
podman --version
ss -ltn 'sport = :3089'
sudo nginx -t
```

El puerto debe estar libre y Nginx debe validar correctamente. Si aparece algún
servicio en `3089`, elige otro puerto y cámbialo en las dos plantillas de `deploy/`.
No continúes con un error de configuración de Nginx.

```bash
sudo install -d -m 0755 -o jrabal -g jrabal /var/www/resolution-solar
sudo install -d -m 0700 -o 1000 -g 1000 /var/lib/resolution-solar/data
sudo install -d -m 0700 /etc/resolution-solar /var/backups/resolution-solar
exit
```

La imagen usa UID/GID `1000:1000`. SQLite debe poder escribir en su carpeta.

## 2. Subir esta versión desde el Mac

Este método copia también los cambios locales aún no publicados en GitHub y
mantiene configuración y datos de producción fuera del código. No necesita
credenciales de GitHub en el servidor.

```bash
cd /Users/jraba/Documents/nueva_web_julio
npm test
rsync -az \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.local/' \
  --exclude='node_modules/' \
  --exclude='data/' \
  --exclude='backups/' \
  --exclude='*.sqlite*' \
  --exclude='.DS_Store' \
  --exclude='assets/img/FOTOS PAGINA WEB/' \
  ./ remote:/var/www/resolution-solar/
ssh remote
```

Todos los pasos siguientes se ejecutan en el servidor, salvo que se indique otra cosa.

## 3. Construir la imagen

```bash
cd /var/www/resolution-solar
RSE_RELEASE=$(date -u +%Y%m%dT%H%M%SZ)
sudo podman build --pull=always -f Dockerfile \
  -t "localhost/resolution-solar:$RSE_RELEASE" .
sudo podman tag "localhost/resolution-solar:$RSE_RELEASE" localhost/resolution-solar:current
sudo podman image inspect localhost/resolution-solar:current --format '{{.Config.User}}'
```

El último comando debe mostrar `node`. Node.js y npm están dentro de la imagen;
no es necesario instalarlos en el servidor.

## 4. Configurar el destinatario y el acceso al panel

Solo la primera vez, crear el archivo privado a partir de la plantilla:

```bash
sudo test ! -e /etc/resolution-solar/app.env && \
  sudo install -m 0600 -o root -g root deploy/app.env.example /etc/resolution-solar/app.env
```

Si el archivo ya existe, consérvalo. Revisa los valores con:

```bash
sudoedit /etc/resolution-solar/app.env
```

La configuración relevante ya viene preparada. La contraseña se configura
después con el asistente; no hay que escribirla ni pegar un hash a mano:

```dotenv
APP_ORIGIN=https://resolutionsolarenergy.es
APP_ADDITIONAL_ORIGINS=https://julio.joserabalsegura.com
ADMIN_USERNAME=admin
TRUST_PROXY=
MAIL_TRANSPORT=formsubmit
MAIL_TO=juliorabal@hotmail.com
```

Conserva también `PORT`, `PUBLIC_DIR` y `DATABASE_PATH` de la plantilla. Los
valores del archivo de Podman son literales: no añadas comillas ni `export`.
No hacen falta contraseña de Hotmail, cuenta SMTP ni `MAIL_FROM`. FormSubmit
envía la notificación y configura la respuesta hacia el email del visitante.
`TRUST_PROXY` se completa en el paso siguiente.

Configura ahora la contraseña inicial del panel:

```bash
sudo python3 /var/www/resolution-solar/scripts/configure-production-admin.py
```

El asistente pide la contraseña dos veces, sin mostrarla. Debe tener entre 14 y
256 caracteres; guárdala en tu gestor. Genera el hash con la imagen ya construida
y comprueba la configuración dentro del contenedor, sin red ni acceso a SQLite.
Solo si la validación pasa guarda `ADMIN_PASSWORD_HASH` en el archivo privado,
con permisos `600`, y conserva una copia del archivo anterior en la misma carpeta.
Los demás valores se conservan. No continúes al paso 5 si falla esta comprobación.

El asistente configura el acceso inicial. No cambia la contraseña de una cuenta
que ya exista en SQLite; para ese caso usa el procedimiento de recuperación.

## 5. Instalar y arrancar el contenedor con Quadlet

```bash
cd /var/www/resolution-solar
sudo install -m 0644 deploy/quadlet/resolution-solar.container \
  /etc/containers/systemd/resolution-solar.container
sudo env QUADLET_UNIT_DIRS=/etc/containers/systemd \
  /usr/lib/systemd/system-generators/podman-system-generator --dryrun
```

Comprueba que genera `resolution-solar.service` sin errores de claves desconocidas
y que `ExecStart` incluye `--health-cmd`. La plantilla define `HealthCmd`
explícitamente: Podman construye en formato OCI por defecto y puede omitir
el `HEALTHCHECK` del Dockerfile. `HealthOnFailure=kill` requiere ese comando.

```bash
sudo systemctl daemon-reload
sudo systemctl start resolution-solar.service
sudo systemctl status resolution-solar.service --no-pager
curl --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 20 -fsS http://127.0.0.1:3089/healthz
sudo podman inspect resolution-solar --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
```

Salud esperada: `{"status":"ok"}`. El último comando muestra la IP del gateway
del bridge, normalmente `10.88.0.1`. Pega **la IP obtenida** en `TRUST_PROXY`
mediante `sudoedit`, antes de publicar Nginx:

```bash
sudoedit /etc/resolution-solar/app.env
sudo systemctl restart resolution-solar.service
curl --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 20 -fsS http://127.0.0.1:3089/healthz
sudo podman healthcheck run resolution-solar
```

Ejemplo si el gateway obtenido es ese: `TRUST_PROXY=10.88.0.1`. No configures
`true`, un número de saltos ni toda la red privada. Nginx sobrescribe las
cabeceras de proxy en la plantilla. Si el gateway está vacío, revisa la red
bridge antes de seguir. Recomprueba este valor si cambias la red de Podman.

Quadlet ya incluye `WantedBy=multi-user.target`: arranca al reiniciar el
servidor. No se ejecuta `systemctl enable` sobre el servicio generado.

### Si ya se instaló la plantilla sin `HealthCmd`

El error `cannot set on-failure action to kill without a health check` se
corrige instalando la plantilla actualizada; no requiere reconstruir la imagen
ni cambiar el archivo de entorno o la base de datos. Después de subir el archivo
corregido a `/var/www/resolution-solar/deploy/quadlet/resolution-solar.container`:

```bash
sudo systemctl stop resolution-solar.service
sudo install -m 0644 /var/www/resolution-solar/deploy/quadlet/resolution-solar.container \
  /etc/containers/systemd/resolution-solar.container
sudo systemctl daemon-reload
sudo systemctl reset-failed resolution-solar.service
sudo systemctl start resolution-solar.service
curl --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 20 -fsS http://127.0.0.1:3089/healthz
sudo podman healthcheck run resolution-solar
sudo podman inspect resolution-solar --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
```

Si vuelve a fallar, detener los reintentos y leer el error completo:

```bash
sudo systemctl stop resolution-solar.service
sudo journalctl -u resolution-solar.service -n 50 --no-pager
```

El estado `125` por sí solo no identifica la causa. El registro del servicio
requiere `sudo` en este servidor. Si `systemctl status` queda en `(END)`, pulsa
`q` para volver al terminal; `--no-pager` evita esa pantalla.

### Si el contenedor termina con `Configura ADMIN_PASSWORD_HASH`

La aplicación está rechazando un hash vacío o con formato incorrecto. Ejecuta
el asistente del paso 4 y arranca únicamente si la configuración valida:

```bash
sudo systemctl stop resolution-solar.service
sudo python3 /var/www/resolution-solar/scripts/configure-production-admin.py && \
  sudo systemctl reset-failed resolution-solar.service && \
  sudo systemctl start resolution-solar.service && \
  curl --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 20 -fsS http://127.0.0.1:3089/healthz
```

No hace falta reconstruir la imagen. La indicación `npm run setup:local` de
versiones anteriores es para desarrollo local; en este servidor se configura
`/etc/resolution-solar/app.env` mediante el asistente anterior.

## 6. Añadir los dominios a Nginx

Solo para la primera instalación:

```bash
cd /var/www/resolution-solar
sudo test ! -e /etc/nginx/sites-available/resolution-solar && \
  sudo install -m 0644 deploy/nginx/resolution-solar.conf /etc/nginx/sites-available/resolution-solar
sudo test ! -e /etc/nginx/sites-enabled/resolution-solar && \
  sudo ln -s /etc/nginx/sites-available/resolution-solar /etc/nginx/sites-enabled/resolution-solar
sudo nginx -t && sudo systemctl reload nginx
curl -fsS -H 'Host: julio.joserabalsegura.com' http://127.0.0.1/healthz
curl -fsS -H 'Host: resolutionsolarenergy.es' http://127.0.0.1/healthz
```

Ambos deben responder `{"status":"ok"}`. El panel y los formularios se
comprueban después de activar HTTPS. El site tiene que usar un nombre propio;
no sustituyas el de `joserabalsegura.com` ni los de Finanzas o Radar.

## 7. Activar HTTPS para los dos dominios

Comprobar DNS otra vez:

```bash
dig +short A julio.joserabalsegura.com
dig +short A resolutionsolarenergy.es
dig +short AAAA julio.joserabalsegura.com
dig +short AAAA resolutionsolarenergy.es
```

Los registros A deben apuntar a `157.180.32.241`. Los AAAA deben estar vacíos
o apuntar a una IPv6 que sirva esta misma web. El 23/09/2026 los dos A ya eran
correctos y no había AAAA. Si usas un cortafuegos, permite 80 y 443; `3089`
debe seguir accesible solo en loopback. No hace falta cambiar el acceso SSH.

```bash
sudo certbot --nginx --redirect \
  --cert-name resolution-solar \
  -d julio.joserabalsegura.com \
  -d resolutionsolarenergy.es
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --cert-name resolution-solar --dry-run
systemctl list-timers --all certbot.timer
```

Si Certbot pide email de contacto, introduce el del administrador del servidor.
Un certificado cubre los dos nombres. Certbot añade TLS y la redirección
HTTP → HTTPS a la copia instalada de Nginx. **No vuelvas a copiar encima la
plantilla HTTP durante futuras actualizaciones.**

```bash
curl -fsS https://julio.joserabalsegura.com/healthz
curl -fsS https://resolutionsolarenergy.es/healthz
curl -I http://julio.joserabalsegura.com/
curl -I http://resolutionsolarenergy.es/
```

Las dos primeras respuestas deben indicar `ok`; las otras deben redirigir a HTTPS.

## 8. Activar FormSubmit en Hotmail y probar

1. Abre `https://resolutionsolarenergy.es/contacto.html` y envía una solicitud
   identificada como prueba, con una dirección de respuesta tuya.
2. Abre `https://resolutionsolarenergy.es/admin/` y entra con la contraseña nueva.
   La solicitud debe aparecer aunque el aviso todavía esté pendiente.
3. En `juliorabal@hotmail.com`, abre el mensaje de FormSubmit y pulsa **Activate Form**.
   Revisa también correo no deseado. El destinatario anterior no activa automáticamente el nuevo.
4. Vuelve al detalle de la solicitud en el panel y pulsa **Reintentar aviso ahora**.
   Mientras falta la activación, el reintento automático se retrasa 24 horas.
5. Comprueba que el estado pasa a enviado y que el correo llega a Hotmail con
   los campos completos. Comprueba que «Responder» apunta al email del visitante.
6. Repite un envío desde `https://julio.joserabalsegura.com/contacto.html` y comprueba
   también el acceso a `/admin/` en ese dominio.

En el despliegue propio, el backend contacta con FormSubmit después de guardar
la solicitud en SQLite; usa siempre la URL principal para identificar el formulario.
Así ambos dominios comparten cola y buzón. La confirmación del proveedor no
garantiza llegada a bandeja de entrada: hay que comprobar la recepción real.
Los reintentos o la activación pueden producir algún aviso duplicado; la
solicitud del panel se conserva una sola vez por identificador de envío.

Las pruebas automáticas simulan FormSubmit y no envían correos. La recepción
real desde este servidor queda pendiente hasta completar este paso.

## 9. Operación, copias y recuperación

Estado y logs:

```bash
sudo systemctl status resolution-solar.service --no-pager
sudo journalctl -u resolution-solar.service -n 80 --no-pager
sudo podman logs --tail 80 resolution-solar
sudo systemctl restart resolution-solar.service
```

Copia coherente de SQLite, con la app en marcha:

```bash
RSE_BACKUP="/var/backups/resolution-solar/contacts-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
sudo podman exec resolution-solar node scripts/backup.mjs /app/data/backup.sqlite
sudo podman cp resolution-solar:/app/data/backup.sqlite "$RSE_BACKUP"
sudo chmod 600 "$RSE_BACKUP"
sudo podman exec resolution-solar rm /app/data/backup.sqlite
```

Integra estas copias en tu sistema de backups y guarda otra copia fuera del
servidor. Conserva también `/etc/resolution-solar/app.env`, el Quadlet, el site
operativo de Nginx y la configuración de Certbot. Los backups contienen datos
personales y sesiones. No copies solo `contacts.sqlite` mientras SQLite use WAL.

Si olvidas la contraseña, ejecuta el asistente del paso 4 para guardar un nuevo
hash validado en `app.env` y, solo si termina correctamente, ejecuta:

```bash
sudo systemctl restart resolution-solar.service
sudo podman exec resolution-solar node scripts/reset-admin-password.mjs --from-env
```

Cambiar el archivo y reiniciar sin el segundo comando no cambia una cuenta
ya existente. El restablecimiento revoca las sesiones. Para restaurar SQLite,
detén la aplicación, conserva la carpeta actual, restaura el backup como
`/var/lib/resolution-solar/data/contacts.sqlite` con UID/GID `1000:1000` y modo
`600`, y retira los WAL/SHM anteriores solo con la app parada. Tras arrancar,
restablece la contraseña para revocar las sesiones incluidas en la copia.

## 10. Actualizar y volver a una imagen anterior

Haz primero una copia de SQLite. En el Mac, repite `npm test` y el `rsync`
del paso 2. En el servidor:

```bash
cd /var/www/resolution-solar
RSE_RELEASE=$(date -u +%Y%m%dT%H%M%SZ)
sudo podman build --pull=always -f Dockerfile \
  -t "localhost/resolution-solar:$RSE_RELEASE" .
sudo podman tag localhost/resolution-solar:current localhost/resolution-solar:rollback
sudo podman tag "localhost/resolution-solar:$RSE_RELEASE" localhost/resolution-solar:current
sudo systemctl restart resolution-solar.service
curl -fsS https://resolutionsolarenergy.es/healthz
curl -fsS https://julio.joserabalsegura.com/healthz
```

No avances al siguiente comando si la construcción falla. No se sustituyen
`app.env`, los datos ni el Nginx modificado por Certbot. Si cambia Quadlet,
reinstala solo ese archivo y ejecuta el generador y `daemon-reload` antes de reiniciar.

Para volver a la imagen anterior:

```bash
sudo podman tag localhost/resolution-solar:rollback localhost/resolution-solar:current
sudo systemctl restart resolution-solar.service
curl -fsS http://127.0.0.1:3089/healthz
```

Esto revierte código, no datos. Un cambio futuro de esquema puede requerir
un procedimiento de migración específico; no restaures una copia antigua
por rutina porque perderías las solicitudes recibidas después.

## Referencias

- [Quadlet en Podman 4.9.3](https://docs.podman.io/en/v4.9.3/markdown/podman-systemd.unit.5.html).
- [Proxy HTTP de Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
- [Certbot: Nginx y renovación](https://eff-certbot.readthedocs.io/en/stable/using.html).
- [Express detrás de un proxy](https://expressjs.com/en/guide/behind-proxies/).
- [FormSubmit: AJAX](https://formsubmit.co/ajax-documentation) y [activación y URL del formulario](https://formsubmit.co/help).
