/**
 * F10: une todas las lecturas en un GameRound (C9) con el origen de cada valor y comprueba las
 * invariantes de SOLUCION.md §14.3. Una invariante incumplida es un hallazgo (fallo del tester o real).
 */
import {
  GameRound, type ActionRecord, type Cents, type RunConfig, type Scenario, type SpinRecord, type StandardEvent,
  type VisualReading, type WalletReading,
} from '../contracts/schemas';
import type { RejectionVerdict } from '../scenario2/RejectionDetector';

/** C16 */
export interface InitialState {
  betssonBefore?: WalletReading;
  gameBalance?: Cents;
  currentBet?: Cents;
  currency?: string;
  capturedAt: number;
  idleCapture?: string;
}

/** C17 */
export interface RoundTrace {
  action: ActionRecord;
  events: StandardEvent[];
  spins: SpinRecord[];
  outcome: 'settled' | 'rejected' | 'timeout';
  capture?: { path: string; t: number; triggerEvent: string };
  /** Escenario 2: veredicto del detector de rechazo y borrador del contrato. */
  rejection?: RejectionVerdict;
}

export interface RoundInputs {
  cfg: RunConfig;
  scenario: Scenario;
  initial?: InitialState;
  trace?: RoundTrace;
  visual: VisualReading[];
  betssonAfter?: WalletReading;
}

const SYMBOL_TO_CODE: Record<string, string> = { '€': 'EUR', 'S/': 'PEN' };

export function buildGameRound(inp: RoundInputs): GameRound {
  const ev = (type: StandardEvent['type']) => inp.trace?.events.filter((e) => e.type === type) ?? [];
  const started = ev('ROUND_STARTED')[0];
  const spinEnded = ev('SPIN_ENDED').at(-1);
  const ended = ev('ROUND_ENDED').at(-1);
  const spin = inp.trace?.spins[0];
  const vis = (f: VisualReading['field']) => inp.visual.find((v) => v.field === f && v.value !== null);
  const visRid = vis('rid');
  const visBet = vis('bet');
  const visMsg = inp.visual.find((v) => v.field === 'message');
  const lastBalanceAfterAction = inp.trace ? ev('BALANCE').at(-1) : undefined;
  const s2 = inp.scenario === 'insufficient-balance';

  const round: GameRound = {
    rid: { network: spin?.rid, screen: typeof visRid?.value === 'string' ? visRid.value : undefined },
    bet: {
      event: s2 ? inp.initial?.currentBet : started?.data.bet,
      network: spin?.bet,
      screen: typeof visBet?.value === 'number' ? visBet.value : undefined,
    },
    win: { event: ended?.data.win ?? spinEnded?.data.win, network: spin?.win },
    balanceBefore: { event: s2 ? inp.initial?.gameBalance : started?.data.balanceBefore ?? inp.initial?.gameBalance },
    balanceAfter: {
      event: s2 ? lastBalanceAfterAction?.data.amount ?? inp.initial?.gameBalance : ended?.data.balanceAfter ?? spinEnded?.data.balanceAfter,
      network: spin ? spin.collectBalance ?? (spin.needsCollect ? undefined : spin.balanceAfterSpin) : undefined,
    },
    betsson: { before: inp.initial?.betssonBefore, after: inp.betssonAfter },
    currency: {
      event: inp.initial?.currency,
      wallet: inp.initial?.betssonBefore?.currency,
      screen: visBet?.currencySymbol ? SYMBOL_TO_CODE[visBet.currencySymbol] : undefined,
    },
    message: visMsg?.value ? { text: String(visMsg.value), language: visMsg.language } : undefined,
    startedAt: inp.trace?.action.t,
    endedAt: ended?.t,
    findings: [],
  };
  round.findings = invariants(round, inp);
  return GameRound.parse(round);
}

function invariants(r: GameRound, inp: RoundInputs): string[] {
  const f: string[] = [];
  const cur = inp.cfg.currency;
  const amounts = [r.bet, r.win, r.balanceBefore, r.balanceAfter].flatMap((o) => Object.values(o)).filter((v): v is number => v !== undefined);
  if (amounts.some((v) => !Number.isInteger(v) || v < 0)) f.push('1 · hay importes que no son céntimos enteros no negativos');
  const curs = Object.values(r.currency).filter(Boolean);
  if (curs.some((c) => c !== cur)) f.push(`2 · moneda distinta de ${cur}: ${JSON.stringify(r.currency)}`);
  if (inp.trace) {
    const starts = inp.trace.events.filter((e) => e.type === 'ROUND_STARTED').length;
    const spins = inp.trace.spins.length;
    if (inp.scenario === 'completed-spin' && (starts !== 1 || spins !== 1)) f.push(`3 · se esperaba una sola ronda: ${starts} ROUND_STARTED y ${spins} doSpin`);
    if (inp.scenario === 'insufficient-balance' && (starts > 0 || inp.trace.spins.some((s) => !s.error))) f.push(`3 · se esperaba ninguna ronda cobrada: ${starts} ROUND_STARTED`);
    const t = (type: string) => inp.trace!.events.find((e) => e.type === type)?.t;
    const order = [inp.trace.action.t, t('ROUND_STARTED'), inp.trace.spins[0]?.t, t('SPIN_ENDED'), t('ROUND_ENDED'), inp.trace.capture?.t, inp.betssonAfter?.t].filter(
      (x): x is number => x !== undefined,
    );
    if (inp.scenario === 'completed-spin' && order.some((x, i) => i > 0 && x < order[i - 1] - 50)) f.push('4 · el orden temporal no es acción < inicio < doSpin < fin < captura < B1');
  }
  if (r.rid.network && r.rid.screen && !ridMatches(r.rid.screen, r.rid.network)) f.push(`5 · rid de red ${r.rid.network} ≠ pantalla ${r.rid.screen}`);
  const bets = Object.values(r.bet).filter((v): v is number => v !== undefined);
  if (new Set(bets).size > 1) f.push(`6 · la apuesta no coincide entre fuentes: ${JSON.stringify(r.bet)}`);
  const { event: b0, network: _n } = r.balanceBefore;
  void _n;
  if (inp.scenario === 'completed-spin' && b0 !== undefined && r.bet.event !== undefined && r.win.event !== undefined && r.balanceAfter.event !== undefined) {
    if (b0 - r.bet.event + r.win.event !== r.balanceAfter.event) f.push('7 · saldo del juego: antes − apuesta + premio ≠ después');
  }
  const B0 = r.betsson.before?.amount;
  const B1 = r.betsson.after?.amount;
  if (B0 !== undefined && B1 !== undefined) {
    const expected = inp.scenario === 'completed-spin' && r.bet.event !== undefined && r.win.event !== undefined ? B0 - r.bet.event + r.win.event : B0;
    if (B1 !== expected) f.push(`8 · cartera: B1 ${B1} ≠ ${expected}`);
  }
  return f;
}

/** El rid leído contiene el de la red, o coinciden los últimos 6 dígitos (si el juego lo recorta). */
export function ridMatches(screen: string, network: string): boolean {
  return screen.includes(network) || (network.length >= 6 && screen.length >= 6 && screen.slice(-6) === network.slice(-6));
}
