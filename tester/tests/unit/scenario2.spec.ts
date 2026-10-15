/**
 * Escenario 2 y casos raros (persona 2): detector del rechazo, REJECTED en el adaptador,
 * precondición de saldo, ronda extendida, idioma del aviso y regla S2-REJECTED.
 */
import { expect, test } from '@playwright/test';
import { Check, type ActionRecord, type SpinRecord, type StandardEvent, type VisualReading } from '../../src/contracts/schemas';
import { loadRunConfig } from '../../src/config/RunConfig';
import { buildGameRound, type InitialState, type RoundTrace } from '../../src/domain/GameRound';
import { extendedRoundSignals, scenarioPrecondition } from '../../src/edge-cases/EdgeCases';
import { PragmaticAdapter } from '../../src/providers/PragmaticAdapter';
import { completeContract, detectRejection } from '../../src/scenario2/RejectionDetector';
import { errorKeyIn, rejectionReason } from '../../src/scenario2/RejectionHypotheses';
import { evaluateChecks } from '../../src/validation/rules';
import { detectLanguage } from '../../src/vision/ScreenWitness';

const cfg = loadRunConfig('es', 'insufficient-balance', 'simulated');
const GAME = 'https://demogamesfree.pragmaticplay.net';
const action: ActionRecord = { action: 'spin', method: 'key', key: 'Space', t: 1000 };
const ev = (type: StandardEvent['type'], name: string, data: StandardEvent['data'], t: number, raw: unknown = {}): StandardEvent => ({ type, name, data, t, raw, origin: GAME });
const spin = (o: Partial<SpinRecord>): SpinRecord => ({ needsCollect: false, status: 200, t: 1200, ...o });

// ------------------------------------------------------------------ detector del rechazo
test.describe('detector del rechazo', () => {
  test('evento + aviso, sin cobro → rejected con confianza alta y contrato', () => {
    const v = detectRejection({ action, events: [ev('REJECTED', 'noMoney', { reason: 'nombre' }, 1300)], spins: [], calls: [], screenChangedAt: 1800 });
    expect(v.outcome).toBe('rejected');
    expect(v.confidence).toBe('high');
    expect(v.signals).toEqual({ event: true, network: false, screen: true });
    expect(v.contract.event?.name).toBe('noMoney');
    expect(v.contract.event?.afterMs).toBe(300);
    expect(v.contract.screen.changedAfterMs).toBe(800);
    expect(v.contract.proposedStandardEvent?.from).toContain('noMoney');
  });

  test('solo error de red en doSpin → rejected con confianza media', () => {
    const v = detectRejection({ action, events: [], spins: [spin({ error: 'frozen=1' })], calls: [{ t: 1200, action: 'doSpin', status: 200 }] });
    expect(v.outcome).toBe('rejected');
    expect(v.confidence).toBe('medium');
    expect(v.contract.network.doSpin?.error).toBe('frozen=1');
    expect(v.contract.proposedStandardEvent?.from).toContain('red');
  });

  test('solo aviso en pantalla → rejected; el contrato dice que el proveedor no avisa', () => {
    const v = detectRejection({ action, events: [], spins: [], calls: [], screenChangedAt: 1500 });
    expect(v.outcome).toBe('rejected');
    expect(v.contract.proposedStandardEvent?.from).toContain('solo el aviso');
  });

  test('doSpin cobrado o ROUND_STARTED con apuesta → charged', () => {
    expect(detectRejection({ action, events: [], spins: [spin({ rid: '1', balanceAfterSpin: 0 })], calls: [], screenChangedAt: 1500 }).outcome).toBe('charged');
    expect(detectRejection({ action, events: [ev('ROUND_STARTED', 'gameRoundStarted', { bet: 20 }, 1100)], spins: [], calls: [] }).outcome).toBe('charged');
  });

  test('solo eventos desconocidos → rejected-unconfirmed; nada → no-reaction', () => {
    expect(detectRejection({ action, events: [ev('UNKNOWN', 'showPopup', {}, 1400)], spins: [], calls: [] }).outcome).toBe('rejected-unconfirmed');
    expect(detectRejection({ action, events: [], spins: [], calls: [] }).outcome).toBe('no-reaction');
  });

  test('el contrato se completa con el aviso (F8) y los saldos (F5, F9)', () => {
    const v = detectRejection({ action, events: [], spins: [], calls: [], screenChangedAt: 1500 });
    const msg: VisualReading = { field: 'message', raw: 'Saldo insuficiente', value: 'saldo insuficiente', confidence: 0.9, roi: null, cropPath: 'evidence/crop-message.png', attempts: 1, language: 'es' };
    const c = completeContract(v.contract, { message: msg, gameBefore: 10, walletBefore: { amount: 10, currency: 'EUR', t: 0, source: 'api' }, walletAfter: { amount: 10, currency: 'EUR', t: 9, source: 'api' } });
    expect(c.screen.message).toEqual({ text: 'Saldo insuficiente', language: 'es', confidence: 0.9, crop: 'evidence/crop-message.png' });
    expect(c.balances).toEqual({ gameBefore: 10, walletBefore: 10, walletAfter: 10 });
  });
});

