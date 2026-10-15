/**
 * Parte pública, sin sesión ni dinero: cookies y búsqueda del juego. Comprueba entorno y selectores.
 */
import { expect, test } from '@playwright/test';
import { loadRunConfig, marketFromEnv } from '../src/config/RunConfig';
import { BetssonSite } from '../src/site/BetssonSite';

test.use({ storageState: { cookies: [], origins: [] } });

test('Lobby: cookies y búsqueda del juego de Pragmatic Play', async ({ page }) => {
  const cfg = loadRunConfig(marketFromEnv(), 'completed-spin', 'real');
  const site = new BetssonSite(page, cfg);
  await site.openCasino();
  console.log(`  · ${await site.rejectCookies()}`);
  expect(await site.searchGame(), 'el buscador devuelve el juego').toBe('buscador');
  await expect(page).toHaveURL(new RegExp(cfg.game.path.split('/').pop()! + '($|\\?)'));
});
