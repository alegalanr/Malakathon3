/**
 * Revisión de privacidad de las capturas antes del informe (F12).
 *
 * scan-secrets.mjs solo lee ficheros de texto: un usuario visible en una captura de la web de Betsson
 * pasaría el filtro. Aquí se pasa el OCR por cada captura buscando los valores de las credenciales
 * (BETSSON_*_USER / _PASS) y, si aparece alguno, la captura se difumina entera antes de guardarse en el
 * informe. Es la red de seguridad de las máscaras: si un selector no tapa algo, esto lo coge.
 *
 * Si el OCR no está disponible no se puede comprobar nada, así que se difuminan por precaución las
 * capturas de página completa (las del recuadro del juego no muestran datos de la cuenta).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { OcrEngine } from '../vision/OcrEngine';
import { containsFuzzy, normalizeText } from '../vision/textMatch';

export interface PrivacyResult {
  checked: number;
  blurred: { path: string; reason: string }[];
}

/** Variantes de cada valor secreto que podrían verse escritas en pantalla. */
export function secretNeedles(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v || v.length < 4) continue;
    out.add(v);
    if (v.includes('@')) out.add(v.slice(0, v.indexOf('@'))); // la web suele enseñar solo la parte del usuario
  }
  return [...out].filter((n) => normalizeText(n).replace(/\s/g, '').length >= 4);
}

/** ¿Aparece alguno de los valores en el texto leído? Exacto o con errores típicos del OCR. */
export function textRevealsSecret(text: string, needles: string[]): boolean {
  const flat = normalizeText(text).replace(/\s/g, '');
  return needles.some((n) => {
    const nf = normalizeText(n).replace(/\s/g, '');
    if (nf && flat.includes(nf)) return true;
    return containsFuzzy(text, n, 0.85).found;
  });
}

/**
 * Lee todo el texto de una captura. La página se trocea en franjas horizontales que se amplían y se
 * leen en las dos polaridades (texto oscuro sobre claro y al revés): leída entera, el OCR se salta el texto pequeño y claro
 * de las cabeceras oscuras, que es justo donde suele salir el usuario.
 */
export async function readAllText(ocr: OcrEngine, png: Buffer): Promise<string> {
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return '';
  const STRIP = 72;
  const STEP = 48; // solapan 24 px para no cortar una línea por la mitad; franjas bajas para no mezclar cabecera y fondo
  const scale = Math.min(2, 2400 / W);
  const texts: string[] = [];
  for (let top = 0; top < H; top += STEP) {
    const height = Math.min(STRIP, H - top);
    if (height < 12) break;
    try {
      const strip = await sharp(png).extract({ left: 0, top, width: W, height }).flatten({ background: '#fff' }).grayscale()
        .resize({ width: Math.round(W * scale) }).normalize().png().toBuffer();
      // Las dos polaridades: una franja puede mezclar cabecera oscura y fondo claro
      for (const img of [strip, await sharp(strip).negate({ alpha: false }).png().toBuffer()]) {
        texts.push((await ocr.recognize(img, { mode: 'sparse' })).text);
      }
    } catch {
      // una franja que falla no impide las demás
    }
  }
  return texts.join('\n');
}

async function blurFile(file: string): Promise<void> {
  const png = await sharp(fs.readFileSync(file)).blur(30).png().toBuffer();
  fs.writeFileSync(file, png);
}

/**
 * Revisa las capturas (rutas relativas a `dir`). Nunca lanza: un fallo al revisar una captura la
 * difumina, porque no se puede garantizar que esté limpia.
 */
export async function scrubScreenshots(args: {
  dir: string;
  files: string[];
  ocr: OcrEngine;
  secrets: string[];
  /** Capturas de página completa: se difuminan si no se pueden revisar. */
  pageShots: string[];
}): Promise<PrivacyResult> {
  const needles = secretNeedles(args.secrets);
  const result: PrivacyResult = { checked: 0, blurred: [] };
  for (const rel of [...new Set(args.files)]) {
    const file = path.join(args.dir, rel);
    if (!fs.existsSync(file)) continue;
    const isPage = args.pageShots.includes(rel);
    try {
      if (!args.ocr.ready) {
        if (isPage) {
          await blurFile(file);
          result.blurred.push({ path: rel, reason: 'OCR no disponible para revisarla: difuminada por precaución' });
        }
        continue;
      }
      if (!needles.length) continue; // sin credenciales en el entorno no hay nada que buscar
      result.checked++;
      if (textRevealsSecret(await readAllText(args.ocr, fs.readFileSync(file)), needles)) {
        await blurFile(file);
        result.blurred.push({ path: rel, reason: 'se leía un dato de la cuenta' });
      }
    } catch (e) {
      try {
        await blurFile(file);
      } catch {
        fs.rmSync(file, { force: true }); // si ni siquiera se puede difuminar, no se publica
      }
      result.blurred.push({ path: rel, reason: `no se pudo revisar (${(e as Error).message}): difuminada por precaución` });
    }
  }
  return result;
}