// ------------------------------------------------------------------ hipótesis: adaptador y red
test.describe('hipótesis del rechazo', () => {
  test('el adaptador emite REJECTED para un mensaje de saldo insuficiente del juego', () => {
    const e = PragmaticAdapter.translate({ t: 5, origin: GAME, data: { event: 'noMoney', sender: 'vs20bblup_cv116' } }, GAME)!;
    expect(e.type).toBe('REJECTED');
    expect(e.data.reason).toContain('noMoney');
    const byPayload = PragmaticAdapter.translate({ t: 5, origin: GAME, data: { event: 'showMessage', params: { text: 'Insufficient balance' } } }, GAME)!;
    expect(byPayload.type).toBe('REJECTED');
  });

  test('los eventos del catálogo nunca pasan a REJECTED', () => {
    const e = PragmaticAdapter.translate({ t: 5, origin: GAME, data: { event: 'updateBalance', params: { total: { amount: 0, currency: 'EUR' } } } }, GAME)!;
    expect(e.type).toBe('BALANCE');
    expect(rejectionReason('betInfo', { params: {} })).toBeNull();
  });

  test('claves de error en la respuesta de gameService', () => {
    expect(errorKeyIn(new URLSearchParams('balance=0.10&frozen=1'))).toBe('frozen=1');
    expect(errorKeyIn(new URLSearchParams('balance=58.50&rid=1&na=s'))).toBeNull();
  });
});

// ------------------------------------------------------------------ casos raros
test.describe('casos raros', () => {
  test('escenario 2: si la cuenta tiene saldo para la apuesta, no se gira', () => {
    expect(scenarioPrecondition({ scenario: 'insufficient-balance', gameBalance: 10, walletBalance: 10, bet: 20 }).ok).toBe(true);
    expect(scenarioPrecondition({ scenario: 'insufficient-balance', gameBalance: 500, walletBalance: 500, bet: 20 }).ok).toBe(false);
    // Si el juego y la cartera discrepan, manda el mayor: mejor no girar que gastar
    expect(scenarioPrecondition({ scenario: 'insufficient-balance', gameBalance: 10, walletBalance: 500, bet: 20 }).ok).toBe(false);
    expect(scenarioPrecondition({ scenario: 'insufficient-balance', bet: 20 }).ok).toBe(false);
  });

  test('escenario 1: sin saldo para la apuesta, no se gira', () => {
    expect(scenarioPrecondition({ scenario: 'completed-spin', gameBalance: 6250, walletBalance: 6250, bet: 400 }).ok).toBe(true);
    expect(scenarioPrecondition({ scenario: 'completed-spin', gameBalance: 300, walletBalance: 300, bet: 400 }).ok).toBe(false);
  });

  test('ronda extendida (free spins o bonus)', () => {
    const normal = extendedRoundSignals({ spins: [spin({ nextAction: 's' })], calls: [{ action: 'doSpin' }], events: [ev('UNKNOWN', 'spinStarted', {}, 1)] });
    expect(normal.extended).toBe(false);
    const collect = extendedRoundSignals({ spins: [spin({ nextAction: 'c' })], calls: [{ action: 'doSpin' }, { action: 'doCollect' }], events: [] });
    expect(collect.extended).toBe(false);
    const fs = extendedRoundSignals({ spins: [spin({ nextAction: 's' }), spin({ nextAction: 's' })], calls: [{ action: 'doSpin' }, { action: 'doFSOption' }], events: [ev('UNKNOWN', 'spinStarted', {}, 1), ev('UNKNOWN', 'spinStarted', {}, 2)] });
    expect(fs.extended).toBe(true);
    expect(fs.reasons).toHaveLength(3);
    expect(extendedRoundSignals({ spins: [spin({ nextAction: 'b' })], calls: [], events: [] }).reasons[0]).toContain('na=b');
  });

  test('apuesta por encima del máximo → FAIL en S1-BET-USED', () => {
    const c1 = loadRunConfig('es', 'completed-spin', 'simulated');
    const bet = c1.maxBet + 100;
    const initial: InitialState = { betssonBefore: { amount: 10_000, currency: 'EUR', t: 0, source: 'api' }, gameBalance: 10_000, currentBet: bet, currency: 'EUR', capturedAt: 0 };
    const trace: RoundTrace = {
      action,
      events: [ev('ROUND_STARTED', 'gameRoundStarted', { bet, balanceBefore: 10_000 }, 1100), ev('SPIN_ENDED', 'spinEnded', { win: 0, balanceAfter: 10_000 - bet }, 2000), ev('ROUND_ENDED', 'resultShown', { win: 0, balanceAfter: 10_000 - bet }, 2500)],
      spins: [spin({ rid: '1', bet, balanceAfterSpin: 10_000 - bet, win: 0 })],
      outcome: 'settled',
    };
    const round = buildGameRound({ cfg: c1, scenario: 'completed-spin', initial, trace, visual: [] });
    const checks = evaluateChecks({ cfg: c1, scenario: 'completed-spin', round, initial, trace, visual: [], evidence: {} });
    const used = checks.find((c) => c.id === 'S1-BET-USED')!;
    expect(used.result).toBe('FAIL');
    expect(used.message).toContain('máxima');
  });
});

