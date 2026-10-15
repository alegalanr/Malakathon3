/**
 * Parte pública, sin sesión: abrir el casino, rechazar cookies y buscar el juego.
 * Sirve para comprobar el entorno y los selectores sin gastar nada.
 */
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../config/settings';
import { openCasino, rejectCookies, searchGame } from '../src/site/betsson';

test('Lobby: cookies y búsqueda del juego de Pragmatic Play', async ({ page }) => {
  await test.step('Abrir el casino', async () => {
    await openCasino(page);
    console.log(`  · ${await rejectCookies(page)}`);
  });

  await test.step(`Buscar «${SETTINGS.game.search}»`, async () => {
    const found = await searchGame(page, SETTINGS.game.search, SETTINGS.game.path);
    expect(found, 'el buscador devuelve el juego').toBe(true);
    await expect(page).toHaveURL(new RegExp(SETTINGS.game.path.split('/').pop()! + '($|\\?)'));
  });
});
