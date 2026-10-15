/**
 * Reglas con rondas reales (SOLUCION.md §2.4) → PASS, y alteradas → FAIL.
 */
import { expect, test } from '@playwright/test';
import { Check, type StandardEvent, type VisualReading } from '../../src/contracts/schemas';
import { loadRunConfig } from '../../src/config/RunConfig';
import { buildGameRound, ridMatches, type InitialState, type RoundTrace } from '../../src/domain/GameRound';
import { evaluateChecks } from '../../src/validation/rules';
import { normalizeRid, detectLanguage } from '../../src/vision/ScreenWitness';

const cfg = loadRunConfig('es', 'completed-spin', 'simulated');
const ev = (type: StandardEvent['type'], data: StandardEvent['data'], t: number): StandardEvent => ({ type, name: type, data, t, raw: {}, origin: 'x' });
const vis = (field: VisualReading['field'], raw: string, value: VisualReading['value'], extra: Partial<VisualReading> = {}): VisualReading => ({
  field, raw, value, confidence: 0.9, roi: null, cropPath: `evidence/crop-${field}.png`, attempts: 1, ...extra,
});

function round(o: { bet: number; win: number; before: number; after: number; netAfter?: number; b1?: number; screenBet?: number; screenRid?: string; rid?: string }) {
  const initial: InitialState = { betssonBefore: { amount: o.before, currency: 'EUR', t: 0, source: 'api' }, gameBalance: o.before, currentBet: o.bet, currency: 'EUR', capturedAt: 0 };
  const trace: RoundTrace = {
    action: { action: 'spin', method: 'key', key: 'Space', t: 100 },
    events: [ev('ROUND_STARTED', { bet: o.bet, balanceBefore: o.before }, 200), ev('SPIN_ENDED', { win: o.win, balanceAfter: o.after }, 2000), ev('ROUND_ENDED', { win: o.win, balanceAfter: o.after }, 2500)],
    spins: [{ rid: o.rid ?? '658268119', bet: o.bet, balanceAfterSpin: o.netAfter ?? o.after, win: o.win, needsCollect: false, status: 200, t: 300 }],
    outcome: 'settled',
    capture: { path: 'evidence/settled.png', t: 2500, triggerEvent: 'ROUND_ENDED' },
  };
  const visual = [vis('rid', `#${o.screenRid ?? '658268119'}`, o.screenRid ?? '658268119'), vis('bet', '4,00 €', o.screenBet ?? o.bet, { currencySymbol: '€' })];
  const after = { amount: o.b1 ?? o.after, currency: 'EUR', t: 30_000, source: 'api' as const };
  const r = buildGameRound({ cfg, scenario: 'completed-spin', initial, trace, visual, betssonAfter: after });
  const checks = evaluateChecks({ cfg, scenario: 'completed-spin', round: r, initial, trace, visual, evidence: { settled: 'evidence/settled.png' } });
  return { r, checks, byId: Object.fromEntries(checks.map((c) => [c.id, c])) };
}

test('ronda real …658268119 (4,00 €, sin premio): todo PASS y cumple C13', () => {
  const { r, checks } = round({ bet: 400, win: 0, before: 6250, after: 5850 });
  expect(r.findings).toEqual([]);
  expect(checks).toHaveLength(8);
  for (const c of checks) {
    expect(Check.parse(c)).toBeTruthy();
    expect(c.result, `${c.id}: ${c.message}`).toBe('PASS');
  }
});

test('ronda real …663731119 (premio = apuesta, saldo igual): PASS', () => {
  const { checks } = round({ bet: 280, win: 280, before: 5850, after: 5850, screenBet: 280 });
  expect(checks.filter((c) => c.result === 'FAIL').map((c) => c.id)).toEqual([]);
});

test('saldo de Betsson que no cuadra → FAIL solo en S1-BETSSON-BALANCE', () => {
  const { byId, r } = round({ bet: 400, win: 0, before: 6250, after: 5850, b1: 6250 });
  expect(byId['S1-BETSSON-BALANCE'].result).toBe('FAIL');
  expect(byId['S1-GAME-BALANCE'].result).toBe('PASS');
  expect(r.findings.some((f) => f.startsWith('8'))).toBe(true);
});

test('el servidor contradice al evento → FAIL en S1-GAME-BALANCE', () => {
  const { byId } = round({ bet: 400, win: 0, before: 6250, after: 5850, netAfter: 5800 });
  expect(byId['S1-GAME-BALANCE'].result).toBe('FAIL');
});

test('OCR lee otro rid → FAIL en S1-RID-VISIBLE (y nada más)', () => {
  const { checks } = round({ bet: 400, win: 0, before: 6250, after: 5850, screenRid: '658268779' });
  expect(checks.filter((c) => c.result === 'FAIL').map((c) => c.id)).toEqual(['S1-RID-VISIBLE']);
});

test('apuesta mostrada distinta → FAIL en S1-BET-VISIBLE', () => {
  const { byId } = round({ bet: 400, win: 0, before: 6250, after: 5850, screenBet: 300 });
  expect(byId['S1-BET-VISIBLE'].result).toBe('FAIL');
  expect(byId['S1-BET-USED'].result).toBe('PASS');
});

test('normalización del rid y coincidencia', () => {
  expect(normalizeRid('#65B26Bl19')).toBe('658268119');
  expect(ridMatches('1234658268119', '658268119')).toBe(true);
  expect(ridMatches('268119', '658268119')).toBe(true); // últimos 6 dígitos
});

test('idioma del aviso', () => {
  expect(detectLanguage('Saldo insuficiente. No tienes suficiente saldo.', cfg).language).toBe('es');
  expect(detectLanguage('Insufficient funds', cfg).language).toBe('en');
  expect(detectLanguage('Bienvenido', cfg).language).toBeUndefined();
});
