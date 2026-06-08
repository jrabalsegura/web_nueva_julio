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
- El formulario muestra validacion simulada.
- Los filtros y el modal de proyectos funcionan.

## Dominio personalizado futuro

Si mas adelante se conecta `www.resolutionsolarenergy.es`, se puede configurar desde `Settings > Pages > Custom domain` y, si hace falta, anadir un archivo `CNAME` en la raiz con:

```text
www.resolutionsolarenergy.es
```
