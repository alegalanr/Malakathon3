/**
 * F8: testigo visual. OCR dirigido sobre la captura liquidada o de rechazo (SOLUCION.md §3.5, C11 → C12).
 * El OCR es testigo, no juez: lee 2-3 recortes pequeños y nunca lanza excepción.
 *
 * Consenso en rid y apuesta: un valor solo se acepta cuando DOS lecturas con preprocesados distintos
 * coinciden. Una lectura suelta puede confundir un 4 con un 2 con confianza alta (comprobado con
 * tesseract.js sobre un juego sintético); dos variantes casi nunca fallan igual. Si no hay acuerdo,
 * el valor es null con el motivo, y el check visual da FAIL "testigo visual no legible" en vez de
 * comparar con un número inventado. La apuesta leída en F5 decide si se gira con dinero real.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Roi, RunConfig, VisualField, VisualReading } from '../contracts/schemas';
import { currencySymbolIn, parseDisplayedAmount } from '../domain/Money';
import type { OcrEngine } from './OcrEngine';
import { cropRel, preprocess, VARIANTS } from './preprocess';
import { locateRois, MESSAGE_ROI } from './RoiLocator';
import { containsFuzzy, normalizeText } from './textMatch';

export interface WitnessRequest {
  capture: { png: Buffer; t: number; triggerEvent: string };
  fields: VisualField[];
  rois: { rid?: Roi; bet?: Roi };
  config: RunConfig;
  /** Nueva captura del recuadro del juego (3.er intento, 500 ms después). */
  recapture?: () => Promise<Buffer | null>;
}

const OTHER_LANG_WORDS: Record<'es' | 'en', string[]> = {
  es: ['insuficiente', 'saldo', 'fondos', 'no tienes', 'suficiente', 'deposita'],
  en: ['insufficient', 'not enough', 'funds', 'balance', 'deposit'],
};
const RECAPTURE_DELAY_MS = 500;
/** Dígitos mínimos para dar por leído un rid (los de Pragmatic tienen 9 o más). */
const MIN_RID_DIGITS = 6;

/** Corrige confusiones típicas solo dentro de la parte numérica (O→0, l/I→1, S→5, B→8). */
export function normalizeRid(raw: string): string {
  const after = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  return after.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/\D/g, '');
}

/**
 * Frase completa dentro del texto: «deposit» no debe encontrarse dentro de «deposita» (regla de Julia,
 * escenario 2). Exacta; la versión tolerante a errores del OCR es `matchesPhrase`.
 */
