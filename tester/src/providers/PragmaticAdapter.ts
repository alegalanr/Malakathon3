/**
 * Pragmatic Play → eventos estándar (SOLUCION.md §2.1, §2.5, §3.3).
 * Trampas: en los eventos de inicio, winAmount/balanceAfter son de la ronda anterior (no se copian);
 * updateBalance viene en céntimos y el resto en euros.
 */
import type { EventType, StandardEvent } from '../contracts/schemas';
import { centsValue, eurosToCents } from '../domain/Money';
import { asObject, findKey, type ProviderAdapter, type RawMessage } from './ProviderAdapter';

const MAP: Record<string, EventType> = {
  gameLoadingEnded: 'READY',
  gameRoundStarted: 'ROUND_STARTED',
  spinEnded: 'SPIN_ENDED',
  resultShown: 'ROUND_ENDED', // momento "liquidado": el premio terminó de mostrarse
  betChanged: 'BET_CHANGED',
  updateBalance: 'BALANCE',
};

/** Otros nombres conocidos del catálogo (§2.1): se guardan como UNKNOWN con su nombre. */
export const PRAGMATIC_KNOWN = new Set([
  ...Object.keys(MAP),
  'gameLoadingStarted', 'betInfo', 'betMultiplier', 'spinStarted', 'balanceChanged', 'gameRoundEnded', 'visualBalanceUpdate',
]);

const NAME_KEYS = ['event', 'name', 'eventName', 'type', 'action', 'msgId', 'method', 'id'];

function eventName(o: Record<string, unknown> | null, raw: unknown): string | null {
  if (typeof raw === 'string' && PRAGMATIC_KNOWN.has(raw)) return raw;
  if (!o) return null;
  for (const k of NAME_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v.length < 80) return v;
  }
  return null;
}

export const PragmaticAdapter: ProviderAdapter = {
  name: 'pragmatic',
  translate(msg: RawMessage, gameOrigin?: string): StandardEvent | null {
    const o = asObject(msg.data);
    const name = eventName(o, msg.data);
    const senderRaw = findKey(o, 'sender');
    const sender = typeof senderRaw === 'string' ? senderRaw : undefined;
    const fromGame = (gameOrigin && msg.origin === gameOrigin) || (!!sender && /^vs/.test(sender)) || (!!name && PRAGMATIC_KNOWN.has(name));
    if (!name || !fromGame) return null;

    const type: EventType = MAP[name] ?? 'UNKNOWN';
    const eur = (k: string) => eurosToCents(findKey(o, k));
    const data: StandardEvent['data'] = {};
    switch (type) {
      case 'ROUND_STARTED':
        data.bet = eur('betAmount');
        data.balanceBefore = eur('balanceBefore');
        break;
      case 'SPIN_ENDED':
      case 'ROUND_ENDED':
        data.win = eur('winAmount');
        data.balanceAfter = eur('balanceAfter');
        break;
      case 'BET_CHANGED':
        data.bet = eur('bet');
        break;
      case 'BALANCE': {
        const total = findKey(o, 'total');
        data.amount = centsValue(findKey(total ?? o, 'amount'));
        const cur = findKey(total ?? o, 'currency') ?? findKey(o, 'currency');
        if (typeof cur === 'string') data.currency = cur;
        break;
      }
    }
    return { type, t: msg.t, name, data, raw: o ?? msg.data, sender, origin: msg.origin };
  },
};
