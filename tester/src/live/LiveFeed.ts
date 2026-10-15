/**
 * Canal en directo hacia el centro de control (tester/control). Solo actúa si LIVE_URL está definida;
 * sin ella no hace nada y el tester funciona igual. Todo lo que sale se censura antes (redact).
 */
import type { BrowserContext, Page } from '@playwright/test';
import { redact } from '../evidence/redact';

const URL_BASE = process.env.LIVE_URL;

export const liveEnabled = () => !!URL_BASE;

export function live(type: string, data: Record<string, unknown> = {}) {
  if (!URL_BASE) return;
  const body = JSON.stringify(type === 'frame' ? { type, t: Date.now(), ...data } : redact({ type, t: Date.now(), ...data }));
  fetch(`${URL_BASE}/feed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
}

/** Retransmite la pestaña con el screencast de Chromium (jpeg, ~5 fps). Devuelve la función para pararlo. */
export async function startScreencast(context: BrowserContext, page: Page): Promise<() => Promise<void>> {
  if (!URL_BASE) return async () => {};
  try {
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', async (f: { data: string; sessionId: number }) => {
      live('frame', { data: f.data });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1100, maxHeight: 640, everyNthFrame: 2 });
    return async () => {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
    };
  } catch {
    return async () => {};
  }
}
