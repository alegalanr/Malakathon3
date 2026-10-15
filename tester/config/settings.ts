/**
 * Configuración del tester. Única fuente de ajustes: el resto importa de aquí.
 * Los secretos y las opciones personales van en tester/.env (no se sube).
 */
import 'dotenv/config';

export interface Market {
  id: string;
  baseUrl: string;
  casinoPath: string;
  language: string;
  locale: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
  userEnv: string;
  passEnv: string;
}

// Por ahora solo betsson.es: es la testbed que nos han dado (las cuentas son de ese mercado).
export const MARKETS: Record<string, Market> = {
  es: {
    id: 'es',
    baseUrl: 'https://www.betsson.es',
    casinoPath: '/casino',
    language: 'es',
    locale: 'es-ES',
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    currencySymbol: '€',
    userEnv: 'BETSSON_ES_USER',
    passEnv: 'BETSSON_ES_PASS',
  },
};

const num = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : def;
};
const pick = <T extends string>(name: string, allowed: readonly T[], def: T): T =>
  (allowed as readonly string[]).includes(process.env[name] ?? '') ? (process.env[name] as T) : def;

export const SETTINGS = {
  market: MARKETS[process.env.MARKET ?? 'es'],

  // Juego: cualquier Pragmatic Play vale; Bubble Up es el que ya ha probado el equipo.
  game: {
    search: process.env.GAME_SEARCH ?? 'Bubble Up',
    path: process.env.GAME_PATH ?? '/casino/tragaperras-slots/bubble-up',
    providerId: 'pragmatic-play',
  },

  // search: escribe en el buscador del lobby como un jugador; url: va directo a la página del juego
  openMode: pick('OPEN_MODE', ['search', 'url'] as const, 'search'),
  // space: barra espaciadora (sin coordenadas); click: clic en SPIN_CLICK_X/Y relativos al juego
  spinMode: pick('SPIN_MODE', ['space', 'click'] as const, 'space'),
  spinClick: { x: num('SPIN_CLICK_X', 0.5), y: num('SPIN_CLICK_Y', 0.9) },
  // abort: si no sabemos la apuesta antes de girar, no se gira; spin: se gira y se comprueba después
  unknownBet: pick('UNKNOWN_BET', ['abort', 'spin'] as const, 'spin'),

  maxBet: num('MAX_BET', 5),

  timeouts: {
    readyMs: num('READY_TIMEOUT_S', 90) * 1000,
    roundStartMs: num('ROUND_START_TIMEOUT_S', 6) * 1000,
    roundEndMs: num('ROUND_END_TIMEOUT_S', 60) * 1000,
    walletWaitMs: num('WALLET_WAIT_S', 40) * 1000,
    settleMs: 1500, // pantalla quieta tras READY antes de tocar nada
  },

  authFile: '.auth/state.json',
  evidenceDir: 'evidence',
};

export function credentials() {
  const m = SETTINGS.market;
  return { user: process.env[m.userEnv] ?? '', pass: process.env[m.passEnv] ?? '' };
}
