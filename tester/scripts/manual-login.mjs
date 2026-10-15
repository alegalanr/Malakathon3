#!/usr/bin/env node
/**
 * Login hecho por una persona: abre un navegador visible en la página de login del mercado,
 * espera a que inicies sesión tú y guarda la sesión en .auth/<market>-<scenario>.json (no se sube).
 * El tester la reutiliza con LOGIN_MODE=manual. No toca credenciales ni modifica el navegador.
 *
 *   node scripts/manual-login.mjs [completed-spin|insufficient-balance]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const market = process.env.MARKET ?? 'es';
const scenario = process.argv[2] ?? 'completed-spin';
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'markets.json'), 'utf8'))[market];
const file = path.join(root, '.auth', `${market}-${scenario}.json`);
const TIMEOUT_MS = 5 * 60 * 1000;

if (!process.env.DISPLAY) {
  console.error('✘ No hay pantalla (DISPLAY). Usa: docker compose -f tester/compose.yaml run --rm login');
  process.exit(2);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: cfg.locale, timezoneId: cfg.timezone, viewport: { width: 1366, height: 768 } });
const page = await context.newPage();

// Sesión iniciada = la web obtiene el saldo de la cartera (solo responde con sesión)
const loggedIn = new Promise((resolve) => {
  context.on('response', (r) => {
    if (/\/api\/v2\/wallet\/balance/i.test(r.url()) && r.status() === 200) resolve(true);
  });
});

await page.goto(cfg.baseUrl + cfg.loginPath, { waitUntil: 'domcontentloaded' });
console.log(`Inicia sesión en la ventana del navegador (${scenario}). Tienes 5 minutos.`);

const ok = await Promise.race([loggedIn, new Promise((r) => setTimeout(() => r(false), TIMEOUT_MS))]);
if (!ok) {
  console.error('✘ No se detectó la sesión a tiempo. No se guarda nada.');
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(2000);
fs.mkdirSync(path.dirname(file), { recursive: true });
await context.storageState({ path: file });
console.log(`✔ Sesión guardada en tester/.auth/${market}-${scenario}.json. Lanza el escenario con LOGIN_MODE=manual.`);
await browser.close();
