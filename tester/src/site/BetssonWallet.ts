/**
 * Cartera de Betsson (C7): respuestas de /api/v2/wallet/balance que pide la propia web (~30 s).
 * Solo se lee lo que la página ya recibe; para forzar un refresco se recarga la página, como un jugador.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { WalletReading } from '../contracts/schemas';
import type { Evidence } from '../evidence/Evidence';
import { eurosToCents } from '../domain/Money';

export class BetssonWallet {
  readonly readings: WalletReading[] = [];
  private waiters: { after: number; resolve: (r: WalletReading) => void }[] = [];
  private active = false;

  constructor(private ev: Evidence) {}

  attach(context: BrowserContext) {
    context.on('response', async (r) => {
      if (!/\/api\/v2\/wallet\/balance/i.test(r.url()) || r.status() !== 200) return;
      const t = Date.now(); // hora de RESPUESTA
      try {
        const json = (await r.json()) as { balance?: { totalAmount?: unknown; currencyCode?: unknown } };
        const amount = eurosToCents(json.balance?.totalAmount);
        const currency = json.balance?.currencyCode;
        if (amount === undefined || typeof currency !== 'string') return;
        const reading: WalletReading = { amount, currency, t, source: 'api' };
        this.readings.push(reading);
        this.ev.log('wallet', 'balance', `${amount} ${currency}`, reading, t);
        this.waiters = this.waiters.filter((w) => (t > w.after ? (w.resolve(reading), false) : true));
      } catch {
        /* respuesta no JSON */
      }
    });
    this.active = true;
  }

  isActive() {
    return this.active;
  }

  read(before = Infinity): WalletReading | undefined {
    return [...this.readings].reverse().find((r) => r.t <= before);
  }

  /** Solo devuelve lecturas con t > after (C7). */
  waitForChange(after: number, timeoutMs: number): Promise<WalletReading | null> {
    const seen = this.readings.find((r) => r.t > after);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const w = { after, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        if (!this.waiters.includes(w)) return;
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, timeoutMs);
    });
  }

  /** Espera un refresco posterior a `after`; si no llega, recarga la página y espera otra vez. */
  async readAfter(page: Page, after: number, waitMs: number): Promise<{ reading: WalletReading | null; reloaded: boolean }> {
    let reading = await this.waitForChange(after, waitMs);
    if (reading) return { reading, reloaded: false };
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    reading = await this.waitForChange(after, 25_000);
    return { reading, reloaded: true };
  }
}
