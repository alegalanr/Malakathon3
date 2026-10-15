/**
 * Casos raros (persona 2): decisiones puras que usa runScenario y que se prueban sin navegador.
 * Ya cubiertos en otras partes y no repetidos aquí:
 *   - premio = apuesta → F9 espera una lectura POSTERIOR de la cartera, no un cambio de saldo;
 *   - apuesta > máximo → F5 no gira y S1-BET-USED da FAIL;
 *   - ronda duplicada / autoplay → F7 exige un solo ROUND_STARTED; falta de doCollect → F7 lo espera;
 *   - redirección a otro mercado → BetssonSite.session().
 */
import type { Cents, Scenario, SpinRecord, StandardEvent } from '../contracts/schemas';

/**
 * Precondición de saldo ANTES de girar (dinero real):
 * - escenario 2: si la cuenta "sin saldo" tiene saldo para la apuesta, girar gastaría dinero → no se gira;
 * - escenario 1: si no hay saldo para la apuesta, la tirada se rechazaría → no se gira.
 */
export function scenarioPrecondition(p: { scenario: Scenario; gameBalance?: Cents; walletBalance?: Cents; bet?: Cents }): { ok: boolean; reason: string } {
  const { scenario, gameBalance, walletBalance, bet } = p;
  if (bet === undefined) return { ok: false, reason: 'apuesta desconocida: no se puede comprobar la precondición de saldo' };
  const known = [gameBalance, walletBalance].filter((v): v is number => v !== undefined);
  if (!known.length) return { ok: false, reason: 'saldo desconocido: no se puede comprobar la precondición de saldo' };
  if (scenario === 'insufficient-balance') {
    const max = Math.max(...known);
    return max >= bet
      ? { ok: false, reason: `precondición del escenario 2 incumplida: saldo ${max} ≥ apuesta ${bet} céntimos; la tirada se cobraría, así que no se gira` }
      : { ok: true, reason: `saldo ${max} < apuesta ${bet} céntimos: la cuenta está preparada para el rechazo` };
  }
  const bal = gameBalance ?? walletBalance!;
  return bal < bet
    ? { ok: false, reason: `precondición del escenario 1 incumplida: saldo ${bal} < apuesta ${bet} céntimos; la tirada se rechazaría` }
    : { ok: true, reason: `saldo ${bal} ≥ apuesta ${bet} céntimos` };
}

/** Acciones de gameService que solo aparecen en bonus, free spins o juegos de riesgo (no en una tirada normal). */
export const BONUS_ACTIONS = /^do(Bonus|FSOption|MysteryScatter|CollectBonus|Gamble|Respin)/i;

/**
 * ¿La ronda se ha convertido en free spins o bonus (ronda extendida)? Señales:
 * más de un doSpin, `na` distinto de s/c, acciones de bonus en la red o varios spinStarted.
 */
export function extendedRoundSignals(p: { spins: SpinRecord[]; calls: { action: string }[]; events: StandardEvent[] }): { extended: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (p.spins.length > 1) reasons.push(`${p.spins.length} doSpin en la misma ronda`);
  const odd = [...new Set(p.spins.map((s) => s.nextAction).filter((na): na is string => !!na && na !== 's' && na !== 'c'))];
  if (odd.length) reasons.push(`siguiente acción del servidor na=${odd.join(', ')}`);
  const bonus = [...new Set(p.calls.map((c) => c.action).filter((a) => BONUS_ACTIONS.test(a)))];
  if (bonus.length) reasons.push(`acciones de bonus en la red: ${bonus.join(', ')}`);
  const spinStarts = p.events.filter((e) => e.name === 'spinStarted').length;
  if (spinStarts > 1) reasons.push(`${spinStarts} spinStarted`);
  return { extended: reasons.length > 0, reasons };
}
