/**
 * Login una vez por ejecución, FUERA de las pruebas: así la contraseña nunca entra en la traza
 * ni en el vídeo del informe. Guarda la sesión en .auth/state.json (no se sube) y las pruebas la reutilizan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { SETTINGS, credentials } from './config/settings';
import { isLoggedIn, login, openCasino, rejectCookies } from './src/site/betsson';

export default async function globalSetup() {
  const file = SETTINGS.authFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { user, pass } = credentials();
  if (!user || !pass) {
    console.warn(`⚠️  Sin credenciales (${SETTINGS.market.userEnv}/${SETTINGS.market.passEnv} en tester/.env): solo se ejecuta la prueba del lobby.`);
    fs.writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  const m = SETTINGS.market;
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: m.locale, timezoneId: m.timezone, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  try {
    console.log(`Login en ${m.baseUrl} (sin traza ni vídeo)…`);
    await openCasino(page);
    console.log(`  · ${await rejectCookies(page)}`);
    await login(page, user, pass);
    if (!(await isLoggedIn(page))) throw new Error('el botón «Iniciar sesión» sigue visible');
    await context.storageState({ path: file });
    console.log('  · sesión iniciada y guardada');
  } catch (e) {
    fs.mkdirSync(SETTINGS.evidenceDir, { recursive: true });
    // Captura del fallo con los campos del formulario tapados.
    await page
      .screenshot({ path: `${SETTINGS.evidenceDir}/login-fallido.png`, mask: [page.locator('input')] })
      .catch(() => {});
    fs.writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    console.error(`✘ Login fallido: ${(e as Error).message.split('\n')[0]}. Captura en tester/${SETTINGS.evidenceDir}/login-fallido.png`);
  } finally {
    await browser.close();
  }
}
