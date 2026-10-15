/**
 * F2: segunda fuente. Lee doSpin/doCollect de la red (SOLUCION.md §2.3) → SpinRecord (C6).
 * bet = c × l de la PETICIÓN; nunca guarda cabeceras ni tokens.
 */
import type { BrowserContext, Response } from '@playwright/test';
import type { SpinRecord } from '../contracts/schemas';
import type { Evidence } from '../evidence/Evidence';
import { eurosToCents } from '../domain/Money';

const params = (s: string | null | undefined) => new URLSearchParams(s ?? '');

export class GameServerTap {
  readonly spins: SpinRecord[] = [];
  readonly calls: { t: number; action: string; status: number }[] = [];
  /** ✔ (15/10) Apuesta con la que arranca el juego, de la respuesta de doInit: c (moneda) × l (líneas). */
  init?: { bet: number; coin: number; lines: number; t: number };
  private active = false;
  private pending: Promise<void>[] = [];

  constructor(private ev: Evidence) {}

  attach(context: BrowserContext) {
    context.on('response', (r) => {
      if (/gameService/i.test(r.url())) this.pending.push(this.onResponse(r, Date.now()));
    });
    this.active = true;
  }

  isActive() {
    return this.active;
  }

  /** Espera a que se terminen de leer las respuestas ya recibidas. */
  async settle() {
    await Promise.allSettled(this.pending);
  }

  private async onResponse(r: Response, t: number) {
    const req = params(r.request().postData());
    const action = req.get('action') ?? '?';
    this.calls.push({ t, action, status: r.status() });
    let body = '';
    try {
      body = await r.text();
    } catch {
      /* la página puede haberse cerrado */
    }
    const res = params(body);
    if (!/^do(Spin|Collect)$/.test(action)) {
      // doInit (la acción no siempre viene en la petición; la respuesta la repite)
      if ((action === 'doInit' || res.get('action') === 'doInit' || !res.has('rid')) && res.has('c') && res.has('l')) {
        const coin = Number(res.get('c'));
        const lines = Number(res.get('l'));
        if (Number.isFinite(coin) && Number.isFinite(lines)) {
          this.init = { bet: Math.round(coin * lines * 100), coin, lines, t };
          this.ev.log('network', 'doInit', `apuesta=${this.init.bet} (c=${coin} × l=${lines}) saldo=${eurosToCents(res.get('balance') ?? undefined) ?? '—'}`, this.init, t);
        }
      }
      return;
    }
    if (action === 'doSpin') {
      const c = Number(req.get('c'));
      const l = Number(req.get('l'));
      const rec: SpinRecord = {
        rid: res.get('rid') ?? undefined,
        bet: Number.isFinite(c) && Number.isFinite(l) && req.get('c') ? Math.round(c * l * 100) : undefined,
        balanceAfterSpin: eurosToCents(res.get('balance') ?? undefined),
        win: eurosToCents(res.get('tw') ?? undefined),
        needsCollect: res.get('na') === 'c',
        status: r.status(),
        error: r.status() >= 400 || !res.has('balance') ? (body.slice(0, 120) || `HTTP ${r.status()}`) : undefined,
        t,
      };
      this.spins.push(rec);
      this.ev.log('network', 'doSpin', `rid=${rec.rid ?? '—'} apuesta=${rec.bet ?? '—'} saldo=${rec.balanceAfterSpin ?? '—'} premio=${rec.win ?? '—'} na=${res.get('na') ?? '—'}`, rec, t);
    } else {
      const last = [...this.spins].reverse().find((s) => s.t <= t);
      const bal = eurosToCents(res.get('balance') ?? undefined);
      if (last) last.collectBalance = bal;
      this.ev.log('network', 'doCollect', `saldo=${bal ?? '—'}`, { balance: bal }, t);
    }
  }

  spinsBetween(from: number, to = Infinity) {
    return this.spins.filter((s) => s.t >= from && s.t <= to);
  }
}
