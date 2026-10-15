/**
 * F7 del escenario 2: ¿el intento de tirada se RECHAZÓ? Función pura sobre lo que ya registran
 * GameEventBus (eventos), GameServerTap (red) y la comparación de capturas (pantalla).
 *
 * Además del veredicto, devuelve el BORRADOR DEL CONTRATO de rechazo: qué evento, qué respuesta de red
 * y qué aviso aparecieron y cuándo. Con la primera ejecución real sirve para confirmar
 * config/rejection-hypotheses.json y fijar qué dispara REJECTED.
 */
import type { ActionRecord, SpinRecord, StandardEvent, VisualReading, WalletReading } from '../contracts/schemas';

export type RejectionOutcome = 'charged' | 'rejected' | 'rejected-unconfirmed' | 'no-reaction';

export interface RejectionVerdict {
  outcome: RejectionOutcome;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  /** Señales independientes de rechazo (la pantalla aquí es "cambió"; el texto lo lee F8). */
  signals: { event: boolean; network: boolean; screen: boolean };
  contract: RejectionContractDraft;
}

export interface RejectionContractDraft {
  status: 'draft';
  actionT: number;
  roundStartedArrived: boolean;
  event: { name: string; afterMs: number; reason?: string; sample: unknown } | null;
  unknownEventsAfterAction: { name: string; afterMs: number; sample: unknown }[];
  network: { requests: { action: string; status: number; afterMs: number }[]; doSpin: { afterMs: number; status: number; error?: string } | null };
  screen: { changedAfterMs: number | null; message?: { text: string; language?: string; confidence: number; crop: string } };
  balances?: { gameBefore?: number; walletBefore?: number; walletAfter?: number };
  proposedStandardEvent: { type: 'REJECTED'; from: string } | null;
}

export interface RejectionInput {
  action: ActionRecord;
  /** Eventos estándar desde la acción. */
  events: StandardEvent[];
  /** doSpin desde la acción. */
  spins: SpinRecord[];
  /** Todas las llamadas a gameService desde la acción. */
  calls: { t: number; action: string; status: number }[];
  /** Hora en la que la pantalla del juego cambió tras la acción (aviso), si cambió. */
  screenChangedAt?: number;
}

export function detectRejection(inp: RejectionInput): RejectionVerdict {
  const t0 = inp.action.t;
  const after = (t: number) => t - t0;
  const paidStart = inp.events.find((e) => e.type === 'ROUND_STARTED' && (e.data.bet ?? 0) > 0);
  const paidSpin = inp.spins.find((s) => !s.error);
  const rejectedEvents = inp.events.filter((e) => e.type === 'REJECTED');
  const unknown = inp.events.filter((e) => e.type === 'UNKNOWN');
  const errorSpins = inp.spins.filter((s) => s.error);

  const signals = { event: rejectedEvents.length > 0, network: errorSpins.length > 0, screen: inp.screenChangedAt !== undefined };
  const positive = (Object.keys(signals) as (keyof typeof signals)[]).filter((k) => signals[k]);
  const reasons: string[] = [];
  let outcome: RejectionOutcome;

  if (paidStart || paidSpin) {
    outcome = 'charged';
    reasons.push(paidSpin ? `la tirada se cobró: doSpin sin error (rid ${paidSpin.rid ?? '—'})` : `llegó ROUND_STARTED con apuesta ${paidStart!.data.bet}`);
  } else if (positive.length) {
    outcome = 'rejected';
    if (signals.event) reasons.push(`evento de rechazo ${rejectedEvents[0].name} (${rejectedEvents[0].data.reason ?? 'hipótesis'})`);
    if (signals.network) reasons.push(`doSpin con error: ${errorSpins[0].error}`);
    if (signals.screen) reasons.push(`la pantalla cambió a los ${after(inp.screenChangedAt!)} ms (aviso)`);
  } else if (unknown.length) {
    outcome = 'rejected-unconfirmed';
    reasons.push(`sin cobro y con eventos no reconocidos (${[...new Set(unknown.map((e) => e.name))].join(', ')}): revisar el contrato`);
  } else {
    outcome = 'no-reaction';
    reasons.push('sin cobro y sin ninguna reacción: puede que la acción no llegara al juego');
  }
  const confidence = outcome === 'charged' ? 'high' : outcome === 'rejected' ? (positive.length >= 2 ? 'high' : 'medium') : 'low';

  const firstSpin = inp.spins[0];
  const contract: RejectionContractDraft = {
    status: 'draft',
    actionT: t0,
    roundStartedArrived: inp.events.some((e) => e.type === 'ROUND_STARTED'),
    event: rejectedEvents[0] ? { name: rejectedEvents[0].name, afterMs: after(rejectedEvents[0].t), reason: rejectedEvents[0].data.reason, sample: rejectedEvents[0].raw } : null,
    unknownEventsAfterAction: unknown.slice(0, 10).map((e) => ({ name: e.name, afterMs: after(e.t), sample: e.raw })),
    network: {
      requests: inp.calls.map((c) => ({ action: c.action, status: c.status, afterMs: after(c.t) })),
      doSpin: firstSpin ? { afterMs: after(firstSpin.t), status: firstSpin.status, error: firstSpin.error } : null,
    },
    screen: { changedAfterMs: inp.screenChangedAt !== undefined ? after(inp.screenChangedAt) : null },
    proposedStandardEvent: rejectedEvents[0]
      ? { type: 'REJECTED', from: `evento ${rejectedEvents[0].name}` }
      : errorSpins[0]
        ? { type: 'REJECTED', from: 'respuesta de error a doSpin (red)' }
        : signals.screen
          ? { type: 'REJECTED', from: 'solo el aviso en pantalla: el proveedor no emite evento ni llama al servidor' }
          : null,
  };
  return { outcome, confidence, reasons, signals, contract };
}

/** Completa el borrador con lo que se sabe después: el texto del aviso (F8) y los saldos (F5, F9). */
export function completeContract(
  draft: RejectionContractDraft,
  extra: { message?: VisualReading; gameBefore?: number; walletBefore?: WalletReading; walletAfter?: WalletReading },
): RejectionContractDraft {
  const m = extra.message;
  return {
    ...draft,
    screen: {
      ...draft.screen,
      message: m ? { text: m.raw, language: m.language, confidence: m.confidence, crop: m.cropPath } : undefined,
    },
    balances: { gameBefore: extra.gameBefore, walletBefore: extra.walletBefore?.amount, walletAfter: extra.walletAfter?.amount },
  };
}
