# Despliegue local, servidor propio y GitHub Pages

La parte pública sigue siendo HTML, CSS y JavaScript vanilla, compatible con GitHub Pages sin instalar dependencias ni compilar. El despliegue en contenedor añade un backend Node.js 24, SQLite, envío SMTP y un panel privado en `/admin/`.

## Probar en local con Docker

Requisitos: Docker con Compose y Node.js 24 o superior para generar las credenciales.

```bash
npm run setup:local
docker compose up -d --build
```

El primer comando crea `.env` con una contraseña aleatoria guardada como hash scrypt y deja los datos de acceso en `.local/admin-credentials.txt`. Si `.env` ya existe no lo modifica. Ambos archivos están excluidos de Git y de la imagen Docker.

La contraseña del archivo es solo la **inicial**. En `/admin/`, la opción **Cambiar contraseña** pide el usuario, la contraseña actual y la nueva dos veces. La nueva debe tener entre 14 y 256 caracteres, ser distinta de la actual y se guarda exclusivamente como hash scrypt en SQLite. Cierra todas las sesiones y requiere volver a entrar. El archivo local y `.env` no se actualizan con la nueva contraseña; guarda la que elijas en tu gestor de contraseñas.

- Web: <http://localhost:3080/>
- Formulario: <http://localhost:3080/contacto.html>
- Administrador: <http://localhost:3080/admin/>
- Buzón de pruebas Mailpit: <http://localhost:8025/>

Usar exactamente `localhost`, como indica `APP_ORIGIN`; abrir la web como `127.0.0.1` o con otro puerto exige actualizar esa variable. Los puertos solo escuchan en el equipo local.

El Compose local fuerza el SMTP hacia Mailpit, incluso si `.env` contiene datos de un proveedor real. Los mensajes de prueba no se envían a buzones externos. El aviso incluye todos los campos, idioma, fecha, enlace al panel y Reply-To del remitente.

Para probar manualmente:

1. Enviar una solicitud desde la página de contacto.
2. Entrar en `/admin/` con las credenciales locales y abrir la solicitud.
3. Revisar su correo en Mailpit.
4. Marcarla como atendida y comprobar los filtros.
5. Recrear el contenedor y comprobar que la solicitud sigue ahí:

```bash
docker compose up -d --force-recreate web
```

Los datos se guardan en los volúmenes `contacts` y `mailpit`, no en la imagen. `docker compose down` detiene y elimina los contenedores pero conserva esos volúmenes. **No usar `docker compose down -v` si se quieren conservar los mensajes.**

```bash
docker compose ps
docker compose logs --tail=50 web
docker compose stop
docker compose up -d
```

### Pruebas automatizadas

```bash
npm ci
npm test
node scripts/test-local.mjs
```

`npm test` usa bases temporales y un transporte de correo simulado: comprueba autenticación, caducidad, CSRF, límites compartidos de acceso y cambio de contraseña, persistencia de credenciales tras reiniciar, revocación de sesiones, validación, duplicados, recuperación de avisos y compatibilidad estática. No envía correos reales ni cambia la contraseña del administrador local.

`test-local.mjs` requiere el Compose local arrancado y las credenciales iniciales generadas todavía vigentes. Si has cambiado la contraseña, usa las pruebas aisladas (`npm test`) y comprueba el formulario manualmente. El script envía una solicitud identificada como prueba, comprueba el acceso privado, el aviso real por SMTP a Mailpit y el cambio de estado. Deja la solicitud visible para revisarla. Se niega a enviar si el destinatario configurado no es el buzón local de pruebas.

## Funcionamiento del backend

- Al servir `contacto.html` y las versiones EN/FR/DE, el servidor cambia su destino a `/api/contact` e introduce el idioma y un identificador único de envío. Los archivos originales conservan FormSubmit para GitHub Pages.
- Las solicitudes se validan en el servidor y se guardan en SQLite antes de confirmar la recepción. La aceptación de privacidad queda fechada. No se almacenan IPs de los visitantes.
- El aviso SMTP se procesa desde una cola persistente incluida en el mismo registro. Un fallo no borra el mensaje ni devuelve un falso error de recepción al visitante. Los reintentos empiezan a los 30 segundos, aumentan hasta una hora y continúan mientras sea necesario. El panel permite adelantarlos.
- Repetir una petición con el mismo identificador y contenido no crea otra solicitud. El envío SMTP es de tipo «al menos una vez»: ante un corte justo después de que el proveedor acepte el correo, podría repetirse el aviso. Se reutiliza Message-ID para facilitar su identificación.
- El panel ofrece listado paginado, filtros, detalle, pendiente/atendida y estado del aviso. «Responder por email» abre el programa de correo del administrador.
- Hay un solo administrador, inicializado desde el entorno y almacenado en SQLite; no existe registro público. Las sesiones duran ocho horas, se guardan en SQLite y se revocan al cerrar sesión. Cambiar la contraseña revoca inmediatamente todas las sesiones, incluso en otros dispositivos. Recrear el contenedor conserva la nueva contraseña y no vuelve a aplicar el hash inicial del entorno.
- Las cookies son HttpOnly y SameSite=Strict, y Secure con HTTPS. Las mutaciones comprueban el origen; las operaciones de la bandeja exigen además un token CSRF. El acceso y el cambio de contraseña comprueban las credenciales y comparten el límite de intentos. Se limitan también los envíos públicos. Las consultas SQL usan parámetros y el panel muestra los mensajes como texto.
- Solo se sirven páginas y recursos públicos concretos; no se sirve el directorio del proyecto. La base de datos, contraseñas, fuentes del backend y copias no tienen rutas públicas. La imagen se ejecuta sin root y con el sistema de archivos de solo lectura, salvo el volumen de datos.

