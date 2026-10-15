import { expect, test } from '@playwright/test';
import { StandardEvent } from '../../src/contracts/schemas';
import { PragmaticAdapter } from '../../src/providers/PragmaticAdapter';

const GAME = 'https://demogamesfree.pragmaticplay.net';
const msg = (data: unknown, origin = GAME) => ({ t: 1000, origin, data });

test('gameRoundStarted: apuesta y saldo inicial en céntimos, sin valores arrastrados', () => {
  const e = PragmaticAdapter.translate(
    msg({ event: 'gameRoundStarted', sender: 'vs20bblup_cv116', params: { betAmount: 4, balanceBefore: 62.5, winAmount: 2.8, balanceAfter: 58.5 } }),
    GAME,
  )!;
  expect(StandardEvent.parse(e)).toBeTruthy();
  expect(e.type).toBe('ROUND_STARTED');
  expect(e.data).toEqual({ bet: 400, balanceBefore: 6250 });
  expect(e.sender).toBe('vs20bblup_cv116');
});

test('resultShown = ROUND_ENDED con premio y saldo final', () => {
  const e = PragmaticAdapter.translate(msg(JSON.stringify({ name: 'resultShown', params: { winAmount: 0, balanceAfter: 58.5 } })), GAME)!;
  expect(e.type).toBe('ROUND_ENDED');
  expect(e.data).toEqual({ win: 0, balanceAfter: 5850 });
});

test('updateBalance viene en céntimos', () => {
  const e = PragmaticAdapter.translate(msg({ event: 'updateBalance', params: { total: { amount: 5850, currency: 'EUR' } } }), GAME)!;
  expect(e.type).toBe('BALANCE');
  expect(e.data).toEqual({ amount: 5850, currency: 'EUR' });
});

test('eventos conocidos sin traducción → UNKNOWN; mensajes ajenos → null', () => {
  expect(PragmaticAdapter.translate(msg({ event: 'betInfo', params: { betsPerLine: [0.01] } }), GAME)!.type).toBe('UNKNOWN');
  expect(PragmaticAdapter.translate(msg({ type: 'analytics-ping' }, 'https://www.betsson.es'), GAME)).toBeNull();
  expect(PragmaticAdapter.translate(msg('hola', 'https://ads.example'), GAME)).toBeNull();
});
