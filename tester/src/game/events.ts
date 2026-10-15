/**
 * Eventos del juego: lo que el juego le cuenta a Betsson por postMessage.
 *
 * Cómo se escuchan: un script inyectado en todas las páginas y frames antes de que carguen
 * añade un listener de "message" y reenvía cada mensaje a Node (exposeBinding) con la hora
 * de llegada. No se toca el código del juego: solo se escucha lo que ya se envía al operador.
 *
 * El resto del tester solo conoce los eventos estándar; cada proveedor tiene un adaptador.
 */
import type { BrowserContext } from '@playwright/test';
import { toNumber } from '../money';
import type { Timeline } from '../evidence/timeline';

export type EventType =
  | 'READY'
  | 'ROUND_STARTED'
  | 'SPIN_STARTED'
  | 'SPIN_ENDED'
  | 'GAME_ROUND_ENDED'
  | 'ROUND_ENDED'
  | 'BET_CHANGED'
  | 'BALANCE'
  | 'OTHER';

export interface GameEvent {
  t: number;
  type: EventType;
  name: string; // nombre original del proveedor
  origin: string;
  top: boolean; // recibido en la página de Betsson (true) o dentro de un iframe (false)
  bet?: number;
  balanceBefore?: number;
  win?: number;
  balanceAfter?: number;
  amount?: number;
  currency?: string;
  data: unknown;
}

export interface RawMessage {
  t: number;
  origin: string;
  top: boolean;
  data: unknown;
}

export interface ProviderAdapter {
  name: string;
  translate(msg: RawMessage): GameEvent | null;
}

// ---------------------------------------------------------------------------
// Búsqueda tolerante de campos: el formato exacto del sobre del mensaje aún no está fijado
// (⚠️ ver docs del tester), así que se busca el nombre y los valores en cualquier nivel.

function asObject(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  if (typeof data === 'string') {
    try {
      const o = JSON.parse(data);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function findKey(obj: unknown, key: string, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  const o = obj as Record<string, unknown>;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

const NAME_KEYS = ['event', 'name', 'eventName', 'type', 'action', 'msgId', 'method'];

function eventName(o: Record<string, unknown> | null, raw: unknown): string | null {
  if (typeof raw === 'string' && /^[a-zA-Z/]+$/.test(raw)) return raw;
  if (!o) return null;
  for (const k of NAME_KEYS) if (typeof o[k] === 'string') return o[k] as string;
  return null;
}

// ---------------------------------------------------------------------------
// Pragmatic Play. Catálogo y trampas verificados por el equipo en betsson.es (SOLUCION.md §2).

const PRAGMATIC_MAP: Record<string, EventType> = {
  gameLoadingEnded: 'READY',
  gameRoundStarted: 'ROUND_STARTED',
  spinStarted: 'SPIN_STARTED',
  spinEnded: 'SPIN_ENDED',
  gameRoundEnded: 'GAME_ROUND_ENDED',
  resultShown: 'ROUND_ENDED', // el premio terminó de mostrarse: momento "liquidado"
  betChanged: 'BET_CHANGED',
  updateBalance: 'BALANCE',
};

export const pragmaticAdapter: ProviderAdapter = {
  name: 'pragmatic',
  translate(msg) {
    const o = asObject(msg.data);
    const name = eventName(o, msg.data);
    if (!name) return null;
    const type = PRAGMATIC_MAP[name] ?? 'OTHER';
    const ev: GameEvent = { t: msg.t, type, name, origin: msg.origin, top: msg.top, data: o ?? msg.data };
    const n = (k: string) => toNumber(findKey(o, k));

    switch (type) {
      // Trampa: en los eventos de inicio, winAmount y balanceAfter son de la ronda anterior.
      case 'ROUND_STARTED':
      case 'SPIN_STARTED':
        ev.bet = n('betAmount');
        ev.balanceBefore = n('balanceBefore');
        break;
      case 'SPIN_ENDED':
      case 'GAME_ROUND_ENDED':
      case 'ROUND_ENDED':
        ev.win = n('winAmount');
        ev.balanceAfter = n('balanceAfter');
        break;
      case 'BET_CHANGED':
        ev.bet = n('bet');
        break;
      case 'BALANCE': {
        // Trampa: updateBalance viene en céntimos.
        const total = findKey(o, 'total');
        const cents = toNumber(findKey(total ?? o, 'amount'));
        ev.amount = cents === undefined ? undefined : cents / 100;
        const cur = findKey(o, 'currency');
        ev.currency = typeof cur === 'string' ? cur : undefined;
        break;
      }
    }
    return ev;
  },
};

// ---------------------------------------------------------------------------

type Waiter = { type: EventType; after: number; resolve: (e: GameEvent) => void };

export class GameEventBus {
  readonly events: GameEvent[] = [];
  private waiters: Waiter[] = [];

  constructor(
    private adapter: ProviderAdapter,
    private timeline: Timeline,
  ) {}

  /** Instala el listener en todas las páginas y frames del contexto. Llamar antes de navegar. */
  async attach(context: BrowserContext) {
    await context.exposeBinding('__qaPostMessage', (_source, msg: RawMessage) => this.ingest(msg));
    await context.addInitScript(() => {
      window.addEventListener(
        'message',
        (e) => {
          let data: unknown = e.data;
          try {
            data = typeof data === 'string' ? data : JSON.parse(JSON.stringify(data));
          } catch {
            data = String(data);
          }
          // @ts-expect-error binding inyectado por Playwright
          window.__qaPostMessage?.({ t: Date.now(), origin: e.origin, top: window === window.top, data });
        },
        true,
      );
    });
  }

  ingest(msg: RawMessage) {
    const ev = this.adapter.translate(msg);
    if (!ev) {
      this.timeline.add('raw-message', { origin: msg.origin, top: msg.top, data: msg.data }, msg.t);
      return;
    }
    this.events.push(ev);
    this.timeline.add(
      'event',
      { type: ev.type, name: ev.name, origin: ev.origin, top: ev.top, bet: ev.bet, balanceBefore: ev.balanceBefore,
        win: ev.win, balanceAfter: ev.balanceAfter, amount: ev.amount, currency: ev.currency, data: ev.data },
      ev.t,
    );
    if (ev.type !== 'OTHER') console.log(`  ⇠ evento ${ev.name}${fmt(ev)}`);
    this.waiters = this.waiters.filter((w) => {
      if (w.type === ev.type && ev.t >= w.after) {
        w.resolve(ev);
        return false;
      }
      return true;
    });
  }

  /** El primer evento de ese tipo llegado desde `after` (incluido uno ya recibido). */
  waitFor(type: EventType, opts: { after?: number; timeoutMs: number }): Promise<GameEvent | null> {
    const after = opts.after ?? 0;
    const seen = this.events.find((e) => e.type === type && e.t >= after);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const w: Waiter = { type, after, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, opts.timeoutMs);
    });
  }

  last(type: EventType, before = Infinity): GameEvent | undefined {
    return [...this.events].reverse().find((e) => e.type === type && e.t <= before);
  }
}

function fmt(e: GameEvent): string {
  const parts = Object.entries({ bet: e.bet, antes: e.balanceBefore, premio: e.win, después: e.balanceAfter, saldo: e.amount })
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  if (e.currency) parts.push(e.currency);
  return parts.length ? ` (${parts.join(', ')})` : '';
}
