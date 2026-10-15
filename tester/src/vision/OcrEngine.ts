/**
 * Envoltorio de tesseract.js: un único worker reutilizado (eng + spa), cargado una vez (F0).
 * Los datos de idioma se guardan en .cache/tesseract para no descargarlos en cada ejecución.
 * Con TESSDATA_DIR (carpeta con <lang>.traineddata.gz) se usan datos locales y no se descarga nada.
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

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export class OcrEngine {
  private worker: Worker | null = null;
  /** Las llamadas se encolan: whitelist y modo son parámetros del worker, compartido. */
  private queue: Promise<unknown> = Promise.resolve();
  ready = false;
  error?: string;

  async init(languages: string[]) {
    try {
      const local = process.env.TESSDATA_DIR;
      this.worker = await createWorker(languages, 1, {
        ...(local ? { langPath: path.resolve(local), gzip: true, cacheMethod: 'none' } : { cachePath: path.join(__dirname, '..', '..', '.cache', 'tesseract') }),
        logger: () => {},
        errorHandler: () => {},
      });
      this.ready = true;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  recognize(png: Buffer, opts: { mode: OcrMode; whitelist?: string }): Promise<OcrResult> {
    const run = async (): Promise<OcrResult> => {
      if (!this.worker) throw new Error('OCR no disponible');
      await this.worker.setParameters({
        tessedit_pageseg_mode: PSM_OF[opts.mode],
        tessedit_char_whitelist: opts.whitelist ?? '',
        preserve_interword_spaces: '1',
      });
      const { data } = await this.worker.recognize(png);
      // Con whitelist, tesseract.js puede dar confianza 0 a la palabra o al texto aunque cada
      // carácter se haya leído bien: la confianza se calcula con la media de los caracteres.
      const symbolConf: number[] = [];
      const words: OcrWord[] = (data.words ?? []).map((w) => {
        const syms = (w.symbols ?? []).filter((s) => s.text.trim());
        syms.forEach((s) => symbolConf.push(s.confidence));
        return { text: w.text.trim(), confidence: clamp01((syms.length ? mean(syms.map((s) => s.confidence)) : w.confidence) / 100), bbox: w.bbox };
      });
      const conf = symbolConf.length ? mean(symbolConf) : (data.confidence ?? 0);
      return { text: (data.text ?? '').trim(), confidence: clamp01(conf / 100), words };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async terminate() {
    await this.queue.catch(() => undefined);
    await this.worker?.terminate();
    this.worker = null;
  }
}
