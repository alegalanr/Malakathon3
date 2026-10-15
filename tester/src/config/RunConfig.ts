/**
 * F0: markets.json + entorno → RunConfig (C1), validado antes de abrir el navegador.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { RunConfig, type MarketId, type Scenario } from '../contracts/schemas';
import { eurosToCents } from '../domain/Money';

const FILE = path.join(__dirname, '..', '..', 'config', 'markets.json');

// Credenciales fuera de Docker: tester/.env y, si no, el .env de la raíz del repo (dotenv no pisa lo ya definido)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

export class ConfigError extends Error {}

export function loadRunConfig(market: MarketId, scenario: Scenario, mode: 'real' | 'simulated'): RunConfig {
  const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const m = all[market];
  if (!m) throw new ConfigError(`mercado desconocido en markets.json: ${market}`);
  const credentialEnv = scenario === 'insufficient-balance' ? m.noBalanceCredentials : m.credentials;
  const maxBetEnv = process.env.MAX_BET ? eurosToCents(process.env.MAX_BET) : undefined;
  const parsed = RunConfig.safeParse({
    market,
    scenario,
    mode,
    baseUrl: m.baseUrl,
    casinoPath: m.casinoPath,
    loginPath: m.loginPath,
    language: m.language,
    locale: m.locale,
    timezone: m.timezone,
    currency: m.currency,
    currencySymbol: m.currencySymbol,
    numberFormat: m.numberFormat,
    texts: m.texts,
    game: {
      provider: all.game.provider,
      name: process.env.GAME_NAME ?? all.game.name,
      search: process.env.GAME_SEARCH ?? all.game.search,
      path: process.env.GAME_PATH ?? all.game.path,
    },
    maxBet: maxBetEnv ?? eurosToCents(all.game.maxBet),
    ocr: all.ocr,
    credentialEnv,
  });
  if (!parsed.success) throw new ConfigError(`markets.json no cumple el contrato C1: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  const cfg = parsed.data;
  const expectedCurrency = { es: 'EUR', com: 'EUR', pe: 'PEN', mock: 'EUR' }[market];
  if (cfg.currency !== expectedCurrency) throw new ConfigError(`la moneda de ${market} debería ser ${expectedCurrency}`);
  return cfg;
}

/** Credenciales solo en memoria; nunca se guardan en RunConfig ni se imprimen. */
export function readCredentials(cfg: RunConfig): { user: string; pass: string } | null {
  const user = process.env[cfg.credentialEnv.userEnv] ?? '';
  const pass = process.env[cfg.credentialEnv.passEnv] ?? '';
  return user && pass ? { user, pass } : null;
}

export const runMode = (): 'real' | 'simulated' => (process.env.RUN_MODE === 'simulated' ? 'simulated' : 'real');
export const marketFromEnv = (): MarketId => (['es', 'com', 'pe', 'mock'].includes(process.env.MARKET ?? '') ? (process.env.MARKET as MarketId) : 'es');

export const AUTH_DIR = path.join(__dirname, '..', '..', '.auth');
export const authFile = (market: MarketId, scenario: Scenario) => path.join(AUTH_DIR, `${market}-${scenario}.json`);
export const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
export const CONTROL_MAPS_DIR = path.join(__dirname, '..', '..', 'control-maps');

/** Hay una sesión guardada con cookies (login automático o hecho a mano). */
export function hasSession(file: string): boolean {
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')).cookies ?? []).length > 0;
  } catch {
    return false;
  }
}