// ------------------------------------------------------------------ idioma del aviso
test.describe('idioma del aviso', () => {
  test('«Deposita» no es la palabra inglesa «deposit»', () => {
    expect(detectLanguage('Saldo insuficiente. Deposita para seguir jugando.', cfg).language).toBe('es');
  });

  test('variantes habituales del aviso en español', () => {
    expect(detectLanguage('No tienes saldo suficiente para esta apuesta', cfg).language).toBe('es');
    expect(detectLanguage('Tu saldo no es suficiente', cfg).language).toBe('es');
    expect(detectLanguage('FONDOS INSUFICIENTES', cfg).language).toBe('es');
  });

  test('aviso en inglés en betsson.es → en (FAIL de S2-MSG-LANG-VISIBLE)', () => {
    expect(detectLanguage('Insufficient funds. Please deposit.', cfg).language).toBe('en');
  });

  test('un texto que no es el aviso no tiene idioma de aviso', () => {
    expect(detectLanguage('Suficiente por hoy', cfg).language).toBeUndefined();
  });
});

// ------------------------------------------------------------------ regla S2-REJECTED con el detector
test('S2-REJECTED enseña las señales del detector y cumple C13', () => {
  const initial: InitialState = { betssonBefore: { amount: 10, currency: 'EUR', t: 0, source: 'api' }, gameBalance: 10, currentBet: 20, currency: 'EUR', capturedAt: 0 };
  const trace: RoundTrace = { action, events: [], spins: [], outcome: 'rejected' };
  trace.rejection = detectRejection({ action, events: [], spins: [], calls: [], screenChangedAt: 1500 });
  const round = buildGameRound({ cfg, scenario: 'insufficient-balance', initial, trace, visual: [], betssonAfter: { amount: 10, currency: 'EUR', t: 40_000, source: 'api' } });
  const checks = evaluateChecks({ cfg, scenario: 'insufficient-balance', round, initial, trace, visual: [], evidence: {} });
  const rej = checks.find((c) => c.id === 'S2-REJECTED')!;
  expect(Check.parse(rej)).toBeTruthy();
  expect(rej.result).toBe('PASS');
  expect(rej.observed).toContain('detector: rejected (señales: pantalla)');
  expect(checks.find((c) => c.id === 'S2-BETSSON-UNCHANGED')!.result).toBe('PASS');
  expect(checks.find((c) => c.id === 'S2-GAME-UNCHANGED')!.result).toBe('PASS');
});
