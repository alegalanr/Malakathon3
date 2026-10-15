/**
 * Mensajes REALES de Bubble Up en betsson.es (15/10, cuenta con saldo, juego cargado sin girar).
 * Origen del juego: https://cajdsoitek.jmxyelekig.net · el anti-bot (Group-IB) también manda postMessage.
 */
import { expect, test } from '@playwright/test';
import { loadRunConfig } from '../../src/config/RunConfig';
import { buildGameRound, type InitialState, type RoundTrace } from '../../src/domain/GameRound';
import { currencyCode } from '../../src/domain/Money';
import { PragmaticAdapter } from '../../src/providers/PragmaticAdapter';
import { evaluateChecks } from '../../src/validation/rules';

const GAME = 'https://cajdsoitek.jmxyelekig.net';
const msg = (data: unknown, origin = GAME) => ({ t: 1000, origin, data });

const REAL = {
  loadingEnded: { sender: 'vs20bblup_cv116', lang: 'ES', success: true, name: 'gameLoadingEnded' },
  loadingProgress: { event: 'loadingProgress', params: { percentage: 95 } },
  postUpdateBalance: { sender: 'vs20bblup_cv116', lang: 'ES', success: true, name: 'post_updateBalance' },
  updateBalance: { sender: 'vs20bblup_cv116', lang: 'ES', success: true, name: 'post_updateBalance', event: 'updateBalance', params: { total: { currency: '€', amount: 5950 } } },
  antiBot: { action: 'gcfids', data: { id: 'x' } },
};

test('el nombre llega en «name» o en «event» (el adaptador lee los dos)', () => {
  expect(PragmaticAdapter.translate(msg(REAL.loadingEnded))!.type).toBe('READY');
  expect(PragmaticAdapter.translate(msg(REAL.loadingEnded))!.sender).toBe('vs20bblup_cv116');
  expect(PragmaticAdapter.translate(msg(REAL.loadingProgress), GAME)!.type).toBe('UNKNOWN');
  // Mensaje con los dos campos: manda «event»
  expect(PragmaticAdapter.translate(msg(REAL.updateBalance))!.type).toBe('BALANCE');
  expect(PragmaticAdapter.translate(msg(REAL.postUpdateBalance))!.type).toBe('UNKNOWN');
});

test('updateBalance real: céntimos y moneda «€» → EUR', () => {
  const e = PragmaticAdapter.translate(msg(REAL.updateBalance))!;
  expect(e.data).toEqual({ amount: 5950, currency: 'EUR' });
});

test('los mensajes del anti-bot no son del juego', () => {
  expect(PragmaticAdapter.translate(msg(REAL.antiBot, 'https://eu.id.group-ib.com'), GAME)).toBeNull();
});

test('códigos de moneda: símbolo o código, siempre el código', () => {
  expect(currencyCode('€')).toBe('EUR');
  expect(currencyCode('EUR')).toBe('EUR');
  expect(currencyCode('eur')).toBe('EUR');
  expect(currencyCode('S/')).toBe('PEN');
  expect(currencyCode('PEN')).toBe('PEN');
  expect(currencyCode('USD')).toBe('USD');
});

test('con la moneda real del juego («€»), S1-CURRENCY y S2-CURRENCY dan PASS', () => {
  const gameCurrency = PragmaticAdapter.translate(msg(REAL.updateBalance))!.data.currency;
  for (const scenario of ['completed-spin', 'insufficient-balance'] as const) {
    const cfg = loadRunConfig('es', scenario, 'simulated');
    const initial: InitialState = { betssonBefore: { amount: 5950, currency: 'EUR', t: 0, source: 'api' }, gameBalance: 5950, currentBet: 20, currency: gameCurrency, capturedAt: 0 };
    const trace: RoundTrace = { action: { action: 'spin', method: 'key', key: 'Space', t: 100 }, events: [], spins: [], outcome: 'rejected' };
    const round = buildGameRound({ cfg, scenario, initial, trace, visual: [] });
    const id = scenario === 'completed-spin' ? 'S1-CURRENCY' : 'S2-CURRENCY';
    const check = evaluateChecks({ cfg, scenario, round, initial, trace, visual: [], evidence: {} }).find((c) => c.id === id)!;
    expect(check.result, `${id}: ${check.observed}`).toBe('PASS');
    expect(round.findings.some((f) => f.startsWith('2 ·'))).toBe(false);
  }
});
