/**
 * F1 (login): una vez por ejecución y FUERA de las pruebas, en un navegador sin traza ni vídeo,
 * para que las credenciales no lleguen a ninguna evidencia (ni siquiera a la traza del modo UI).
 * Guarda la sesión de cada cuenta en .auth/<market>-<scenario>.json (no se sube); F1 la verifica.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import type { Scenario } from './src/contracts/schemas';
import { AUTH_DIR, authFile, hasSession, loadRunConfig, marketFromEnv, readCredentials, runMode } from './src/config/RunConfig';
import { BetssonSite } from './src/site/BetssonSite';

const EMPTY = JSON.stringify({ cookies: [], origins: [] });

export default async function globalSetup() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const market = marketFromEnv();
  const scenarios: Scenario[] = ['completed-spin', 'insufficient-balance'];
  if (runMode() === 'simulated' || process.env.SKIP_LOGIN === '1') {
    for (const s of scenarios) fs.writeFileSync(authFile(market, s), EMPTY);
    return;
  }
  if (process.env.LOGIN_MODE === 'manual') {
    // La sesión la inició una persona con `scripts/manual-login.mjs`: se reutiliza tal cual
    for (const s of scenarios) {
      if (hasSession(authFile(market, s))) console.log(`Sesión iniciada a mano para ${s}: se reutiliza.`);
      else console.warn(`⚠️  ${s}: no hay sesión guardada. Ejecuta: docker compose -f tester/compose.yaml run --rm login ${s}`);
    }
    return;
  }
  for (const scenario of scenarios) {
    const cfg = loadRunConfig(market, scenario, 'real');
    const creds = readCredentials(cfg);
    const file = authFile(market, scenario);
    if (!creds) {
      console.warn(`⚠️  ${scenario}: faltan ${cfg.credentialEnv.userEnv}/${cfg.credentialEnv.passEnv}; ese escenario fallará en F1.`);
      fs.writeFileSync(file, EMPTY);
      continue;
    }
    const browser = await chromium.launch();
    const context = await browser.newContext({ locale: cfg.locale, timezoneId: cfg.timezone, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    try {
      console.log(`Login ${scenario} en ${cfg.baseUrl} (sin traza ni vídeo)…`);
      await new BetssonSite(page, cfg).login(creds.user, creds.pass);
      await context.storageState({ path: file });
      console.log('  · sesión guardada');
    } catch (e) {
      fs.writeFileSync(file, EMPTY);
      const shot = `${AUTH_DIR}/login-fallido-${scenario}.png`;
      await page.screenshot({ path: shot, mask: [page.locator('input')] }).catch(() => {});
      console.error(`✘ Login ${scenario} fallido: ${(e as Error).message.split('\n')[0]}. Captura (campos tapados): tester/.auth/login-fallido-${scenario}.png`);
    } finally {
      await browser.close();
    }
  }
}
