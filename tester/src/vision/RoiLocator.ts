/**
 * Zonas a leer (SOLUCION.md §3.5 paso 2): OCR de la barra inferior en modo "palabras con posición",
 * buscar el ancla ("APUESTA"/"BET", "#") y definir la zona del valor. Se guarda en posición relativa.
 *
 * Se lee la barra con dos preprocesados distintos y se juntan las palabras: con uno solo, las anclas
 * pequeñas o con brillo se pierden a menudo.
 */
import sharp from 'sharp';
import type { Roi, RunConfig } from '../contracts/schemas';
import { fixDigitConfusions } from '../domain/Money';
import type { OcrEngine } from './OcrEngine';
import { cropRel, PAD, preprocess, VARIANTS } from './preprocess';
import { normalizeText, similarity } from './textMatch';

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** Franja donde se busca: el último 30 % del recuadro del juego. */
const BAND = { rx: 0, ry: 0.7, rw: 1, rh: 0.3 };

export interface LocatedRois {
  rid?: Roi;
  bet?: Roi[]; // candidatas, de más a menos probable
}

interface Box { x0: number; y0: number; x1: number; y1: number } // px absolutos en la captura
interface Word { text: string; confidence: number; b: Box }

/** Busca las anclas en la franja inferior del recuadro del juego. */
export async function locateRois(ocr: OcrEngine, gamePng: Buffer, cfg: RunConfig): Promise<LocatedRois> {
  const { words, W, H } = await bandWords(ocr, gamePng);
  const out: LocatedRois = {};
  const rel = (b: Box, anchor: string): Roi => ({
    rx: clamp(b.x0 / W),
    ry: clamp(b.y0 / H),
    rw: clamp((b.x1 - b.x0) / W),
    rh: clamp((b.y1 - b.y0) / H),
    anchor,
  });

  // --- Apuesta: ancla "APUESTA"/"BET" (difusa: "APUE5TA" también vale) y el importe a su lado
  const anchors = cfg.ocr.anchors.bet.map(normalizeText);
  const bet = words
    .map((w) => ({ w, s: Math.max(...anchors.map((a) => similarity(normalizeText(w.text), a))) }))
    .filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s || b.w.confidence - a.w.confidence)[0]?.w;
  if (bet) {
    const a = bet.b;
    const aw = a.x1 - a.x0;
    const ah = a.y1 - a.y0;
    const cy = (b: Box) => (b.y0 + b.y1) / 2;
    const isAmount = (t: string) => /\d/.test(fixDigitConfusions(t)) || /^(€|S\/)$/.test(t);
    const candidates: Roi[] = [];

    // 1) Importe leído de verdad a la derecha, en la misma línea (sin saltar otra etiqueta)
    const right = words.filter((w) => w !== bet && w.b.x0 > a.x1 - aw * 0.1 && Math.abs(cy(w.b) - cy(a)) < ah * 0.7).sort((x, y) => x.b.x0 - y.b.x0);
    const value: Word[] = [];
    for (const w of right) {
      const prevEnd = value.length ? value[value.length - 1].b.x1 : a.x1;
      if (w.b.x0 - prevEnd > Math.max(aw * 1.5, W * 0.08)) break;
      if (isAmount(w.text)) value.push(w);
      else if (value.length) break;
    }
    // 2) Si no, importe debajo del ancla
    const below = value.length
      ? []
      : words.filter((w) => w !== bet && isAmount(w.text) && w.b.y0 > a.y0 + ah * 0.5 && w.b.y0 < a.y1 + ah * 2.5 && w.b.x0 < a.x1 + aw * 0.5 && w.b.x1 > a.x0 - aw * 0.5);
    const found = value.length ? value : below;
    if (found.length) {
      const u = union(found.map((w) => w.b));
      const h = u.y1 - u.y0;
      // Margen generoso (los dígitos con brillo ocupan más que la caja del OCR), pero sin pasar de la
      // mitad del hueco con la etiqueta: si no, el trazo final de "APUESTA" entra en el recorte y,
      // con la lista de dígitos permitidos, se lee como un "1" de más ("0,20 €" → "10,20 €").
      const x0 = value.length ? Math.max(u.x0 - h * 0.6, (a.x1 + u.x0) / 2) : u.x0 - h * 0.6;
      const y0 = value.length ? u.y0 - h * 0.45 : Math.max(u.y0 - h * 0.45, (a.y1 + u.y0) / 2);
      candidates.push(rel({ x0, y0, x1: u.x1 + h * 1.0, y1: u.y1 + h * 0.45 }, bet.text));
    }
    // 3) Zonas geométricas (por si el importe no se leyó al localizar): a la derecha y debajo
    candidates.push(rel({ x0: a.x1 + ah * 0.2, y0: a.y0 - ah * 0.4, x1: a.x1 + ah * 0.2 + aw * 2.6, y1: a.y0 + ah * 1.4 }, bet.text));
    candidates.push(rel({ x0: a.x0 - aw * 0.4, y0: a.y1 + ah * 0.05, x1: a.x0 + aw * 1.4, y1: a.y1 + ah * 1.95 }, bet.text));
    out.bet = candidates.filter((c) => c.rw > 0 && c.rh > 0);
  }

  // --- rid: el "#" se lee a menudo como "4" o "H" (comprobado): ancla = "#<dígitos>" o, en la esquina
  // inferior izquierda, una palabra con 6 o más dígitos que no sea un importe
  const digits = (s: string) => fixDigitConfusions(s).replace(/\D/g, '').length;
  const rid =
    words.find((w) => /^#\s*[0-9OolISB]{4,}/.test(w.text.trim())) ??
    words.filter((w) => digits(w.text) >= 6 && w.b.x1 < W * 0.4 && !/[€$,.]/.test(w.text)).sort((a, b) => a.b.x0 - b.b.x0)[0];
  if (rid) {
    const r = rid.b;
    const pad = (r.y1 - r.y0) * 0.5;
    out.rid = rel({ x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad * 2, y1: r.y1 + pad }, '#');
  }
  return out;
}

