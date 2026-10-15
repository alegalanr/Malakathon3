/**
 * Recorte relativo y preprocesado de las zonas que lee el testigo visual.
 * Cada intento usa una variante DISTINTA: el testigo solo acepta un rid o una apuesta
 * cuando dos lecturas independientes coinciden (ver ScreenWitness).
 */
import sharp from 'sharp';
import type { Roi } from '../contracts/schemas';

/** Margen blanco alrededor de cada recorte: Tesseract falla con texto pegado al borde. */
export const PAD = 10;

export interface Variant {
  name: string;
  scale: number;
  threshold: number | null; // null = sin binarizar
  invert: 'auto' | 'yes';
}

export const VARIANTS: Variant[] = [
  // ✔ (15/10, Bubble Up real, sin conexión sobre capturas de la ronda) La barra inferior tiene texto claro y
  // pequeño (rid de ~8 px) sobre un fondo que 'auto' no ve oscuro: invertido y sin umbral, ×8 y ×5, lee
  // «4,00 €» con confianza 0,90 y el rid casi entero; con umbral fijo se perdía.
  { name: 'x8-invertido', scale: 8, threshold: null, invert: 'yes' },
  { name: 'x5-invertido', scale: 5, threshold: null, invert: 'yes' },
  { name: 'x4-gris', scale: 4, threshold: null, invert: 'auto' },
  { name: 'x3-umbral', scale: 3, threshold: 150, invert: 'auto' },
  { name: 'x5-gris', scale: 5, threshold: null, invert: 'auto' },
  // ✔ (15/10) Gris ×5-×10 lee la apuesta de Bubble Up en todas las capturas reales (3,20 € y 4,00 €): segunda lectura.
  { name: 'x7-gris', scale: 7, threshold: null, invert: 'auto' },
  { name: 'x3-umbral-invertido', scale: 3, threshold: 150, invert: 'yes' },
];

export async function cropRel(png: Buffer, roi: Pick<Roi, 'rx' | 'ry' | 'rw' | 'rh'>) {
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error('captura sin dimensiones');
  const left = Math.max(0, Math.floor(roi.rx * W));
  const top = Math.max(0, Math.floor(roi.ry * H));
  const width = Math.max(4, Math.min(W - left, Math.ceil(roi.rw * W)));
  const height = Math.max(4, Math.min(H - top, Math.ceil(roi.rh * H)));
  const raw = await sharp(png).extract({ left, top, width, height }).png().toBuffer();
  return { raw, px: { left, top, width, height }, W, H };
}

/** Gris → ampliar → (umbral) → texto oscuro sobre fondo claro → margen blanco. */
export async function preprocess(crop: Buffer, v: Variant): Promise<Buffer> {
  const meta = await sharp(crop).metadata();
  let img = sharp(crop)
    .flatten({ background: '#000' })
    .grayscale()
    .resize({ width: Math.max(1, Math.round((meta.width ?? 1) * v.scale)), kernel: 'lanczos3' })
    .normalize();
  let invert = v.invert === 'yes';
  if (v.invert === 'auto') {
    const { channels } = await sharp(crop).grayscale().stats();
    invert = (channels[0]?.mean ?? 255) < 128; // fondo oscuro, texto claro (lo habitual en la barra del juego)
  }
  if (invert) img = img.negate({ alpha: false });
  if (v.threshold !== null) img = img.threshold(v.threshold);
  // El margen va en una segunda pasada: si va en la misma, sharp lo invierte y sale negro.
  const processed = await img.png().toBuffer();
  return sharp(processed).extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: '#fff' }).png().toBuffer();
}
