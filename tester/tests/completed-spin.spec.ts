/**
 * Escenario 1: tirada completada en Real Play (docs/reto.md).
 *
 * El tester actúa como un jugador (tecla o clic real) y verifica escuchando:
 * eventos del juego, red del proveedor y cartera de Betsson, con capturas en los momentos clave.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SETTINGS, credentials } from '../config/settings';
import { Timeline } from '../src/evidence/timeline';
import { GameEventBus, pragmaticAdapter } from '../src/game/events';
import { GameServerTap } from '../src/game/server-tap';
import { BetssonWallet } from '../src/site/wallet';
import {
  findGameFrame, handleGameSession, isLoggedIn, launchRealPlay, openCasino, rejectCookies, searchGame,
} from '../src/site/betsson';
import { evaluate, type RoundObservation } from '../src/validation/checks';
import { eur } from '../src/money';

const S = SETTINGS;

test(`Escenario 1 · tirada completada · betsson.${S.market.id}`, async ({ page, context }, testInfo) => {
  test.skip(!credentials().user, `Faltan ${S.market.userEnv}/${S.market.passEnv} en tester/.env`);

  const tl = new Timeline();
  const bus = new GameEventBus(pragmaticAdapter, tl);
  const tap = new GameServerTap(tl);
  const wallet = new BetssonWallet(tl);
  await bus.attach(context); // antes de navegar: el listener tiene que estar cuando cargue el juego
  tap.attach(context);
  wallet.attach(context);

  const outDir = path.join(S.evidenceDir, 'ultima');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const shot = (name: string) => screenshot(page, testInfo, tl, outDir, name);
  const obs: RoundObservation = { currency: S.market.currency, maxBet: S.maxBet, actionAt: Infinity };

  try {
    await test.step('1. Casino con la sesión iniciada', async () => {
      await openCasino(page);
      tl.note(await rejectCookies(page));
      expect(await isLoggedIn(page), 'sesión iniciada (si falla, mira el login de global-setup)').toBe(true);
      await shot('01-casino');
    });

    await test.step('2. Saldo de Betsson antes (B0)', async () => {
      let r = await wallet.waitFor(0, 20_000);
      if (!r) {
        tl.note('sin lectura de cartera todavía: se recarga la página');
        await page.reload({ waitUntil: 'domcontentloaded' });
        r = await wallet.waitFor(0, 20_000);
      }
      expect(r, 'la web pide el saldo a /api/v2/wallet/balance').not.toBeNull();
    });

    await test.step(`3. Buscar «${S.game.search}» (Pragmatic Play)`, async () => {
      const ok = S.openMode === 'search' && (await searchGame(page, S.game.search, S.game.path));
      if (!ok) {
        tl.note(S.openMode === 'search' ? 'el buscador no devolvió el juego: se va a su página' : 'OPEN_MODE=url');
        await page.goto(S.game.path, { waitUntil: 'domcontentloaded' });
      }
    });

    const game = await test.step('4. Abrir en Real Play y esperar a que esté listo', async () => {
      await launchRealPlay(page, tl);
      const session = await handleGameSession(page, tl);
      if (session === 'blocked') {
        await shot('04-sesion-de-juego');
        throw new Error('La sesión de juego (DGOJ) pide datos que el tester aún no sabe rellenar (⚠️ pendiente)');
      }
      const g = await findGameFrame(page, 30_000);
      expect(g, 'aparece el iframe del juego').not.toBeNull();
      const ready = await bus.waitFor('READY', { timeoutMs: S.timeouts.readyMs });
      expect(ready, 'llega gameLoadingEnded').not.toBeNull();
      await page.waitForTimeout(S.timeouts.settleMs); // que termine la animación de entrada
      await shot('02-juego-listo');
      return g!;
    });

    await test.step('5. Antes de girar: apuesta y saldos', async () => {
      obs.walletBefore = wallet.latest();
      obs.gameBalanceBefore = bus.last('BALANCE');
      obs.lastBetChanged = bus.last('BET_CHANGED');
      const bet = obs.lastBetChanged?.bet;
      tl.note(`antes: cartera ${eur(obs.walletBefore?.total)} · juego ${eur(obs.gameBalanceBefore?.amount)} · apuesta ${eur(bet)}`);
      if (bet !== undefined && bet > S.maxBet) throw new Error(`La apuesta (${eur(bet)}) supera MAX_BET (${eur(S.maxBet)}): no se gira`);
      if (bet === undefined && S.unknownBet === 'abort') {
        throw new Error('No se conoce la apuesta antes de girar y UNKNOWN_BET=abort: no se gira');
      }
    });

    await test.step(`6. Girar (${S.spinMode}) y confirmarlo con gameRoundStarted`, async () => {
      obs.actionAt = Date.now();
      if (S.spinMode === 'space') {
        await game.element.focus();
        await page.keyboard.press('Space');
      } else {
        const box = (await game.element.boundingBox())!;
        await page.mouse.click(box.x + box.width * S.spinClick.x, box.y + box.height * S.spinClick.y);
      }
      tl.add('action', { what: `spin (${S.spinMode})` }, obs.actionAt);
      obs.started = (await bus.waitFor('ROUND_STARTED', { after: obs.actionAt, timeoutMs: S.timeouts.roundStartMs })) ?? undefined;
      expect(obs.started, `la tirada empieza tras la acción (${S.spinMode})`).toBeDefined();
      if (obs.started!.bet !== undefined && obs.started!.bet > S.maxBet) {
        tl.note(`⚠️ la ronda empezó con apuesta ${eur(obs.started!.bet)} > MAX_BET`);
      }
    });

    await test.step('7. Esperar al final de la ronda y capturar el resultado', async () => {
      const after = obs.started!.t;
      obs.spinEnded = (await bus.waitFor('SPIN_ENDED', { after, timeoutMs: S.timeouts.roundEndMs })) ?? undefined;
      obs.ended = (await bus.waitFor('ROUND_ENDED', { after, timeoutMs: S.timeouts.roundEndMs })) ?? undefined;
      await shot('03-resultado'); // en resultShown: el premio ya terminó de contarse
      obs.doSpin = tap.first('doSpin', obs.actionAt);
      obs.doCollect = tap.first('doCollect', obs.actionAt);
    });

    await test.step('8. Saldo de Betsson después (B1)', async () => {
      const since = obs.ended?.t ?? obs.spinEnded?.t ?? Date.now();
      let r = await wallet.waitFor(since, S.timeouts.walletWaitMs);
      if (!r) {
        tl.note('la cartera no se refrescó sola: se recarga la página, como haría un jugador');
        await page.reload({ waitUntil: 'domcontentloaded' });
        r = await wallet.waitFor(since, 20_000);
      }
      obs.walletAfter = r ?? undefined;
      await shot('04-despues');
    });
  } finally {
    await test.step('9. Comprobaciones', async () => {
      const checks = evaluate(obs);
      for (const ch of checks) {
        const mark = ch.status === 'pass' ? '✔' : ch.status === 'fail' ? '✘' : '–';
        console.log(`  ${mark} ${ch.id} ${ch.title}: ${ch.actual} (esperado: ${ch.expected})`);
        expect.soft(ch.status, `${ch.id} ${ch.title} — esperado: ${ch.expected} · obtenido: ${ch.actual}`).not.toBe('fail');
      }
      const json = JSON.stringify({ market: S.market.id, scenario: 'completed-spin', game: S.game.search, checks }, null, 2);
      fs.writeFileSync(path.join(outDir, 'checks.json'), json);
      await testInfo.attach('checks.json', { body: json, contentType: 'application/json' });
      tl.write(path.join(outDir, 'timeline.jsonl'));
      await testInfo.attach('timeline.jsonl', { path: path.join(outDir, 'timeline.jsonl'), contentType: 'application/jsonl' });
    });
  }
});

async function screenshot(page: Page, testInfo: TestInfo, tl: Timeline, dir: string, name: string) {
  const t = Date.now(); // la hora es la del momento, no la de cuando termina la captura (~0,7 s)
  const body = await page.screenshot().catch(() => null);
  if (!body) return;
  fs.writeFileSync(path.join(dir, `${name}.png`), body);
  await testInfo.attach(name, { body, contentType: 'image/png' });
  tl.add('screenshot', { name }, t);
}
