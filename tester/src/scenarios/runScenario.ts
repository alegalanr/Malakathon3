/**
 * Punto de unión con el informe (DISENO.md §6.2): ejecuta un escenario por fases (SOLUCION.md §13)
 * y devuelve un RunReport (C14). NUNCA lanza excepción: si algo revienta, la fase queda "failed"
 * con su motivo, las siguientes de F1-F9 quedan "skipped" y F10-F12 se ejecutan siempre.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type {
  ActionRecord, Check, Control, ControlMap, GameRound, PhaseId, PhaseStatus, RunConfig, RunReport, SessionState,
  VisualReading, WalletReading,
} from '../contracts/schemas';
import { CONTROL_MAPS_DIR, REPORTS_DIR } from '../config/RunConfig';
import { buildGameRound, type InitialState, type RoundTrace } from '../domain/GameRound';
import { extendedRoundSignals, scenarioPrecondition } from '../edge-cases/EdgeCases';
import { Evidence } from '../evidence/Evidence';
import { redact, redactText } from '../evidence/redact';
import { loadControlMap, saveControlMap } from '../game/ControlMap';
import { GameEventBus } from '../game/GameEventBus';
import { GameExplorer } from '../game/GameExplorer';
import { changedFraction, findGameFrame, pixelStd, type GameHandle } from '../game/GameFrame';
import { perform, SPACE } from '../game/GameControls';
import { GameServerTap } from '../game/GameServerTap';
import { PragmaticAdapter } from '../providers/PragmaticAdapter';
import { buildRunReport } from '../report/Report';
import { BetssonSite } from '../site/BetssonSite';
import { BetssonWallet } from '../site/BetssonWallet';
import { completeContract, detectRejection } from '../scenario2/RejectionDetector';
import { completeChecks, evaluateChecks } from '../validation/rules';
import { OcrEngine } from '../vision/OcrEngine';
import { locateRois } from '../vision/RoiLocator';
import { ScreenWitness } from '../vision/ScreenWitness';

const VIEWPORT = { width: 1366, height: 768 };
const T = {
  sessionWalletMs: 20_000,
  readyMs: 60_000,
  settleMs: 1500,
  roundStartMs: 5_000,
  roundEndMs: 45_000,
  collectMs: 10_000,
  rejectWatchMs: 8_000,
  walletS1Ms: 40_000,
  walletS2Ms: 35_000,
  extendedRoundMs: 180_000, // free spins o bonus
  quietMs: 15_000, // sin rondas nuevas durante este tiempo = la ronda extendida terminó
};

/** SOLUCION.md §14.5 */
interface RunContext {
  config: RunConfig;
  session?: SessionState;
  listeners?: { bus: GameEventBus; tap: GameServerTap; wallet: BetssonWallet };
  game?: GameHandle;
  controls?: ControlMap;
  initial?: InitialState;
  action?: ActionRecord;
  trace?: RoundTrace;
  visual?: VisualReading[];
  betssonAfter?: WalletReading;
  round?: GameRound;
  checks?: Check[];
  phases: PhaseStatus[];
}

class PhaseError extends Error {}
const need = (cond: unknown, msg: string) => {
  if (!cond) throw new PhaseError(msg);
};

