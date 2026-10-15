/**
 * F8: testigo visual. OCR dirigido sobre la captura liquidada o de rechazo (SOLUCION.md §3.5, C11 → C12).
 * El OCR es testigo, no juez: lee 2-3 recortes pequeños y nunca lanza excepción.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Roi, RunConfig, VisualField, VisualReading } from '../contracts/schemas';
import { currencySymbolIn, parseDisplayedAmount } from '../domain/Money';
import type { OcrEngine } from './OcrEngine';
import { locateRois, MESSAGE_ROI } from './RoiLocator';

export interface WitnessRequest {
  capture: { png: Buffer; t: number; triggerEvent: string };
  fields: VisualField[];
  rois: { rid?: Roi; bet?: Roi };
  config: RunConfig;
  /** Nueva captura del recuadro del juego (3.er intento, 500 ms después). */
  recapture?: () => Promise<Buffer | null>;
}

/**
 * Preprocesados del recorte, en orden. ✔ (15/10, Bubble Up, sin conexión sobre capturas reales) El texto de la
 * barra inferior es claro y pequeño (rid de ~8 px): invertido, sin umbral y ampliado ×5-×8 lee «4,00 €» con
 * confianza 0,90 y el rid entero; el umbral fijo de 150 lo destrozaba. Los mensajes (escenario 2) siguen
 * con el preprocesado de siempre.
 */
interface Variant {
  scale: number;
  negate: boolean | 'auto';
  threshold?: number;
}
const BAR_VARIANTS: Variant[] = [
  { scale: 8, negate: true },
  { scale: 5, negate: true },
  { scale: 3, negate: true },
  { scale: 5, negate: false, threshold: 150 },
];
const MESSAGE_VARIANTS: Variant[] = [
  { scale: 3, negate: 'auto', threshold: 150 },
  { scale: 4, negate: false, threshold: 150 },
];

const OTHER_LANG_WORDS: Record<'es' | 'en', string[]> = {
  es: ['insuficiente', 'saldo', 'fondos', 'no tienes', 'suficiente', 'deposita'],
  en: ['insufficient', 'not enough', 'funds', 'balance', 'deposit'],
};
const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Corrige confusiones típicas solo dentro de la parte numérica (O→0, l/I→1, S→5, B→8). */
export function normalizeRid(raw: string): string {
  const after = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  return after.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/\D/g, '');
}

export function detectLanguage(text: string, cfg: RunConfig): { language?: 'es' | 'en'; hits: string[]; foreign: string[] } {
  const t = normText(text);
  const mine = cfg.texts.insufficientBalance.map(normText).filter((k) => t.includes(k));
  const otherLang = cfg.language === 'es' ? 'en' : 'es';
  const foreign = OTHER_LANG_WORDS[otherLang].map(normText).filter((k) => t.includes(k) && !OTHER_LANG_WORDS[cfg.language].map(normText).includes(k));
  if (mine.length && !foreign.length) return { language: cfg.language, hits: mine, foreign };
  if (foreign.length) return { language: otherLang, hits: mine, foreign };
  return { hits: mine, foreign };
}

export class ScreenWitness {
  constructor(
    private ocr: OcrEngine,
    private dir: string, // carpeta del run
  ) {}

  async read(req: WitnessRequest): Promise<{ readings: VisualReading[]; locatedRois: { rid?: Roi; bet?: Roi } }> {
    const readings: VisualReading[] = [];
    const locatedRois: { rid?: Roi; bet?: Roi } = {};
    for (const field of req.fields) {
      try {
        const r = await this.readField(field, req, locatedRois);
        readings.push(r);
      } catch (e) {
        readings.push(await this.failed(field, req.capture.png, null, `error del testigo: ${(e as Error).message}`, 0));
      }
    }
    return { readings, locatedRois };
  }

