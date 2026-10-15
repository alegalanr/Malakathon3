/**
 * Evidencia de un run: carpeta reports/<market>-<scenario>/, capturas, recortes y timeline.jsonl censurado.
 * Las marcas de tiempo son las del momento observado, no las de cuando termina la captura (~0,7 s).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { live } from '../live/LiveFeed';
import { redact, redactText } from './redact';

export interface TimelineEntry {
  t: number;
  source: 'event' | 'network' | 'wallet' | 'action' | 'screen' | 'phase' | 'note' | 'raw';
  type: string;
  summary: string;
  data?: unknown;
}

export class Evidence {
  readonly dir: string;
  readonly evidenceDir: string;
  readonly timeline: TimelineEntry[] = [];
  readonly screenshots: { label: string; path: string; t?: number }[] = [];

  constructor(reportsDir: string, runKey: string) {
    this.dir = path.join(reportsDir, runKey);
    this.evidenceDir = path.join(this.dir, 'evidence');
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.evidenceDir, { recursive: true });
  }

  log(source: TimelineEntry['source'], type: string, summary: string, data?: unknown, t = Date.now()) {
    this.timeline.push({ t, source, type, summary, data });
    if (source !== 'raw' && source !== 'phase') live('log', { source, kind: type, summary, at: t });
    // La consola acaba en los logs de CI: se censura igual que el timeline
    if (source !== 'raw') console.log(redactText(`  ${source.padEnd(7)} ${type}${summary ? ' · ' + summary : ''}`));
  }

  rel(file: string) {
    return path.relative(this.dir, file).split(path.sep).join('/');
  }

  /** Guarda un PNG ya capturado y lo registra. */
  savePng(name: string, png: Buffer, label: string, t?: number): string {
    const file = path.join(this.evidenceDir, `${name}.png`);
    fs.writeFileSync(file, png);
    const rel = this.rel(file);
    this.screenshots.push({ label, path: rel, t });
    return rel;
  }

  /**
   * Captura de la página o de un elemento (el recuadro del juego). `t` = hora del evento disparador.
   * `mask`: zonas que se tapan antes de guardar (datos de la cuenta en las capturas de página completa).
   */
  async capture(target: Page | Locator, name: string, label: string, t = Date.now(), opts: { mask?: Locator[] } = {}): Promise<{ png: Buffer; path: string; t: number } | null> {
    const png = await target.screenshot({ animations: 'allow', ...(opts.mask?.length ? { mask: opts.mask, maskColor: '#000' } : {}) }).catch(() => null);
    if (!png) return null;
    return { png, path: this.savePng(name, png, label, t), t };
  }

  writeTimeline() {
    const lines = [...this.timeline].sort((a, b) => a.t - b.t).map((e) => JSON.stringify(redact(e)));
    fs.writeFileSync(path.join(this.dir, 'timeline.jsonl'), lines.join('\n') + '\n');
  }

  /** Resumen para el informe (sin datos en bruto). */
  summaryTimeline() {
    return [...this.timeline]
      .filter((e) => e.source !== 'raw')
      .sort((a, b) => a.t - b.t)
      .map(({ t, source, type, summary }) => redact({ t, source, type, summary }));
  }
}
