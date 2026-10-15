/**
 * Modo simulado (DISENO.md §6): mismo RunReport que el modo real, con datos de las rondas reales
 * de SOLUCION.md §2.4. Pinta un "juego falso" con CRÉDITO, APUESTA, #rid y el aviso, y lo lee el
 * testigo visual de verdad (OCR real); las reglas son las mismas que en el modo real.
 * SIMULATION=pass (por defecto) | mixed (un FAIL visual a propósito para ver cómo se pinta).
 */
import type { Page } from '@playwright/test';
import type { PhaseStatus, RunConfig, RunReport, StandardEvent } from '../contracts/schemas';
import { REPORTS_DIR } from '../config/RunConfig';
import { buildGameRound, type InitialState, type RoundTrace } from '../domain/GameRound';
import { Evidence } from '../evidence/Evidence';
import { buildRunReport } from '../report/Report';
import { completeChecks, evaluateChecks } from '../validation/rules';
import { OcrEngine } from '../vision/OcrEngine';
import { locateRois } from '../vision/RoiLocator';
import { ScreenWitness } from '../vision/ScreenWitness';

const RID = '658268119';

function fakeGameHtml(o: { credit: string; bet: string; rid?: string; message?: string[] }) {
  return `<!doctype html><html><body style="margin:0;background:#000"><canvas id="c" width="1280" height="720"></canvas><script>
const c=document.getElementById('c'),x=c.getContext('2d');
const g=x.createLinearGradient(0,0,0,720);g.addColorStop(0,'#2a0b45');g.addColorStop(1,'#0b2a45');x.fillStyle=g;x.fillRect(0,0,1280,720);
['#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6'].forEach((col,i)=>{x.fillStyle=col;x.fillRect(190+i*185,90,165,470)});
x.fillStyle='#0d0d14';x.fillRect(0,630,1280,90);
x.fillStyle='#ffffff';x.font='bold 30px DejaVu Sans, Arial, sans-serif';
x.fillText('CRÉDITO ${o.credit}',360,688);x.fillText('APUESTA ${o.bet}',800,688);
${o.rid ? `x.font='20px DejaVu Sans, Arial, sans-serif';x.fillStyle='#d0d0d0';x.fillText('#${o.rid}',18,708);` : ''}
${o.message ? `x.fillStyle='rgba(0,0,0,.6)';x.fillRect(0,0,1280,630);x.fillStyle='#ffffff';x.fillRect(340,220,600,200);x.fillStyle='#111';x.font='bold 34px DejaVu Sans, Arial, sans-serif';x.fillText(${JSON.stringify(o.message[0])},380,300);x.font='24px DejaVu Sans, Arial, sans-serif';x.fillText(${JSON.stringify(o.message[1] ?? '')},380,355);` : ''}
</script></body></html>`;
}