  private async readField(field: VisualField, req: WitnessRequest, located: { rid?: Roi; bet?: Roi }): Promise<VisualReading> {
    const cfg = req.config;
    if (!this.ocr.ready) return this.failed(field, req.capture.png, null, 'testigo no disponible (OCR sin cargar)', 0);

    let candidates: Roi[] = [];
    if (field === 'message') candidates = [MESSAGE_ROI];
    else if (req.rois[field]) candidates = [req.rois[field]!];
    let relocated = false;

    let png = req.capture.png;
    let best: VisualReading | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= cfg.ocr.maxAttempts; attempt++) {
      if (!candidates.length && !relocated) {
        const found = await locateRois(this.ocr, png, cfg);
        relocated = true;
        candidates = field === 'rid' ? (found.rid ? [found.rid] : []) : field === 'bet' ? (found.bet ?? []) : candidates;
      }
      if (!candidates.length) return this.failed(field, png, null, 'zona no localizada (ancla no encontrada)', attempt);
      if (attempt === 3 && req.recapture) {
        await new Promise((r) => setTimeout(r, 500));
        png = (await req.recapture()) ?? png;
      }
      const variants = field === 'message' ? [MESSAGE_VARIANTS[Math.min(attempt, MESSAGE_VARIANTS.length) - 1]] : BAR_VARIANTS;
      for (const roi of candidates) {
        for (const variant of variants) {
          attempts++;
          const crop = await this.crop(png, roi, variant);
          const res = await this.ocr.recognize(crop.processed, {
            mode: field === 'message' ? 'block' : 'line',
            whitelist: field === 'rid' ? '#0123456789' : field === 'bet' ? '0123456789.,€S/ ' : undefined,
          });
          const reading = this.interpret(field, res.text, res.confidence, roi, cfg);
          const cropPath = this.saveCrop(field, crop.raw);
          const full: VisualReading = { ...reading, cropPath, attempts };
          if (!best || (full.value !== null && (best.value === null || full.confidence > best.confidence))) best = full;
          if (this.good(field, full, cfg)) {
            if (field !== 'message') located[field] = roi;
            return full;
          }
        }
      }
      // Si la zona guardada ya no contiene el ancla, se vuelve a buscar
      if (!relocated && field !== 'message') {
        candidates = [];
      }
    }
    return best ?? this.failed(field, png, null, 'lectura vacía tras los reintentos', attempts);
  }

  /**
   * Lectura aceptable. El rid se acepta por forma (# y 12-20 dígitos) aunque tesseract dé confianza baja con
   * texto tan pequeño: el check lo compara después con el rid del servidor.
   */
  private good(field: VisualField, r: VisualReading, cfg: RunConfig): boolean {
    if (r.value === null) return false;
    if (field === 'rid') return /#/.test(r.raw) && String(r.value).length >= 12 && String(r.value).length <= 20;
    return r.confidence >= cfg.ocr.minConfidence;
  }

  private interpret(field: VisualField, raw: string, confidence: number, roi: Roi, cfg: RunConfig): Omit<VisualReading, 'cropPath' | 'attempts'> {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (field === 'rid') {
      const digits = normalizeRid(text);
      return { field, raw: text, value: digits.length >= 4 ? digits : null, confidence, roi, reason: digits.length >= 4 ? undefined : 'sin dígitos de ronda' };
    }
    if (field === 'bet') {
      const cents = parseDisplayedAmount(text, cfg.numberFormat);
      return { field, raw: text, value: cents, currencySymbol: currencySymbolIn(text), confidence, roi, reason: cents === null ? 'sin importe legible' : undefined };
    }
    const lang = detectLanguage(text, cfg);
    return { field, raw: text, value: text ? normText(text) : null, confidence, roi, language: lang.language, reason: text ? undefined : 'sin texto' };
  }

  private async crop(png: Buffer, roi: Roi, variant: Variant) {
    const meta = await sharp(png).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const left = Math.max(0, Math.floor(roi.rx * W));
    const top = Math.max(0, Math.floor(roi.ry * H));
    const width = Math.max(4, Math.min(W - left, Math.ceil(roi.rw * W)));
    const height = Math.max(4, Math.min(H - top, Math.ceil(roi.rh * H)));
    const raw = await sharp(png).extract({ left, top, width, height }).png().toBuffer();
    let negate = variant.negate === true;
    if (variant.negate === 'auto') {
      // Texto claro sobre fondo oscuro → invertir
      const { dominant } = await sharp(raw).grayscale().stats();
      negate = dominant.r < 110;
    }
    let pipe = sharp(raw).grayscale().resize({ width: width * variant.scale, kernel: 'lanczos3' });
    if (negate) pipe = pipe.negate({ alpha: false });
    pipe = pipe.normalize();
    if (variant.threshold) pipe = pipe.threshold(variant.threshold);
    // Margen alrededor: tesseract lee peor el texto pegado al borde
    const processed = await pipe.extend({ top: 20, bottom: 20, left: 20, right: 20, background: negate ? '#ffffff' : '#000000' }).png().toBuffer();
    return { raw, processed };
  }

  private saveCrop(field: VisualField, png: Buffer): string {
    const rel = `evidence/crop-${field}.png`;
    fs.writeFileSync(path.join(this.dir, rel), png);
    return rel;
  }

  private async failed(field: VisualField, png: Buffer, roi: Roi | null, reason: string, attempts: number): Promise<VisualReading> {
    // cropPath siempre existe: si no hay zona, se guarda el recuadro entero para enseñar qué se vio
    const small = await sharp(png).resize({ width: 640, withoutEnlargement: true }).png().toBuffer().catch(() => png);
    return { field, raw: '', value: null, confidence: 0, roi, cropPath: this.saveCrop(field, small), attempts, reason };
  }
}
