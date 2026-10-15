import { defineConfig } from '@playwright/test';
import { SETTINGS } from './config/settings';

const m = SETTINGS.market;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 5 * 60 * 1000,
  workers: 1, // una cuenta = un saldo: nunca dos rondas a la vez
  retries: 0, // con dinero real no se reintenta a ciegas
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: m.baseUrl,
    locale: m.locale,
    timezoneId: m.timezone,
    viewport: { width: 1366, height: 768 },
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    // Sin sesión: solo la parte pública (cookies y buscador). Sirve para comprobar el entorno.
    { name: 'lobby', testMatch: /lobby\.spec\.ts/ },
    // Con la sesión que deja global-setup.ts.
    { name: m.id, testMatch: /completed-spin\.spec\.ts/, use: { storageState: SETTINGS.authFile } },
  ],
});
