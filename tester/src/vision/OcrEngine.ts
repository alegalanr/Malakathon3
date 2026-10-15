/**
 * Envoltorio de tesseract.js: un único worker reutilizado (eng + spa), cargado una vez (F0).
 * Los datos de idioma se guardan en .cache/tesseract para no descargarlos en cada ejecución.
 */
import path from 'node:path';
import { createWorker, PSM, type Worker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  confidence: number; // 0-1
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  confidence: number; // 0-1
  words: OcrWord[];
}

export type OcrMode = 'line' | 'block' | 'sparse';
const PSM_OF: Record<OcrMode, PSM> = { line: PSM.SINGLE_LINE, block: PSM.SINGLE_BLOCK, sparse: PSM.SPARSE_TEXT };

export class OcrEngine {
  private worker: Worker | null = null;
  ready = false;
  error?: string;

  async init(languages: string[]) {
    try {
      this.worker = await createWorker(languages, 1, {
        cachePath: path.join(__dirname, '..', '..', '.cache', 'tesseract'),
        logger: () => {},
        errorHandler: () => {},
      });
      this.ready = true;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  async recognize(png: Buffer, opts: { mode: OcrMode; whitelist?: string }): Promise<OcrResult> {
    if (!this.worker) throw new Error('OCR no disponible');
    await this.worker.setParameters({
      tessedit_pageseg_mode: PSM_OF[opts.mode],
      tessedit_char_whitelist: opts.whitelist ?? '',
      preserve_interword_spaces: '1',
    });
    const { data } = await this.worker.recognize(png);
    return {
      text: data.text.trim(),
      confidence: (data.confidence ?? 0) / 100,
      words: (data.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence / 100, bbox: w.bbox })),
    };
  }

  async terminate() {
    await this.worker?.terminate();
    this.worker = null;
  }
}