/** Mayúsculas sin tildes (para reconocer palabras de pantalla). */
const upper = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

export interface TextHit {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Palabras visibles en todo el recuadro del juego, en píxeles del recuadro (OCR ×2 en grises: el texto
 * de las pantallas de Pragmatic es pequeño). Sirve para reconocer pantallas («VOLATILIDAD» = intro).
 */
export async function readWords(ocr: OcrEngine, gamePng: Buffer): Promise<{ W: number; H: number; words: TextHit[] }> {
  const meta = await sharp(gamePng).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const scale = 2;
  const img = await sharp(gamePng).grayscale().resize({ width: W * scale }).normalize().png().toBuffer();
  const { words } = await ocr.recognize(img, { mode: 'sparse' });
  return {
    W,
    H,
    words: words.map((w) => ({ text: upper(w.text), x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale })),
  };
}

/** Zona central del juego, donde salen las ventanas de aviso. */
export const MESSAGE_ROI: Roi = { rx: 0.12, ry: 0.18, rw: 0.76, rh: 0.64, anchor: 'centro' };

// ---------------------------------------------------------------------------------------------

async function bandWords(ocr: OcrEngine, png: Buffer): Promise<{ words: Word[]; W: number; H: number }> {
  const { raw, px, W, H } = await cropRel(png, BAND);
  const words: Word[] = [];
  for (const v of VARIANTS.slice(0, 2)) {
    try {
      const res = await ocr.recognize(await preprocess(raw, v), { mode: 'sparse' });
      for (const w of res.words) {
        if (!w.text) continue;
        const b = {
          x0: (w.bbox.x0 - PAD) / v.scale + px.left,
          x1: (w.bbox.x1 - PAD) / v.scale + px.left,
          y0: (w.bbox.y0 - PAD) / v.scale + px.top,
          y1: (w.bbox.y1 - PAD) / v.scale + px.top,
        };
        // La misma palabra leída por las dos variantes: se queda una
        if (!words.some((o) => Math.abs(o.b.x0 - b.x0) < (o.b.x1 - o.b.x0) * 0.5 && Math.abs(o.b.y0 - b.y0) < (o.b.y1 - o.b.y0) * 0.5 && o.text === w.text)) {
          words.push({ text: w.text, confidence: w.confidence, b });
        }
      }
    } catch {
      // siguiente variante
    }
  }
  return { words, W, H };
}

function union(bs: Box[]): Box {
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}
