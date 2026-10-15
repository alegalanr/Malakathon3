/**
 * Comprobaciones del escenario 1 (ids de docs/reto.md). Cada una guarda esperado, obtenido y fuentes.
 * Regla del saldo: saldo después = saldo antes − apuesta + premio.
 */
import { eur, sameAmount } from '../money';
import type { GameEvent } from '../game/events';
import type { ServerCall } from '../game/server-tap';
import type { WalletReading } from '../site/wallet';

export type Status = 'pass' | 'fail' | 'skip';

export interface Check {
  id: string;
  title: string;
  status: Status;
  expected: string;
  actual: string;
  sources: string[];
}

/** Todo lo observado en una ronda, con su fuente. */
export interface RoundObservation {
  currency: string; // la del mercado
  maxBet: number;
  actionAt: number; // cuándo pulsamos
  walletBefore?: WalletReading;
  walletAfter?: WalletReading;
  gameBalanceBefore?: GameEvent; // último BALANCE antes de la acción
  lastBetChanged?: GameEvent;
  started?: GameEvent; // ROUND_STARTED
  spinEnded?: GameEvent;
  ended?: GameEvent; // ROUND_ENDED (resultShown)
  doSpin?: ServerCall;
  doCollect?: ServerCall;
}

const c = (id: string, title: string, ok: boolean | null, expected: string, actual: string, sources: string[]): Check => ({
  id,
  title,
  status: ok === null ? 'skip' : ok ? 'pass' : 'fail',
  expected,
  actual,
  sources,
});

export function evaluate(o: RoundObservation): Check[] {
  const bet = o.started?.bet;
  const win = o.ended?.win ?? o.spinEnded?.win;
  const before = o.started?.balanceBefore;
  const after = o.ended?.balanceAfter ?? o.spinEnded?.balanceAfter;
  const serverFinal = o.doCollect?.balance ?? o.doSpin?.balance;
  const checks: Check[] = [];

  // P1. Real Play: el saldo del juego es el de la cartera de Betsson (en demo sería otro).
  const gameBal = o.gameBalanceBefore?.amount ?? before;
  checks.push(
    c('P1', 'Real Play: saldo del juego = cartera Betsson antes de girar',
      gameBal === undefined || o.walletBefore?.total === undefined ? null : sameAmount(gameBal, o.walletBefore.total),
      `cartera ${eur(o.walletBefore?.total)}`, `juego ${eur(gameBal)}`, ['evento updateBalance/gameRoundStarted', 'API cartera']),
  );

  // S1.1 La tirada empezó (por nuestra acción) y terminó.
  const startedByUs = !!o.started && o.started.t >= o.actionAt;
  checks.push(
    c('S1.1', 'La tirada empezó y terminó',
      startedByUs && !!o.spinEnded && !!o.ended,
      'gameRoundStarted → spinEnded → resultShown',
      [o.started ? 'gameRoundStarted' : 'sin gameRoundStarted', o.spinEnded ? 'spinEnded' : 'sin spinEnded', o.ended ? 'resultShown' : 'sin resultShown'].join(' → '),
      ['eventos', o.doSpin ? 'red doSpin' : 'sin doSpin en la red']),
  );

  // S1.2 La apuesta mostrada es la usada: evento de inicio = c×l de doSpin (= último betChanged si lo hubo).
  const betSources = [o.doSpin?.bet, o.lastBetChanged?.bet].filter((v): v is number => v !== undefined);
  checks.push(
    c('S1.2', 'La apuesta mostrada es la usada',
      bet === undefined ? false : betSources.length === 0 ? null : betSources.every((v) => sameAmount(v, bet)) && bet <= o.maxBet,
      `apuesta ≤ ${eur(o.maxBet)} e igual en todas las fuentes`,
      `inicio ${eur(bet)} · doSpin ${eur(o.doSpin?.bet)} · betChanged ${eur(o.lastBetChanged?.bet)}`,
      ['evento gameRoundStarted', 'red doSpin (c×l)', 'evento betChanged']),
  );

  // S1.3 Moneda del mercado.
  const curs = [o.walletBefore?.currency, o.gameBalanceBefore?.currency].filter(Boolean) as string[];
  checks.push(
    c('S1.3', 'La moneda es la del mercado',
      curs.length === 0 ? null : curs.every((x) => x === o.currency),
      o.currency, `cartera ${o.walletBefore?.currency ?? '¿?'} · juego ${o.gameBalanceBefore?.currency ?? '¿?'}`,
      ['API cartera', 'evento updateBalance']),
  );

  // S1.4 Saldo del juego coherente con la tirada, y con lo que dice el servidor.
  const expectedGame = before !== undefined && bet !== undefined && win !== undefined ? before - bet + win : undefined;
  checks.push(
    c('S1.4', 'El saldo del juego cuadra con la tirada',
      expectedGame === undefined || after === undefined ? false : sameAmount(after, expectedGame) && (serverFinal === undefined || sameAmount(after, serverFinal)),
      `${eur(before)} − ${eur(bet)} + ${eur(win)} = ${eur(expectedGame)}`,
      `juego ${eur(after)} · servidor ${eur(serverFinal)}`,
      ['eventos inicio/fin', o.doCollect ? 'red doCollect' : 'red doSpin']),
  );

  // S1.5 Saldo de Betsson antes y después cuadra.
  const b0 = o.walletBefore?.total;
  const b1 = o.walletAfter?.total;
  const expectedB1 = b0 !== undefined && bet !== undefined && win !== undefined ? b0 - bet + win : undefined;
  checks.push(
    c('S1.5', 'El saldo de Betsson cuadra',
      expectedB1 === undefined || b1 === undefined ? false : sameAmount(b1, expectedB1),
      `${eur(b0)} − ${eur(bet)} + ${eur(win)} = ${eur(expectedB1)}`, `cartera después ${eur(b1)}`,
      ['API cartera antes', 'API cartera después', 'eventos (apuesta y premio)']),
  );

  // R1 Identificador de ronda. ⚠️ Falta comprobar en pantalla que se ve el mismo #rid (de momento, solo captura).
  checks.push(
    c('R1', 'Ronda identificada por el servidor (rid)', o.doSpin?.rid ? true : null,
      'rid en la respuesta de doSpin (y visible abajo a la izquierda)', o.doSpin?.rid ? `rid ${o.doSpin.rid}` : 'sin rid',
      ['red doSpin', 'captura en resultShown']),
  );

  return checks;
}
