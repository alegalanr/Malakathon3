#!/usr/bin/env node
/**
 * Copia los datos de idioma del OCR (eng, spa) desde los paquetes npm a .cache/tessdata/.
 * Así el OCR no descarga nada de un CDN en cada ejecución: los ficheros vienen de npm, con la
 * integridad comprobada por package-lock.json. Se ejecuta solo en `npm install` / `npm ci` (postinstall).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, '.cache', 'tessdata');
fs.mkdirSync(out, { recursive: true });
for (const lang of ['eng', 'spa']) {
  try {
    const dir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    fs.copyFileSync(path.join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(out, `${lang}.traineddata.gz`));
  } catch (e) {
    // No es fatal: sin estos ficheros el OCR los descarga como antes
    console.warn(`⚠ datos de OCR "${lang}" no preparados: ${e.message}`);
  }
}
console.log(`datos de OCR en ${path.relative(process.cwd(), out) || out}`);