## Despliegue futuro en el servidor SSH

El archivo `compose.production.yaml` es independiente del local y no incluye Mailpit. El servidor debe tener Docker y un proxy HTTPS (por ejemplo, el que ya utilices). Ejecutar una sola instancia de la aplicación con el volumen SQLite en disco local.

1. Copiar el código y crear `.env` a partir de `.env.example`, sin copiar las credenciales ni los mensajes de las pruebas.
2. Configurar `APP_ORIGIN=https://tu-dominio.es`, un usuario y un hash de contraseña nuevos. El backend rechaza HTTP en dominios públicos.
3. Configurar `MAIL_FROM`, `MAIL_TO` y las credenciales SMTP del proveedor. Para puerto 587: `SMTP_SECURE=false` y `SMTP_REQUIRE_TLS=true`. Para puerto 465: `SMTP_SECURE=true`. Mantener la validación de certificados.
4. Configurar `TRUST_PROXY` únicamente con la IP o CIDR del proxy de confianza, que debe sobrescribir `X-Forwarded-For`. El puerto de la aplicación está limitado al loopback del servidor; el proxy publica HTTPS.
5. Arrancar y comprobar un envío al buzón definitivo:

```bash
docker compose -f compose.production.yaml up -d --build
```

Para obtener un hash sin escribir la contraseña en el historial, en Bash/Zsh:

```bash
read -r -s ADMIN_NEW_PASSWORD
printf '%s' "$ADMIN_NEW_PASSWORD" | node scripts/hash-password.mjs
unset ADMIN_NEW_PASSWORD
```

Para la primera inicialización, pegar el resultado en `ADMIN_PASSWORD_HASH` de `.env`, proteger ese archivo con permisos `600` y arrancar el contenedor. El hash requiere una contraseña de al menos 14 caracteres. No guardar contraseñas ni credenciales SMTP en Git.

### Recuperar el acceso desde el servidor

El cambio de contraseña desde el formulario requiere conocer la actual. Si se ha olvidado, un administrador con acceso SSH puede generar un nuevo hash, actualizar `ADMIN_PASSWORD_HASH` y, si procede, `ADMIN_USERNAME` en `.env`, y ejecutar:

```bash
docker compose -f compose.production.yaml up -d --force-recreate web
docker compose -f compose.production.yaml exec web node scripts/reset-admin-password.mjs --from-env
```

El segundo comando aplica expresamente las credenciales del entorno a la cuenta existente y revoca todas las sesiones. No es una ruta web y nunca se ejecuta al arrancar. Cambiar `.env` y reiniciar por sí solos **no** modifica una contraseña guardada en SQLite. En local, omitir `-f compose.production.yaml`.

### Copias de seguridad

Usar la API de backup de SQLite para obtener una copia coherente incluso con la aplicación en marcha; no copiar solo el archivo `.sqlite` mientras esté activo el modo WAL.

```bash
mkdir -p backups
docker compose exec web node scripts/backup.mjs /app/data/backup.sqlite
docker compose cp web:/app/data/backup.sqlite ./backups/contacts.sqlite
docker compose exec web rm /app/data/backup.sqlite
```

En producción sustituir `docker compose` por `docker compose -f compose.production.yaml`. Guardar las copias fuera del servidor, con acceso restringido, y programarlas en el sistema de backups del servidor. Las copias contienen datos de contacto y sesiones.

Para restaurar, detener `web`, conservar una copia del volumen actual y restaurar la copia como `/app/data/contacts.sqlite` con propietario UID/GID 1000. Retirar los antiguos archivos `contacts.sqlite-wal` y `contacts.sqlite-shm` **solo con la aplicación parada**. Arrancar y revisar las solicitudes. La copia incluye la contraseña y las sesiones que existían cuando se hizo: usar el procedimiento de recuperación anterior para establecer credenciales nuevas y revocar las sesiones restauradas.

## GitHub Pages

## Estructura compatible

- Pagina principal: `index.html` en la raiz del repositorio.
- CSS: `assets/css/styles.css`.
- JavaScript: `assets/js/main.js`.
- Imagenes: `assets/img/`.
- Rutas relativas en todos los enlaces internos y assets.
- Archivo `.nojekyll` incluido para que GitHub Pages publique los archivos como web estatica sin procesado Jekyll.

## Conectar con el repositorio remoto

Repositorio objetivo:

```bash
https://github.com/jrabalsegura/web_nueva_julio.git
```

