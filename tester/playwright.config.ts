import { defineConfig } from '@playwright/test';
import { loadRunConfig, marketFromEnv } from './src/config/RunConfig';

const market = marketFromEnv();
const cfg = loadRunConfig(market, 'completed-spin', 'real');

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 6 * 60 * 1000,
  workers: 1, // una cuenta = un saldo: nunca dos rondas a la vez
  retries: 0, // con dinero real no se reintenta a ciegas
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: cfg.baseUrl,
    locale: cfg.locale,
    timezoneId: cfg.timezone,
    viewport: { width: 1366, height: 768 },
    // La traza la arranca el escenario DESPUÉS del login (F1) y no se publica (D9).
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    { name: 'lobby', testMatch: /lobby\.spec\.ts/ },
    { name: market, testMatch: /(completed-spin|insufficient-balance)\.spec\.ts/ },
  ],
});
