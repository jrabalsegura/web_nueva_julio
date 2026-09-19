# Despliegue en GitHub Pages

Este proyecto es una web estatica hecha con HTML, CSS y JavaScript vanilla. No usa frameworks, no necesita `npm install` y no requiere proceso de build.

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