Desde la carpeta del proyecto:

```bash
cd /Users/jraba/Documents/nueva_web_julio
git status
git remote add origin https://github.com/jrabalsegura/web_nueva_julio.git
git add .
git commit -m "Create static corporate website"
git push -u origin main
```

Si el remoto `origin` ya existe y apunta a otro sitio:

```bash
git remote set-url origin https://github.com/jrabalsegura/web_nueva_julio.git
git push -u origin main
```

Si GitHub indica que el repositorio remoto ya tiene commits y rechaza el push, revisa primero el contenido remoto antes de sobrescribir nada. Una opcion habitual es clonar el repo limpio en otra carpeta y copiar estos archivos dentro.

## Activar GitHub Pages

En GitHub:

1. Entra en `jrabalsegura/web_nueva_julio`.
2. Ve a `Settings`.
3. Abre `Pages`.
4. En `Build and deployment`, selecciona `Deploy from a branch`.
5. En `Branch`, selecciona `main`.
6. En `Folder`, selecciona `/ (root)`.
7. Guarda los cambios.

GitHub Pages publicara la web desde:

```text
https://jrabalsegura.github.io/web_nueva_julio/
```

Puede tardar unos minutos en aparecer el primer despliegue.

## Comprobaciones antes de publicar

```bash
node --check assets/js/main.js
git status
```

Despues de publicar, comprueba:

- La home carga en `https://jrabalsegura.github.io/web_nueva_julio/`.
- El menu navega a `servicios.html`, `proyectos.html`, `sobre-nosotros.html` y `contacto.html`.
- Los estilos cargan correctamente.
- El formulario valida los campos y envía las solicitudes mediante FormSubmit.
- Los filtros y el modal de proyectos funcionan.

## Dominio personalizado futuro

Si mas adelante se conecta `www.resolutionsolarenergy.es`, se puede configurar desde `Settings > Pages > Custom domain` y, si hace falta, anadir un archivo `CNAME` en la raiz con:

```text
www.resolutionsolarenergy.es
```

## Formulario de contacto

Proveedor de la primera prueba: [FormSubmit](https://formsubmit.co/), compatible con GitHub Pages sin servidor propio.
Destinatario de prueba: `jrabal.segura@gmail.com`, configurado en el `action` de `contacto.html`.
El correo público que aparece en la web es independiente de este destinatario.

### Activación y prueba de recepción

1. Abrir el correo de FormSubmit en la dirección destinataria y pulsar **Activate Form**. Revisar spam si no aparece.
2. Enviar una solicitud de prueba desde la web servida por HTTP/HTTPS; no abrir el HTML directamente con `file://`.
3. Confirmar que el correo recibido contiene nombre, email, teléfono, servicio, mensaje e idioma, y que **Responder** apunta al email de quien rellenó el formulario.
4. Repetir esta comprobación después de publicar en un dominio nuevo: FormSubmit puede requerir activación para la nueva URL.

El 19 de septiembre de 2026 se realizó una petición real al endpoint con un mensaje identificado como prueba. FormSubmit respondió `success: "false"` e indicó que había enviado el enlace de activación. Tras confirmar el usuario la activación, se envió una segunda prueba con el asunto `[PRUEBA 2] Formulario activado · Resolution Solar Energy`; el proveedor respondió `success: "true"` y `The form was submitted successfully.` El envío está aceptado por el servicio; queda comprobar su recepción en la bandeja de entrada.

JavaScript usa el endpoint AJAX y solo vacía el formulario cuando el proveedor confirma el envío. Los errores, el tiempo de espera agotado y las respuestas de activación conservan los datos. Durante el envío se bloquean los controles para evitar duplicados. Hay un campo trampa para bots; este filtro no garantiza eliminar todo el spam. Sin JavaScript se mantiene el envío POST estándar de FormSubmit, con su pantalla de confirmación y su protección predeterminada.

### Cambiar al destinatario definitivo

1. Cambiar la dirección del `action` en el formulario de `contacto.html`.
2. Ejecutar `node scripts/generate-locales.mjs` para regenerar las versiones EN, FR y DE.
3. Publicar, activar el formulario desde el nuevo buzón y comprobar un envío real.

La dirección del `action` es visible en el código público. FormSubmit permite sustituirla por el identificador que facilita tras la activación para ocultarla. No poner credenciales SMTP ni contraseñas en el código.

### Alternativas gratuitas consultadas

- [Web3Forms](https://web3forms.com/pricing): 250 envíos al mes; cuenta y clave de acceso vinculada al destinatario. Buen margen para una web de servicios.
- [Formspree](https://help.formspree.io/articles/account-management/account-limits): 50 envíos al mes, historial de 30 días y hasta dos direcciones vinculadas en el plan gratuito.
- [FormSubmit](https://formsubmit.co/): conexión gratuita mediante email y activación, sin registro obligatorio. Es el proveedor conectado para esta primera prueba.

Límites consultados el 19 de septiembre de 2026. Antes de cambiar de proveedor, verificar de nuevo sus condiciones y probar la recepción en el buzón definitivo.
