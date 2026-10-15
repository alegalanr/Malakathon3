/**
 * F3: el juego es el iframe más grande de la página (C4). Comprueba además que pinta algo (pngjs).
 */
import type { Frame, Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { Box } from '../contracts/schemas';

export interface GameHandle {
  frame: Frame;
  element: Locator;
  box: Box;
  origin: string;
  sender?: string;
  mode: 'real' | 'unknown';
}

export async function findGameFrame(page: Page, timeoutMs: number): Promise<GameHandle | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = page.locator('iframe');
    const n = await frames.count();
    let best: { i: number; area: number; box: Box } | null = null;
    for (let i = 0; i < n; i++) {
      const box = await frames.nth(i).boundingBox().catch(() => null);
      const area = box ? box.width * box.height : 0;
      if (box && area > 300 * 200 && (!best || area > best.area)) best = { i, area, box };
    }
    if (best) {
      const element = frames.nth(best.i);
      const frame = await (await element.elementHandle())?.contentFrame();
      if (frame && frame.url().startsWith('http')) {
        return { frame, element, box: best.box, origin: new URL(frame.url()).origin, mode: 'unknown' };
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

/** Desviación típica de luminancia: ~0 si el recuadro está en negro o en blanco. */
export function pixelStd(png: Buffer): number {
  const img = PNG.sync.read(png);
  let sum = 0;
  let sum2 = 0;
  const n = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const y = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

/** Fracción de píxeles que cambian entre dos capturas del mismo tamaño. */
export function changedFraction(a: Buffer, b: Buffer, threshold = 40): number {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  let changed = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > threshold) changed++;
  }
  return changed / (A.width * A.height);
}