export function hasPhrase(normalizedText: string, phrase: string): boolean {
  const p = normalizeText(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return p !== '' && new RegExp(`(^|[^a-z0-9ñ])${p}($|[^a-z0-9ñ])`).test(normalizeText(normalizedText));
}

/**
 * La frase aparece como palabras completas, con tolerancia a errores del OCR ("sald0 insuficlente").
 * Las frases cortas exigen más parecido: si no, «suficiente» casaría con «insuficiente».
 */
function matchesPhrase(text: string, phrase: string): { found: boolean; score: number; match?: string } {
  if (hasPhrase(text, phrase)) return { found: true, score: 1, match: normalizeText(phrase) };
  const minSimilarity = normalizeText(phrase).length <= 12 ? 0.9 : 0.8;
  return containsFuzzy(text, phrase, minSimilarity);
}

/**
 * Idioma del aviso. Comparación por palabras completas y tolerante al OCR, pero una frase del mercado
 * no cuenta si lo leído se parece igual o más a una del otro idioma ("insufficient" ≈ "insuficiente").
 */
export function detectLanguage(text: string, cfg: RunConfig): { language?: 'es' | 'en'; hits: string[]; foreign: string[] } {
  const otherLang = cfg.language === 'es' ? 'en' : 'es';
  const own = OTHER_LANG_WORDS[cfg.language].map(normalizeText);
  const otherWords = OTHER_LANG_WORDS[otherLang].map(normalizeText).filter((k) => !own.includes(k));
  const foreign = otherWords.filter((k) => containsFuzzy(text, k, 0.9).found);
  const hits = cfg.texts.insufficientBalance.filter((k) => {
    const m = matchesPhrase(text, k);
    if (!m.found || !m.match) return false;
    const otherScore = Math.max(0, ...otherWords.map((o) => containsFuzzy(m.match!, o, 0).score));
    return m.score > otherScore;
  });
  if (hits.length && !foreign.length) return { language: cfg.language, hits, foreign };
  if (foreign.length) return { language: otherLang, hits, foreign };
  return { hits, foreign };
}

interface Attempt {
  raw: string;
  value: string | number | null;
  confidence: number;
  currencySymbol?: string;
  language?: 'es' | 'en';
  reason?: string;
  valid: boolean;
  crop: Buffer;
}

interface ReadState {
  png: Buffer;
  recaptured: boolean;
  attempts: number;
}

export class ScreenWitness {
  constructor(
    private ocr: OcrEngine,
    private dir: string, // carpeta del run
  ) {}

  async read(req: WitnessRequest): Promise<{ readings: VisualReading[]; locatedRois: { rid?: Roi; bet?: Roi } }> {
    const readings: VisualReading[] = [];
    const locatedRois: { rid?: Roi; bet?: Roi } = {};
    const state: ReadState = { png: req.capture.png, recaptured: false, attempts: 0 };
    for (const field of req.fields) {
      state.attempts = 0;
      try {
        readings.push(await this.readField(field, req, locatedRois, state));
      } catch (e) {
        readings.push(await this.failed(field, req, state.png, null, `error del testigo: ${(e as Error).message}`, Math.max(1, state.attempts)));
      }
    }
    return { readings, locatedRois };
  }

  private async readField(field: VisualField, req: WitnessRequest, located: { rid?: Roi; bet?: Roi }, state: ReadState): Promise<VisualReading> {
    if (!this.ocr.ready) return this.failed(field, req, state.png, null, 'testigo no disponible (OCR sin cargar)', 1);

    let candidates: Roi[] = field === 'message' ? [MESSAGE_ROI] : req.rois[field] ? [req.rois[field]!] : [];
    let relocated = false;
    let best: { reading: VisualReading; score: number } | null = null;

    for (;;) {
      if (!candidates.length && !relocated && field !== 'message') {
        const found = await locateRois(this.ocr, state.png, req.config);
        relocated = true;
        candidates = field === 'rid' ? (found.rid ? [found.rid] : []) : (found.bet ?? []);
      }
      if (!candidates.length) {
        return best?.reading ?? this.failed(field, req, state.png, null, 'zona no localizada (ancla no encontrada)', Math.max(1, state.attempts));
      }
      for (const roi of candidates) {
        const { accepted, reading, score } = await this.readRoi(field, roi, req, state);
        if (accepted) {
          if (field !== 'message') located[field] = roi;
          return reading;
        }
        if (!best || score > best.score) best = { reading, score };
      }
      // La zona guardada ya no da una lectura válida (otro tamaño, otra versión del juego): se vuelve a buscar
      if (!relocated && field !== 'message') {
        candidates = [];
        continue;
      }
      return best!.reading;
    }
  }

  /** Lee una zona con varias variantes. rid/apuesta: consenso de 2. Mensaje: la primera con palabras clave. */
  private async readRoi(field: VisualField, roi: Roi, req: WitnessRequest, state: ReadState): Promise<{ accepted: boolean; reading: VisualReading; score: number }> {
    const cfg = req.config;
    const attempts: Attempt[] = [];
    for (let i = 0; i < cfg.ocr.maxAttempts; i++) {
      // Si tras dos intentos no hay ninguna lectura válida (p. ej. el contador aún se mueve), se recaptura una vez
      if (i === 2 && req.recapture && !state.recaptured && !attempts.some((a) => a.valid)) {
        await new Promise((r) => setTimeout(r, RECAPTURE_DELAY_MS));
        const again = await req.recapture().catch(() => null);
        if (again) state.png = again;
        state.recaptured = true;
      }
      state.attempts++;
      const variant = VARIANTS[i % VARIANTS.length];
      const { raw: crop } = await cropRel(state.png, roi);
      const res = await this.ocr.recognize(await preprocess(crop, variant), {
        mode: field === 'message' ? 'block' : 'line',
        // Apuesta CON espacio: ✔ (15/10, Bubble Up real) sin él, el hueco entre «4,00» y «€» se lee «6» o se pierde
        // («4.006€», «400€») y no hay consenso; con él, x4/x5-gris leen «4,00 €» con confianza 0,99
        whitelist: field === 'rid' ? '#0123456789' : field === 'bet' ? '0123456789.,€S/ ' : undefined,
      });
      const a = this.interpret(field, res.text, res.confidence, cfg, crop);
      attempts.push(a);
      if (field === 'message' && a.valid) break;
      if (field !== 'message' && winner(attempts)) break;
    }

    const base = { field, roi, attempts: Math.max(1, state.attempts) };
    if (field === 'message') {
      const pick = attempts.find((a) => a.valid) ?? [...attempts].sort((a, b) => b.confidence - a.confidence || b.raw.length - a.raw.length)[0];
      const reading: VisualReading = {
        ...base,
        raw: pick.raw,
        value: pick.value,
        confidence: pick.confidence,
        language: pick.language,
        reason: pick.reason,
        cropPath: this.saveCrop(field, req, pick.crop),
      };
      return { accepted: pick.valid, reading, score: pick.valid ? 2 : pick.value ? 1 : 0 };
    }

    const win = winner(attempts);
    if (win) {
      const reading: VisualReading = {
        ...base,
        raw: win[0].raw,
        value: win[0].value,
        confidence: win.reduce((s, a) => s + a.confidence, 0) / win.length,
        currencySymbol: win.find((a) => a.currencySymbol)?.currencySymbol,
        cropPath: this.saveCrop(field, req, win[0].crop),
      };
      return { accepted: true, reading, score: 3 };
    }
    const valid = attempts.filter((a) => a.valid);
    const distinct = [...new Set(valid.map((a) => String(a.value)))];
    const pick = valid[0] ?? [...attempts].sort((a, b) => b.confidence - a.confidence)[0];
    const reason =
      distinct.length > 1
        ? `las lecturas no coinciden (${distinct.join(' / ')})`
        : valid.length === 1
          ? 'solo una lectura válida, sin una segunda que la confirme'
          : pick.value !== null
            ? `confianza ${pick.confidence.toFixed(2)} < ${cfg.ocr.minConfidence}`
            : (pick.reason ?? 'sin lectura');
    const reading: VisualReading = {
      ...base,
      raw: pick.raw,
      value: null,
      confidence: pick.confidence,
      currencySymbol: pick.currencySymbol,
      reason,
      cropPath: this.saveCrop(field, req, pick.crop),
    };
    return { accepted: false, reading, score: valid.length ? 2 : pick.raw ? 1 : 0 };
  }

  private interpret(field: VisualField, rawText: string, confidence: number, cfg: RunConfig, crop: Buffer): Attempt {
    const raw = rawText.replace(/\s+/g, ' ').trim();
    const ok = confidence >= cfg.ocr.minConfidence;
    if (!raw) return { raw, value: null, confidence, reason: 'lectura vacía', valid: false, crop };
    if (field === 'rid') {
      const digits = normalizeRid(raw);
      return digits.length >= MIN_RID_DIGITS
        ? { raw, value: digits, confidence, valid: ok, crop }
        : { raw, value: null, confidence, reason: 'sin dígitos de ronda', valid: false, crop };
    }
    if (field === 'bet') {
      const cents = parseDisplayedAmount(raw, cfg.numberFormat);
      const currencySymbol = currencySymbolIn(raw);
      return cents === null
        ? { raw, value: null, confidence, currencySymbol, reason: 'sin importe legible (o ambiguo)', valid: false, crop }
        : { raw, value: cents, confidence, currencySymbol, valid: ok, crop };
    }
    const lang = detectLanguage(raw, cfg);
    const known = lang.hits.length > 0 || lang.foreign.length > 0;
    return {
      raw,
      value: normalizeText(raw),
      confidence,
      language: lang.language,
      reason: known ? undefined : 'no aparece ninguna palabra conocida del aviso',
      valid: ok && known,
      crop,
    };
  }

  /** Un recorte por campo y momento (reposo, liquidada, rechazo): no se pisan entre F5 y F8. */
  private saveCrop(field: VisualField, req: WitnessRequest, png: Buffer): string {
    const tag = req.capture.triggerEvent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'captura';
    const rel = `evidence/crop-${field}-${tag}.png`;
    fs.mkdirSync(path.join(this.dir, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, rel), png);
    return rel;
  }

  private async failed(field: VisualField, req: WitnessRequest, png: Buffer, roi: Roi | null, reason: string, attempts: number): Promise<VisualReading> {
    // cropPath siempre existe: si no hay zona, se guarda el recuadro entero para enseñar qué se vio
    const small = await sharp(png).resize({ width: 640, withoutEnlargement: true }).png().toBuffer().catch(() => png);
    return { field, raw: '', value: null, confidence: 0, roi, cropPath: this.saveCrop(field, req, small), attempts, reason };
  }
}

/** Valor con al menos dos lecturas válidas iguales (devuelve esas lecturas), o null. */
function winner(attempts: Attempt[]): Attempt[] | null {
  const groups = new Map<string, Attempt[]>();
  for (const a of attempts) if (a.valid) groups.set(String(a.value), [...(groups.get(String(a.value)) ?? []), a]);
  return [...groups.values()].find((g) => g.length >= 2) ?? null;
}
