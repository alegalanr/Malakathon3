/**
 * Lista única de checks esperados (DISENO.md §7.3). La usan las reglas y el informe:
 * un check que falte aparece como FAIL "no evaluado" (D13).
 */
import type { Scenario, Source } from './schemas';

export interface ExpectedCheck {
  id: string;
  scenario: Scenario;
  title: string;
  sources: Source[];
}

export const EXPECTED_CHECKS: ExpectedCheck[] = [
  { id: 'S1-ROUND-STARTED', scenario: 'completed-spin', title: 'La tirada empezó', sources: ['event'] },
  { id: 'S1-ROUND-ENDED', scenario: 'completed-spin', title: 'La tirada terminó', sources: ['event'] },
  { id: 'S1-BET-USED', scenario: 'completed-spin', title: 'Apuesta usada coherente', sources: ['event', 'network'] },
  { id: 'S1-BET-VISIBLE', scenario: 'completed-spin', title: 'Apuesta mostrada = apuesta usada', sources: ['screen', 'event', 'network'] },
  { id: 'S1-CURRENCY', scenario: 'completed-spin', title: 'Moneda correcta', sources: ['event', 'wallet', 'screen'] },
  { id: 'S1-GAME-BALANCE', scenario: 'completed-spin', title: 'Saldo del juego coherente', sources: ['event', 'network'] },
  { id: 'S1-BETSSON-BALANCE', scenario: 'completed-spin', title: 'Saldo de Betsson cuadra', sources: ['wallet'] },
  { id: 'S1-RID-VISIBLE', scenario: 'completed-spin', title: 'Ronda identificada en pantalla', sources: ['screen', 'network'] },
  { id: 'S2-REJECTED', scenario: 'insufficient-balance', title: 'Tirada rechazada', sources: ['event', 'network'] },
  { id: 'S2-MSG-LANG-VISIBLE', scenario: 'insufficient-balance', title: 'Mensaje en el idioma esperado', sources: ['screen'] },
  { id: 'S2-BET-VISIBLE', scenario: 'insufficient-balance', title: 'Apuesta mostrada', sources: ['screen', 'event'] },
  { id: 'S2-CURRENCY', scenario: 'insufficient-balance', title: 'Moneda correcta', sources: ['event', 'wallet', 'screen'] },
  { id: 'S2-BETSSON-UNCHANGED', scenario: 'insufficient-balance', title: 'Saldo de Betsson sin cambios', sources: ['wallet'] },
  { id: 'S2-GAME-UNCHANGED', scenario: 'insufficient-balance', title: 'Saldo del juego sin cambios', sources: ['event'] },
];

export const expectedFor = (scenario: Scenario) => EXPECTED_CHECKS.filter((c) => c.scenario === scenario);
