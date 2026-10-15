/**
 * Cartera de Betsson: el saldo oficial del operador.
 * Se lee la respuesta de /api/v2/wallet/balance que la propia web pide periódicamente (~30 s)
 * y al cargar la página. No se hacen llamadas propias a la API.
 */
import type { BrowserContext } from '@playwright/test';
import { toNumber } from '../money';
import type { Timeline } from '../evidence/timeline';

export interface WalletReading {
  t: number;
  total?: number;
  currency?: string;
}

export class BetssonWallet {
  readonly readings: WalletReading[] = [];
  private waiters: { after: number; resolve: (r: WalletReading) => void }[] = [];

  constructor(private timeline: Timeline) {}

  attach(context: BrowserContext) {
    context.on('response', async (r) => {
      if (!/\/api\/v2\/wallet\/balance/i.test(r.url()) || r.status() !== 200) return;
      const t = Date.now();
      let json: unknown;
      try {
        json = await r.json();
      } catch {
        return;
      }
      const bal = (json as { balance?: { totalAmount?: unknown; currencyCode?: unknown } })?.balance;
      const reading: WalletReading = {
        t,
        total: toNumber(bal?.totalAmount),
        currency: typeof bal?.currencyCode === 'string' ? bal.currencyCode : undefined,
      };
      this.readings.push(reading);
      this.timeline.add('wallet', { ...reading }, t);
      console.log(`  ⇠ cartera Betsson ${reading.total} ${reading.currency ?? ''}`);
      this.waiters = this.waiters.filter((w) => (reading.t >= w.after ? (w.resolve(reading), false) : true));
    });
  }

  latest(before = Infinity): WalletReading | undefined {
    return [...this.readings].reverse().find((r) => r.t <= before);
  }

  waitFor(after: number, timeoutMs: number): Promise<WalletReading | null> {
    const seen = this.readings.find((r) => r.t >= after);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const w = { after, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, timeoutMs);
    });
  }
}