export async function simulateScenario(args: { page: Page; cfg: RunConfig }): Promise<RunReport> {
  const { page, cfg } = args;
  const mixed = process.env.SIMULATION === 'mixed';
  const s1 = cfg.scenario === 'completed-spin';
  const startedAt = new Date().toISOString();
  const ev = new Evidence(REPORTS_DIR, `${cfg.market}-${cfg.scenario}`);
  const phases: PhaseStatus[] = [];
  const ok = (phase: PhaseStatus['phase'], name: string, produced: string[], t0 = Date.now()) => phases.push({ phase, name, status: 'ok', startedAt: t0, endedAt: Date.now(), produced });

  const ocr = new OcrEngine();
  await ocr.init(cfg.ocr.languages);
  ok('F0', 'Preparación', ['config', ocr.ready ? 'ocr' : 'ocr: no disponible']);
  for (const [p, n] of [['F1', 'Sesión'], ['F2', 'Escucha'], ['F3', 'Juego listo'], ['F4', 'Controles'], ['F5', 'Estado inicial'], ['F6', 'Acción del jugador']] as const) ok(p, n, ['simulado']);

  const t = Date.now();
  const e = (type: StandardEvent['type'], name: string, data: StandardEvent['data'], dt: number): StandardEvent => ({ type, name, data, t: t + dt, raw: { simulated: true }, sender: 'vs20bblup_cv116', origin: 'https://simulado' });
  const wallet = (amount: number, dt: number) => ({ amount, currency: cfg.currency, t: t + dt, source: 'api' as const });

  await page.setViewportSize({ width: 1280, height: 720 });
  let initial: InitialState;
  let trace: RoundTrace;
  let after;
  if (s1) {
    // Ronda real …658268119: apuesta 4,00 €, premio 0, 62,50 → 58,50
    initial = { betssonBefore: wallet(6250, -5000), gameBalance: 6250, currentBet: 400, currency: cfg.currency, capturedAt: t - 1000 };
    const events = [e('ROUND_STARTED', 'gameRoundStarted', { bet: 400, balanceBefore: 6250 }, 120), e('SPIN_ENDED', 'spinEnded', { win: 0, balanceAfter: 5850 }, 2600), e('ROUND_ENDED', 'resultShown', { win: 0, balanceAfter: 5850 }, 3100)];
    await page.setContent(fakeGameHtml({ credit: '58,50 €', bet: '4,00 €', rid: mixed ? '658268779' : RID }));
    const cap = await ev.capture(page, 'settled', 'Pantalla liquidada (resultShown) · simulada', t + 3100);
    trace = { action: { action: 'spin', method: 'key', key: 'Space', t: t + 50, confirmedBy: events[0] }, events, spins: [{ rid: RID, bet: 400, balanceAfterSpin: 5850, win: 0, needsCollect: false, status: 200, t: t + 400 }], outcome: 'settled', capture: cap ? { path: cap.path, t: cap.t, triggerEvent: 'ROUND_ENDED' } : undefined };
    after = wallet(5850, 30_000);
  } else {
    // Saldo 0,10 €, apuesta 0,20 €: rechazo con "Saldo insuficiente", saldos sin cambios
    initial = { betssonBefore: wallet(10, -5000), gameBalance: 10, currentBet: 20, currency: cfg.currency, capturedAt: t - 1000 };
    const msg = mixed ? ['Insufficient funds', 'You do not have enough funds.'] : ['Saldo insuficiente', 'No tienes suficiente saldo.'];
    await page.setContent(fakeGameHtml({ credit: '0,10 €', bet: '0,20 €', message: msg }));
    const cap = await ev.capture(page, 'rejected', 'Aviso tras el intento · simulado', t + 900);
    trace = { action: { action: 'spin', method: 'key', key: 'Space', t: t + 50 }, events: [], spins: [], outcome: 'rejected', capture: cap ? { path: cap.path, t: cap.t, triggerEvent: 'cambio de pantalla' } : undefined };
    after = wallet(10, 40_000);
  }
  for (const x of trace.events) ev.log('event', `${x.type} ← ${x.name}`, JSON.stringify(x.data), undefined, x.t);
  ok('F7', s1 ? 'Ronda y liquidación' : 'Rechazo', ['simulado']);

  // F8 real: el testigo visual lee el juego falso
  const t8 = Date.now();
  const png = await page.screenshot();
  const rois = ocr.ready ? await locateRois(ocr, png, cfg) : {};
  const witness = new ScreenWitness(ocr, ev.dir);
  const { readings } = await witness.read({ capture: { png, t: trace.capture?.t ?? t, triggerEvent: trace.capture?.triggerEvent ?? '' }, fields: s1 ? ['rid', 'bet'] : ['message', 'bet'], rois: { rid: rois.rid, bet: rois.bet?.[0] }, config: cfg });
  for (const r of readings) ev.log('screen', `lectura ${r.field}`, `«${r.raw}» → ${r.value ?? '—'} (confianza ${r.confidence.toFixed(2)})${r.reason ? ' · ' + r.reason : ''}`);
  phases.push({ phase: 'F8', name: 'Testigo visual', status: 'ok', startedAt: t8, endedAt: Date.now(), produced: ['visual'] });
  await ocr.terminate();
  ok('F9', 'Cartera final', ['simulado']);

  const round = buildGameRound({ cfg, scenario: cfg.scenario, initial, trace, visual: readings, betssonAfter: after });
  ok('F10', 'Ensamblado de la ronda', ['round']);
  const checks = completeChecks(
    evaluateChecks({ cfg, scenario: cfg.scenario, round, initial, trace, visual: readings, evidence: { settled: trace.capture?.path, rejected: trace.capture?.path } }),
    cfg, cfg.scenario, 'no generado',
  );
  ok('F11', 'Validación', ['checks']);
  ev.writeTimeline();
  ok('F12', 'Evidencia e informe', ['report']);
  return buildRunReport({ cfg, startedAt, finishedAt: new Date().toISOString(), phases, checks, round, visual: readings, sender: 'vs20bblup_cv116', ev });
}