export async function runScenario(args: { page: Page; context: BrowserContext; cfg: RunConfig; testInfo?: TestInfo }): Promise<RunReport> {
  const { page, context, cfg } = args;
  const startedAt = new Date().toISOString();
  const ev = new Evidence(REPORTS_DIR, `${cfg.market}-${cfg.scenario}`);
  const ctx: RunContext = { config: cfg, phases: [] };
  const ocr = new OcrEngine();
  const site = new BetssonSite(page, cfg);
  const s1 = cfg.scenario === 'completed-spin';
  const shots: { settled?: string; rejected?: string; idle?: string; wallet?: string } = {};
  let halted: string | null = null;
  let tracing = false;

  async function phase(id: PhaseId, name: string, fn: () => Promise<string[]>, opts: { always?: boolean } = {}) {
    const t0 = Date.now();
    const push = (status: PhaseStatus['status'], produced: string[], reason?: string) => {
      ctx.phases.push({ phase: id, name, status, startedAt: t0, endedAt: Date.now(), reason, produced });
      ev.log('phase', `${id} ${name}`, status === 'ok' ? 'ok' : `${status}: ${reason}`, undefined, t0);
    };
    if (halted && !opts.always) return push('skipped', [], `no ejecutada: ${halted}`);
    try {
      push('ok', await fn());
    } catch (e) {
      const reason = redactText((e as Error).message.split('\n')[0]);
      push('failed', [], reason);
      if (!opts.always) halted = `${id} falló (${reason})`;
    }
  }

  // ---------------------------------------------------------------- F0
  await phase('F0', 'Preparación', async () => {
    await ocr.init(cfg.ocr.languages);
    if (!ocr.ready) ev.log('note', 'OCR', `no disponible (${ocr.error}): los checks *-VISIBLE quedarán FAIL`);
    return ['config', 'evidence', ocr.ready ? 'ocr' : 'ocr: no disponible'];
  });

  // ---------------------------------------------------------------- F1
  const wallet = new BetssonWallet(ev);
  await phase('F1', 'Sesión', async () => {
    wallet.attach(context);
    await site.openCasino();
    ev.log('note', 'cookies', await site.rejectCookies());
    ctx.session = await site.session();
    let first = await wallet.waitForChange(0, T.sessionWalletMs);
    if (!first) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      first = await wallet.waitForChange(0, T.sessionWalletMs);
    }
    need(first, 'la cartera de Betsson no respondió: sesión no válida');
    need(first!.currency === cfg.currency, `mercado incorrecto: la cartera está en ${first!.currency}, se esperaba ${cfg.currency}`);
    await ev.capture(page, 'casino', 'Casino con la sesión iniciada');
    // La traza empieza DESPUÉS del login (y nunca se publica, D9)
    tracing = await context.tracing.start({ screenshots: true, snapshots: true }).then(() => true, () => false);
    return ['session', 'wallet: primera lectura'];
  });

  // ---------------------------------------------------------------- F2
  const bus = new GameEventBus(PragmaticAdapter, ev);
  const tap = new GameServerTap(ev);
  await phase('F2', 'Escucha', async () => {
    need(ctx.session, 'falta session: F1 falló');
    await bus.attach(context);
    // La página ya está cargada: el script de inicio solo actúa en documentos nuevos, así que se instala también aquí
    await page.evaluate(() => {
      const w = window as unknown as { __qaListening?: boolean; __qaPostMessage?: (m: unknown) => void };
      if (w.__qaListening) return;
      w.__qaListening = true;
      window.addEventListener('message', (e) => {
        let data: unknown = e.data;
        try {
          data = typeof data === 'string' ? data : JSON.parse(JSON.stringify(data));
        } catch {
          data = String(data);
        }
        w.__qaPostMessage?.({ t: Date.now(), origin: e.origin, data });
      }, true);
    });
    tap.attach(context);
    need(bus.isActive() && tap.isActive() && wallet.isActive(), 'algún oyente no está activo');
    ctx.listeners = { bus, tap, wallet };
    return ['listeners'];
  });

  // ---------------------------------------------------------------- F3
  await phase('F3', 'Juego listo', async () => {
    need(ctx.listeners, 'faltan los oyentes: F2 falló');
    const how = await site.searchGame();
    ev.log('note', 'juego', `«${cfg.game.search}» abierto por ${how}`);
    ev.log('note', 'Real Play', await site.launchRealPlay());
    const dgoj = await site.handleGameSession();
    if (dgoj !== 'none') ev.log('note', 'sesión de juego DGOJ', dgoj);
    if (dgoj === 'blocked') {
      await ev.capture(page, 'sesion-dgoj', 'Sesión de juego (DGOJ) pendiente');
      throw new PhaseError('la sesión de juego (DGOJ) pide datos que el tester no sabe rellenar todavía');
    }
    const game = await findGameFrame(page, T.readyMs);
    need(game, 'no aparece el iframe del juego');
    bus.gameOrigin = game!.origin;
    await bus.waitFor('READY', { timeoutMs: T.readyMs }).catch(() => {
      throw new PhaseError('el juego no emitió READY (gameLoadingEnded) en 60 s');
    });
    await page.waitForTimeout(T.settleMs); // pantalla tranquila: sin animación de entrada a medias
    const png = await game!.element.screenshot();
    need(pixelStd(png) > 6, 'el juego no se renderiza (recuadro en negro o en blanco)');
    game!.sender = bus.state.sender;
    need(!game!.sender || /^vs/.test(game!.sender), `el juego no parece de Pragmatic (sender ${game!.sender})`);
    // Modo real: el saldo del juego es el de la cartera (en demo sería otro)
    if (bus.state.lastBalance === undefined) await bus.tryWaitFor('BALANCE', { timeoutMs: 10_000 });
    need(bus.state.lastBalance !== undefined, 'no llegó el saldo del juego (updateBalance): no se puede verificar Real Play');
    const w = wallet.read();
    need(w && w.amount === bus.state.lastBalance, `saldo del juego ${bus.state.lastBalance} ≠ cartera ${w?.amount}: ¿modo demo?`);
    game!.mode = 'real';
    ctx.game = game!;
    return ['game', 'READY'];
  });

  // ---------------------------------------------------------------- F4
  await phase('F4', 'Controles', async () => {
    need(ctx.game?.mode === 'real', 'falta game en modo real: F3 falló');
    const map = loadControlMap(CONTROL_MAPS_DIR, cfg.game.name, VIEWPORT);
    if (!map.controls.spin) ev.log('note', 'controles', 'sin mapa guardado: se probará Espacio y se validará con ROUND_STARTED en F6');
    if ((!map.rois.bet || (s1 && !map.rois.rid)) && ocr.ready) {
      const found = await locateRois(ocr, await ctx.game!.element.screenshot(), cfg);
      map.rois.bet = map.rois.bet ?? found.bet?.[0];
      if (s1) map.rois.rid = map.rois.rid ?? found.rid;
      ev.log('screen', 'zonas', `apuesta ${map.rois.bet ? 'localizada' : 'no localizada'}${s1 ? ` · rid ${map.rois.rid ? 'localizado' : 'no localizado (aparece tras la primera ronda)'}` : ''}`, map.rois);
    }
    ctx.controls = map;
    return ['controls'];
  });

  // ---------------------------------------------------------------- F5
  await phase('F5', 'Estado inicial', async () => {
    need(ctx.controls && ctx.game, 'faltan controls: F4 falló');
    if (bus.state.roundInProgress) {
      // Caso raro: el juego retoma una ronda pendiente al cargar. Se espera a que termine antes de leer el estado inicial.
      ev.log('note', 'ronda pendiente', 'el juego tiene una ronda en curso al cargar: se espera a que termine');
      await bus.tryWaitFor('ROUND_ENDED', { after: bus.last('ROUND_STARTED')?.t ?? 0, timeoutMs: T.roundEndMs });
      await page.waitForTimeout(T.settleMs);
    }
    need(!bus.state.roundInProgress, 'hay una ronda en curso que no termina');
    // B0: la última lectura vale (desde F1 no se ha jugado nada); si es vieja, se espera un refresco
    // pasivo para recoger una ronda anterior reciente. No se recarga: cerraría el juego.
    let b0 = wallet.read();
    if (b0 && Date.now() - b0.t > 30_000) b0 = (await wallet.waitForChange(b0.t, T.walletS2Ms)) ?? b0;
    const idle = await ev.capture(ctx.game!.element, 'idle', 'Juego en reposo (F5)');
    shots.idle = idle?.path;
    let currentBet = bus.state.currentBet;
    let betSource = 'evento BET_CHANGED';
    if (currentBet === undefined && idle && ocr.ready) {
      // Sin betChanged al cargar: la apuesta seleccionada se lee en pantalla (testigo visual)
      const w = new ScreenWitness(ocr, ev.dir);
      const { readings } = await w.read({ capture: { png: idle.png, t: idle.t, triggerEvent: 'reposo' }, fields: ['bet'], rois: ctx.controls!.rois, config: cfg });
      const r = readings[0];
      if (typeof r.value === 'number' && r.confidence >= cfg.ocr.minConfidence) {
        currentBet = r.value;
        betSource = `pantalla («${r.raw}»)`;
      }
    }
    ctx.initial = {
      betssonBefore: b0,
      gameBalance: bus.state.lastBalance,
      currentBet,
      currency: bus.state.lastCurrency,
      capturedAt: Date.now(),
      idleCapture: idle?.path,
    };
    ev.log('note', 'antes', `B0=${b0?.amount} ${b0?.currency} · juego=${bus.state.lastBalance} ${bus.state.lastCurrency ?? ''} · apuesta=${currentBet} (${betSource})`);
    need(b0, 'falta B0');
    need(currentBet !== undefined, 'apuesta actual desconocida: por prudencia no se gira');
    need(currentBet! <= cfg.maxBet, `apuesta por encima del máximo (${currentBet} > ${cfg.maxBet} céntimos): no se gira`);
    const pre = scenarioPrecondition({ scenario: cfg.scenario, gameBalance: ctx.initial.gameBalance, walletBalance: b0!.amount, bet: currentBet });
    ev.log('note', 'precondición de saldo', pre.reason);
    need(pre.ok, pre.reason);
    if (ctx.initial.currency && ctx.initial.currency !== b0!.currency) ev.log('note', 'hallazgo', `moneda del juego ${ctx.initial.currency} ≠ cartera ${b0!.currency}`);
    if (ctx.initial.gameBalance !== b0!.amount) ev.log('note', 'hallazgo', `saldo del juego ${ctx.initial.gameBalance} ≠ cartera ${b0!.amount} (puede ser desfase de refresco)`);
    return ['initial'];
  });

  // ---------------------------------------------------------------- F6
  let baselineBeforeAction: Buffer | null = null;
  await phase('F6', 'Acción del jugador', async () => {
    need(ctx.initial && ctx.controls && ctx.game, 'falta initial: F5 falló');
    const game = ctx.game!;
    const map = ctx.controls!;
    const spinControl: Control = map.controls.spin ?? SPACE;
    baselineBeforeAction = await game.element.screenshot().catch(() => null);
    let action = await perform(page, game, 'spin', spinControl);
    ev.log('action', 'spin', `${spinControl.method}${spinControl.key ? ' ' + spinControl.key : ''}`, action, action.t);
    if (!s1) {
      ctx.action = action;
      return ['action'];
    }
    let started = await bus.tryWaitFor('ROUND_STARTED', { after: action.t, timeoutMs: T.roundStartMs });
    if (!started) {
      // Un único reintento: el explorador (Enter y, si no, barrido + clic clasificado por evento)
      ev.log('note', 'controles', 'el control no produjo ROUND_STARTED: se redescubre');
      const explorer = new GameExplorer(page, game, bus, ev);
      let found = spinControl.key === 'Space' ? await explorer.tryEnter(T.roundStartMs) : undefined;
      if (!found) {
        const res = await explorer.classify(await explorer.sweep(), 4000);
        if (res.betUp) map.controls.betUp = res.betUp;
        if (res.betDown) map.controls.betDown = res.betDown;
        found = res.spin;
      }
      need(found, 'la tirada no empezó');
      action = found!.action;
      started = found!.started;
      map.controls.spin = { ...found!.control, validatedAt: started.t };
    } else {
      map.controls.spin = { ...spinControl, validatedAt: started.t };
    }
    saveControlMap(CONTROL_MAPS_DIR, map);
    action.confirmedBy = started;
    ctx.action = action;
    if (started!.data.bet !== undefined && started!.data.bet > cfg.maxBet) ev.log('note', 'hallazgo', `la ronda empezó con apuesta ${started!.data.bet} > máximo ${cfg.maxBet}`);
    return ['action'];
  });

  // ---------------------------------------------------------------- F7
  let settledPng: Buffer | null = null;
  await phase('F7', s1 ? 'Ronda y liquidación' : 'Rechazo', async () => {
    need(ctx.action, s1 ? 'la tirada no empezó (F6)' : 'falta action: F6 falló');
    const game = ctx.game!;
    const action = ctx.action!;
    if (s1) {
      const after = action.confirmedBy!.t;
      const spinEnded = await bus.tryWaitFor('SPIN_ENDED', { after, timeoutMs: T.roundEndMs });
      const ended = await bus.tryWaitFor('ROUND_ENDED', { after, timeoutMs: T.roundEndMs });
      let capture: RoundTrace['capture'];
      if (ended) {
        const c = await ev.capture(game.element, 'settled', 'Pantalla liquidada (resultShown)', ended.t);
        if (c) {
          settledPng = c.png;
          shots.settled = c.path;
          capture = { path: c.path, t: c.t, triggerEvent: 'ROUND_ENDED' };
        }
      }
      await tap.settle();
      const spin = tap.spinsBetween(action.t)[0];
      if (spin?.needsCollect && spin.collectBalance === undefined) {
        const deadline = Date.now() + T.collectMs;
        while (Date.now() < deadline && spin.collectBalance === undefined) await page.waitForTimeout(300);
      }
      await tap.settle();
      const ext = extendedRoundSignals({ spins: tap.spinsBetween(action.t), calls: tap.calls.filter((c) => c.t >= action.t), events: bus.events.filter((e) => e.t >= action.t) });
      if (ext.extended) {
        // Caso raro: free spins o bonus. No se pulsa nada: se espera a que el juego termine solo (máx. 180 s)
        // para no dejar una ronda a medias, y se informa. El tester valida rondas de una sola tirada.
        ev.log('note', 'hallazgo', `ronda extendida (free spins o bonus): ${ext.reasons.join(' · ')}`, ext);
        const deadline = action.t + T.extendedRoundMs;
        let lastActivity = Date.now();
        while (Date.now() < deadline && Date.now() - lastActivity < T.quietMs) {
          await page.waitForTimeout(1000);
          const latest = Math.max(...bus.events.map((e) => e.t), ...tap.spins.map((s) => s.t), 0);
          if (latest > lastActivity) lastActivity = latest;
        }
        await ev.capture(game.element, 'extended-end', 'Fin de la ronda extendida (free spins o bonus)');
        await tap.settle();
      }
      ctx.trace = {
        action,
        events: bus.events.filter((e) => e.t >= action.t),
        spins: tap.spinsBetween(action.t),
        outcome: ended && spinEnded ? 'settled' : 'timeout',
        capture,
      };
      need(!ext.extended, `ronda extendida (free spins o bonus): ${ext.reasons.join(' · ')}; se esperó a que terminara sin pulsar nada, pero el tester solo valida rondas de una tirada`);
      const starts = ctx.trace.events.filter((e) => e.type === 'ROUND_STARTED').length;
      need(starts <= 1, 'ronda duplicada: llegaron dos ROUND_STARTED');
      need(ctx.trace.outcome === 'settled', 'la ronda no llegó a resultShown a tiempo');
      need(ctx.trace.spins.length === 1, `se esperaba un doSpin en la ventana de la ronda y hay ${ctx.trace.spins.length}`);
      return ['trace'];
    }
    // Escenario 2: no debe llegar ROUND_STARTED con cobro; se captura cuando la pantalla cambia (ventana de aviso)
    const deadline = action.t + T.rejectWatchMs;
    let changedAt: number | undefined;
    let shot: Buffer | null = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      shot = await game.element.screenshot().catch(() => null);
      if (shot && baselineBeforeAction && changedFraction(baselineBeforeAction, shot) > 0.12) {
        changedAt = Date.now();
        await page.waitForTimeout(700); // que termine de abrirse la ventana
        break;
      }
    }
    const c = await ev.capture(game.element, 'rejected', changedAt ? 'Aviso tras el intento' : 'Pantalla tras el intento (sin cambios)', changedAt);
    if (c) {
      settledPng = c.png;
      shots.rejected = c.path;
    }
    await tap.settle();
    const events = bus.events.filter((e) => e.t >= action.t);
    const paid = events.some((e) => e.type === 'ROUND_STARTED' && (e.data.bet ?? 0) > 0);
    ctx.trace = {
      action,
      events,
      spins: tap.spinsBetween(action.t),
      outcome: paid ? 'settled' : 'rejected',
      capture: c ? { path: c.path, t: c.t, triggerEvent: changedAt ? 'cambio de pantalla' : 'sin cambio' } : undefined,
    };
    const verdict = detectRejection({ action, events, spins: ctx.trace.spins, calls: tap.calls.filter((x) => x.t >= action.t), screenChangedAt: changedAt });
    ctx.trace.rejection = verdict;
    ev.log('note', 'rechazo', `${verdict.outcome} (confianza ${verdict.confidence}): ${verdict.reasons.join(' · ')}`, verdict);
    if (verdict.outcome === 'charged') ev.log('note', 'hallazgo', 'la tirada se cobró en el escenario 2');
    need(verdict.outcome !== 'no-reaction', 'no hubo ninguna reacción tras el intento (ni aviso, ni evento, ni red)');
    return ['trace'];
  });

  // ---------------------------------------------------------------- F8
  await phase('F8', 'Testigo visual', async () => {
    need(ctx.trace?.capture && settledPng, 'sin captura de F7: los checks *-VISIBLE quedan FAIL');
    const witness = new ScreenWitness(ocr, ev.dir);
    const { readings, locatedRois } = await witness.read({
      capture: { png: settledPng!, t: ctx.trace!.capture!.t, triggerEvent: ctx.trace!.capture!.triggerEvent },
      fields: s1 ? ['rid', 'bet'] : ['message', 'bet'],
      rois: ctx.controls?.rois ?? {},
      config: cfg,
      recapture: () => ctx.game!.element.screenshot().catch(() => null),
    });
    ctx.visual = readings;
    for (const r of readings) ev.log('screen', `lectura ${r.field}`, `«${r.raw}» → ${r.value ?? '—'} (confianza ${r.confidence.toFixed(2)})${r.reason ? ' · ' + r.reason : ''}`, r);
    if (ctx.controls && (locatedRois.bet || locatedRois.rid)) {
      ctx.controls.rois = { ...ctx.controls.rois, ...locatedRois };
      saveControlMap(CONTROL_MAPS_DIR, ctx.controls);
    }
    return ['visual'];
  });

  // ---------------------------------------------------------------- F9
  await phase('F9', 'Cartera final', async () => {
    need(ctx.trace, 'falta trace: F7 falló');
    const ref = s1 ? ctx.trace!.events.find((e) => e.type === 'ROUND_ENDED')?.t ?? ctx.action!.t : ctx.action!.t;
    let { reading, reloaded } = await wallet.readAfter(page, ref, s1 ? T.walletS1Ms : T.walletS2Ms);
    if (!s1 && reading && !reloaded) {
      // Escenario 2: al menos un refresco completo tras el intento
      const next = await wallet.waitForChange(reading.t, T.walletS2Ms);
      if (next) reading = next;
    }
    if (reloaded) ev.log('note', 'cartera', 'no se refrescó sola: se recargó la página como haría un jugador');
    need(reading && reading.t > ref, 'cartera no actualizada a tiempo');
    ctx.betssonAfter = reading!;
    const c = await ev.capture(page, 'wallet-after', 'Betsson tras la ronda (B1)', reading!.t);
    shots.wallet = c?.path;
    return ['betssonAfter'];
  });

  // ---------------------------------------------------------------- F10-F12 (siempre)
  await phase('F10', 'Ensamblado de la ronda', async () => {
    ctx.round = buildGameRound({ cfg, scenario: cfg.scenario, initial: ctx.initial, trace: ctx.trace, visual: ctx.visual ?? [], betssonAfter: ctx.betssonAfter });
    for (const f of ctx.round.findings) ev.log('note', 'hallazgo', f);
    if (!s1 && ctx.trace?.rejection) {
      // Contrato de rechazo (borrador): lo que se vio tras el intento, para confirmar config/rejection-hypotheses.json
      const contract = completeContract(ctx.trace.rejection.contract, {
        message: ctx.visual?.find((v) => v.field === 'message'),
        gameBefore: ctx.initial?.gameBalance,
        walletBefore: ctx.initial?.betssonBefore,
        walletAfter: ctx.betssonAfter,
      });
      fs.writeFileSync(path.join(ev.dir, 'rejection-contract.json'), JSON.stringify(redact({ outcome: ctx.trace.rejection.outcome, confidence: ctx.trace.rejection.confidence, reasons: ctx.trace.rejection.reasons, signals: ctx.trace.rejection.signals, contract }), null, 2));
      return ['round', 'rejection-contract'];
    }
    return ['round'];
  }, { always: true });

  await phase('F11', 'Validación', async () => {
    const checks = evaluateChecks({ cfg, scenario: cfg.scenario, round: ctx.round ?? null, initial: ctx.initial, trace: ctx.trace, visual: ctx.visual ?? [], evidence: shots });
    ctx.checks = completeChecks(checks, cfg, cfg.scenario, halted ?? 'el check no se generó');
    return ['checks'];
  }, { always: true });

  if (tracing) {
    const file = args.testInfo?.outputPath('trace.zip');
    await context.tracing.stop(file ? { path: file } : undefined).catch(() => {});
  }
  await ocr.terminate();

  await phase('F12', 'Evidencia e informe', async () => {
    ev.writeTimeline();
    return ['report'];
  }, { always: true });

  return buildRunReport({
    cfg,
    startedAt,
    finishedAt: new Date().toISOString(),
    phases: ctx.phases,
    checks: ctx.checks ?? completeChecks([], cfg, cfg.scenario, halted ?? 'error interno'),
    round: ctx.round ?? null,
    visual: ctx.visual ?? [],
    sender: bus.state.sender,
    ev,
  });
}
