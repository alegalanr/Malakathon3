/**
 * Zonas a leer (SOLUCION.md §3.5 paso 2): OCR de la barra inferior en modo "palabras con posición",
 * buscar el ancla ("APUESTA"/"BET", "#") y definir la zona del valor. Se guarda en posición relativa.
 */
import sharp from 'sharp';
import type { Roi, RunConfig } from '../contracts/schemas';
import type { OcrEngine, OcrWord } from './OcrEngine';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export interface LocatedRois {
  rid?: Roi;
  bet?: Roi[]; // candidatas: a la derecha del ancla y debajo
}

/** Busca las anclas en la franja inferior (último 30 %) del recuadro del juego. */
export async function locateRois(ocr: OcrEngine, gamePng: Buffer, cfg: RunConfig): Promise<LocatedRois> {
  const meta = await sharp(gamePng).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const bandTop = Math.round(H * 0.7);
  const scale = 2;
  const bandOf = (negate: boolean) => {
    let p = sharp(gamePng).extract({ left: 0, top: bandTop, width: W, height: H - bandTop }).grayscale().resize({ width: W * scale });
    if (negate) p = p.negate({ alpha: false });
    return p.normalize().png().toBuffer();
  };
  const betAnchorsN = cfg.ocr.anchors.bet.map(norm);
  const hasAnchor = (ws: OcrWord[]) => ws.some((w) => betAnchorsN.some((a) => norm(w.text).startsWith(a)));
  let { words } = await ocr.recognize(await bandOf(false), { mode: 'sparse' });
  // ✔ (15/10) Texto claro sobre el fondo del juego: a veces solo se lee invertido
  if (!hasAnchor(words)) {
    const inv = await ocr.recognize(await bandOf(true), { mode: 'sparse' });
    if (hasAnchor(inv.words)) words = inv.words;
  }
  const toAbs = (w: OcrWord) => ({
    x0: w.bbox.x0 / scale,
    x1: w.bbox.x1 / scale,
    y0: bandTop + w.bbox.y0 / scale,
    y1: bandTop + w.bbox.y1 / scale,
  });
  const out: LocatedRois = {};

  const betAnchors = cfg.ocr.anchors.bet.map(norm);
  // Palabra completa («APUESTA», «APUESTA:», «BET0,20»), no cualquiera que empiece igual («BETTER»)
  const isAnchor = (t: string, a: string) => t.startsWith(a) && !/^[A-Z]/.test(t.slice(a.length));
  const bet = words.find((w) => betAnchors.some((a) => isAnchor(norm(w.text), a)));
  if (bet) {
    const b = toAbs(bet);
    const aw = b.x1 - b.x0;
    const ah = b.y1 - b.y0;
    out.bet = [
      // a la derecha del ancla
      { rx: clamp((b.x1 + ah * 0.2) / W), ry: clamp((b.y0 - ah * 0.4) / H), rw: clamp((aw * 2.6) / W), rh: clamp((ah * 1.8) / H), anchor: bet.text },
      // debajo del ancla
      { rx: clamp((b.x0 - aw * 0.4) / W), ry: clamp((b.y1 + ah * 0.05) / H), rw: clamp((aw * 1.8) / W), rh: clamp((ah * 1.9) / H), anchor: bet.text },
    ];
  }

  // El "#" se lee a menudo como "4" o "H" (comprobado): ancla = "#<dígitos>" o, en la esquina inferior
  // izquierda, una palabra con 6 o más dígitos
  const digits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/\D/g, '').length;
  const rid =
    words.find((w) => /^#\s*[0-9OolISB]{4,}/.test(w.text.trim())) ??
    words.filter((w) => digits(w.text) >= 6 && toAbs(w).x1 < W * 0.4 && !/[€$]/.test(w.text)).sort((a, b) => a.bbox.x0 - b.bbox.x0)[0];
  if (rid) {
    const r = toAbs(rid);
    const pad = (r.y1 - r.y0) * 0.5;
    out.rid = { rx: clamp((r.x0 - pad) / W), ry: clamp((r.y0 - pad) / H), rw: clamp((r.x1 - r.x0 + pad * 2) / W), rh: clamp((r.y1 - r.y0 + pad * 2) / H), anchor: '#' };
  }
  return out;
}

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
    words: words.map((w) => ({ text: norm(w.text), x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale })),
  };
}

/** Zona central del juego, donde salen las ventanas de aviso. */
export const MESSAGE_ROI: Roi = { rx: 0.12, ry: 0.18, rw: 0.76, rh: 0.64, anchor: 'centro' };
