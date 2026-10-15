/**
 * F2: oye los postMessage que llegan a la página de Betsson (top window, nunca dentro del juego)
 * y publica eventos estándar con la hora de recepción (C3, C5).
 */
import type { BrowserContext } from '@playwright/test';
import type { EventType, StandardEvent } from '../contracts/schemas';
import type { Evidence } from '../evidence/Evidence';
import type { ProviderAdapter, RawMessage } from '../providers/ProviderAdapter';

export class EventTimeoutError extends Error {
  constructor(
    readonly expected: EventType,
    readonly lastEvents: string[],
  ) {
    super(`no llegó ${expected} a tiempo (últimos eventos: ${lastEvents.join(', ') || 'ninguno'})`);
  }
}

type Waiter = { type: EventType; after: number; where?: (e: StandardEvent) => boolean; resolve: (e: StandardEvent) => void };

export class GameEventBus {
  readonly events: StandardEvent[] = [];
  readonly state = { ready: false, roundInProgress: false, currentBet: undefined as number | undefined, lastBalance: undefined as number | undefined, lastCurrency: undefined as string | undefined, sender: undefined as string | undefined };
  /** Carga del juego (loadingProgress): porcentaje y cuándo avanzó por última vez. */
  readonly loading = { percent: 0, advancedAt: 0 };
  private waiters: Waiter[] = [];
  private active = false;
  gameOrigin?: string;

  constructor(
    private adapter: ProviderAdapter,
    private ev: Evidence,
  ) {}

  async attach(context: BrowserContext) {
    await context.exposeBinding('__qaPostMessage', (_src, msg: RawMessage) => this.ingest(msg));
    await context.addInitScript(() => {
      if (window !== window.top) return; // solo la página de Betsson
      window.addEventListener(
        'message',
        (e) => {
          let data: unknown = e.data;
          try {
            data = typeof data === 'string' ? data : JSON.parse(JSON.stringify(data));
          } catch {
            data = String(data);
          }
          // @ts-expect-error binding de Playwright
          window.__qaPostMessage?.({ t: Date.now(), origin: e.origin, data });
        },
        true,
      );
    });
    this.active = true;
  }

  isActive() {
    return this.active;
  }

  ingest(msg: RawMessage) {
    this.trackLoading(msg);
    const e = this.adapter.translate(msg, this.gameOrigin);
    if (!e) {
      this.ev.log('raw', 'message', msg.origin, msg.data, msg.t);
      return;
    }
    this.events.push(e);
    this.apply(e);
    const d = Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ');
    this.ev.log('event', e.type === 'UNKNOWN' ? `UNKNOWN(${e.name})` : `${e.type} ← ${e.name}`, d, { raw: e.raw, sender: e.sender }, e.t);
    this.waiters = this.waiters.filter((w) => {
      if (w.type === e.type && e.t >= w.after && (!w.where || w.where(e))) {
        w.resolve(e);
        return false;
      }
      return true;
    });
  }

  private trackLoading(msg: RawMessage) {
    let o: unknown = msg.data;
    if (typeof o === 'string') {
      try {
        o = JSON.parse(o);
      } catch {
        return;
      }
    }
    const m = o as { event?: string; params?: { percentage?: number } } | null;
    const p = m?.event === 'loadingProgress' ? m.params?.percentage : undefined;
    if (typeof p === 'number' && p > this.loading.percent) {
      this.loading.percent = p;
      this.loading.advancedAt = msg.t;
    }
  }

  /**
   * READY, esperando mientras la carga avance: falla si la carga se queda parada `stallMs`
   * o si se pasa de `maxMs` en total. Con la web real la carga tarda de 40 s a más de 100 s.
   */
  async waitForReady(opts: { stallMs: number; maxMs: number }): Promise<StandardEvent> {
    const start = Date.now();
    for (;;) {
      const ready = await this.tryWaitFor('READY', { timeoutMs: 5000 });
      if (ready) return ready;
      const lastProgress = Math.max(this.loading.advancedAt, start);
      if (Date.now() - lastProgress > opts.stallMs) throw new Error(`la carga del juego se paró en el ${this.loading.percent} % (${Math.round(opts.stallMs / 1000)} s sin avanzar)`);
      if (Date.now() - start > opts.maxMs) throw new Error(`el juego no terminó de cargar en ${Math.round(opts.maxMs / 1000)} s (iba por el ${this.loading.percent} %)`);
    }
  }

  private apply(e: StandardEvent) {
    if (e.sender) this.state.sender = e.sender;
    switch (e.type) {
      case 'READY':
        this.state.ready = true;
        break;
      case 'ROUND_STARTED':
        this.state.roundInProgress = true;
        if (e.data.bet !== undefined) this.state.currentBet = e.data.bet;
        break;
      case 'ROUND_ENDED':
        this.state.roundInProgress = false;
        break;
      case 'BET_CHANGED':
        this.state.currentBet = e.data.bet;
        break;
      case 'BALANCE':
        this.state.lastBalance = e.data.amount;
        if (e.data.currency) this.state.lastCurrency = e.data.currency;
        break;
    }
  }

  /** Resuelve con el primer evento del tipo posterior a `after`; si se agota el tiempo, EventTimeoutError. */
  waitFor(type: EventType, opts: { timeoutMs: number; after?: number; where?: (e: StandardEvent) => boolean }): Promise<StandardEvent> {
    const after = opts.after ?? 0;
    const seen = this.events.find((e) => e.type === type && e.t >= after && (!opts.where || opts.where(e)));
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w: Waiter = { type, after, where: opts.where, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        if (!this.waiters.includes(w)) return;
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new EventTimeoutError(type, this.events.slice(-5).map((x) => x.name)));
      }, opts.timeoutMs);
    });
  }

  async tryWaitFor(type: EventType, opts: { timeoutMs: number; after?: number }): Promise<StandardEvent | undefined> {
    try {
      return await this.waitFor(type, opts);
    } catch (e) {
      if (e instanceof EventTimeoutError) return undefined;
      throw e;
    }
  }

  between(type: EventType, from: number, to = Infinity) {
    return this.events.filter((e) => e.type === type && e.t >= from && e.t <= to);
  }

  last(type: EventType, before = Infinity) {
    return [...this.events].reverse().find((e) => e.type === type && e.t <= before);
  }
}
