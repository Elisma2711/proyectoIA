# Ordena

Aplicación web para clasificar artículos en zonas configurables usando Gemini. Las correcciones se guardan como ejemplos en `localStorage` para orientar futuras clasificaciones en el mismo navegador; no hay una base de datos y las etiquetas no se comparten entre dispositivos.

## Requisitos

- Node.js 18 o posterior.
- Una clave de API de Gemini.

## Preparar el proyecto

No abras `public/index.html` con doble clic: así el navegador usa `file://` y la API `/api/classify` no puede ejecutarse.

1. Abrí una terminal en la carpeta del proyecto.
2. Creá `.env.local` a partir de `.env.example` y reemplazá el valor de `GEMINI_API_KEY` por tu clave. No la pongas en archivos de `public/` ni la subas a GitHub.
3. Ejecutá `npm run dev`.
4. Abrí [http://127.0.0.1:3001](http://127.0.0.1:3001).

El servidor local usa Node.js, carga `.env.local` (o `.env` si está presente), sirve la interfaz y ejecuta `api/classify.js` en el puerto 3001.

La interfaz envía la lista a `/api/classify`. El servidor valida los datos, consulta Gemini y devuelve una clasificación estructurada. `GEMINI_API_KEY` se lee localmente desde `.env.local` o `.env`. `GEMINI_MODEL` es opcional y por defecto usa `gemini-3.6-flash`.

## Uso

1. Pegá un artículo por línea.
2. Escribí las zonas reales disponibles, separadas por comas o líneas.
3. Clasificá y revisá la familia, la explicación y la zona asignada.
4. Corregí la zona o el nombre de la familia y elegí **Guardar etiquetas** para reutilizar esos ejemplos más adelante.
5. Descargá los resultados como CSV si los necesitás fuera de la aplicación.

Las correcciones son ejemplos enviados a Gemini en la siguiente clasificación. Esto es aprendizaje por ejemplos (few-shot prompting), no reentrenamiento del modelo. El navegador conserva hasta 200 etiquetas y la API usa como máximo 30 ejemplos por consulta.

## Pruebas

```sh
npm test
```
