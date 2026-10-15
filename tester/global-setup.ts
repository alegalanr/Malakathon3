/**
 * F1 (login): una vez por ejecución y FUERA de las pruebas, en un navegador sin traza ni vídeo,
 * para que las credenciales no lleguen a ninguna evidencia (ni siquiera a la traza del modo UI).
 * Guarda la sesión de cada cuenta en .auth/<market>-<scenario>.json (no se sube); F1 la verifica.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import type { Scenario } from './src/contracts/schemas';
import { AUTH_DIR, authFile, loadRunConfig, marketFromEnv, readCredentials, runMode } from './src/config/RunConfig';
import { BetssonSite } from './src/site/BetssonSite';

const EMPTY = JSON.stringify({ cookies: [], origins: [] });
const REUSE_MAX_MIN = 30;

function freshSession(file: string): boolean {
  try {
    const recent = Date.now() - fs.statSync(file).mtimeMs < REUSE_MAX_MIN * 60_000;
    return recent && (JSON.parse(fs.readFileSync(file, 'utf8')).cookies ?? []).length > 0;
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const market = marketFromEnv();
  const scenarios: Scenario[] = ['completed-spin', 'insufficient-balance'];
  if (runMode() === 'simulated' || process.env.SKIP_LOGIN === '1') {
    // Sin pisar una sesión guardada (p. ej. la del login manual): los tests unitarios la borraban
    for (const s of scenarios) if (!fs.existsSync(authFile(market, s))) fs.writeFileSync(authFile(market, s), EMPTY);
    return;
  }
  if (process.env.MANUAL_LOGIN === '1') {
    // Login manual (scripts/save-session.mjs): se reutiliza la sesión guardada y no se envía ningún formulario
    for (const s of scenarios) {
      if (fs.existsSync(authFile(market, s))) console.log(`${s}: se reutiliza la sesión iniciada a mano`);
      else {
        console.warn(`⚠️  ${s}: no hay sesión guardada (node tester/scripts/save-session.mjs ${market} ${s}); ese escenario fallará en F1.`);
        fs.writeFileSync(authFile(market, s), EMPTY);
      }
    }
    return;
  }
  // LOGIN_SCENARIOS: solo las cuentas que se van a usar (el centro de control lanza un escenario cada vez)
  const wanted = (process.env.LOGIN_SCENARIOS ?? '').split(',').filter(Boolean);
  for (const scenario of scenarios) {
    if (wanted.length && !wanted.includes(scenario)) continue;
    const cfg = loadRunConfig(market, scenario, 'real');
    const creds = readCredentials(cfg);
    const file = authFile(market, scenario);
    // REUSE_SESSION=1: si la sesión guardada es reciente, no se repite el login (agilidad); F1 la verifica igual
    if (process.env.REUSE_SESSION === '1' && freshSession(file)) {
      console.log(`Sesión de ${scenario} reutilizada (menos de ${REUSE_MAX_MIN} min)`);
      continue;
    }
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
