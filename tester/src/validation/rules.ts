/**
 * F11: reglas puras GameRound → Check[] (SOLUCION.md §5, IDs de DISENO.md §7.3).
 * Regla general: FAIL si falta la fuente obligatoria, si la regla no se cumple o si dos fuentes se contradicen.
 */
import { expectedFor } from '../contracts/expectedChecks';
import type { Cents, Check, GameRound, RunConfig, Scenario, Source, VisualReading } from '../contracts/schemas';
import { formatCents } from '../domain/Money';
import { ridMatches, type InitialState, type RoundTrace } from '../domain/GameRound';

export interface RuleInput {
  cfg: RunConfig;
  scenario: Scenario;
  round: GameRound | null;
  initial?: InitialState;
  trace?: RoundTrace;
  visual: VisualReading[];
  evidence: { settled?: string; rejected?: string; idle?: string; wallet?: string };
}

export function evaluateChecks(inp: RuleInput): Check[] {
  const { cfg, scenario } = inp;
  const fmt = (c: Cents | undefined) => formatCents(c, cfg);
  const out: Check[] = [];
  const add = (id: string, pass: boolean, expected: string, observed: string, sources: Source[], evidence: (string | undefined)[], message: string) => {
    const meta = expectedFor(scenario).find((c) => c.id === id)!;
    out.push({ id, title: meta.title, scenario, market: cfg.market, result: pass ? 'PASS' : 'FAIL', expected, observed, sources, evidence: evidence.filter((e): e is string => !!e), message });
  };
  const r = inp.round;
  const vis = (f: VisualReading['field']) => inp.visual.find((v) => v.field === f);
  const visualProblem = (v: VisualReading | undefined): string | null => {
    if (!v) return 'testigo visual no disponible';
    if (v.value === null) return `testigo visual no legible: ${v.reason ?? 'sin lectura'}`;
    if (v.confidence < cfg.ocr.minConfidence) return `testigo visual no legible: confianza ${v.confidence.toFixed(2)} < ${cfg.ocr.minConfidence}`;
    return null;
  };
  const ev = inp.evidence;

  if (scenario === 'completed-spin') {
    const started = inp.trace?.events.find((e) => e.type === 'ROUND_STARTED');
    add('S1-ROUND-STARTED', !!started && started.t >= (inp.trace?.action.t ?? Infinity),
      'ROUND_STARTED después de la acción del jugador',
      started ? `ROUND_STARTED a los ${started.t - inp.trace!.action.t} ms (${inp.trace!.action.method}${inp.trace!.action.key ? ' ' + inp.trace!.action.key : ''})` : 'no llegó',
      ['event'], [ev.idle], started ? 'El juego confirmó con su evento que la tirada empezó por nuestra acción' : 'La acción no provocó ROUND_STARTED: un clic no es prueba de nada');

    const spinEnded = inp.trace?.events.find((e) => e.type === 'SPIN_ENDED');
    const ended = inp.trace?.events.find((e) => e.type === 'ROUND_ENDED');
    add('S1-ROUND-ENDED', !!spinEnded && !!ended, 'SPIN_ENDED y ROUND_ENDED (resultShown)',
      `${spinEnded ? 'SPIN_ENDED' : 'sin SPIN_ENDED'} · ${ended ? 'ROUND_ENDED' : 'sin ROUND_ENDED'}`, ['event'], [ev.settled],
      spinEnded && ended ? 'La ronda terminó y el resultado se mostró al jugador' : 'La ronda no llegó al momento liquidado');

    // Apuesta usada: evento = c×l (obligatorias) y = último BET_CHANGED (opcional)
    const be = r?.bet.event;
    const bn = r?.bet.network;
    const lastChanged = inp.initial?.currentBet;
    const usedOk = be !== undefined && bn !== undefined && be === bn && (lastChanged === undefined || lastChanged === be) && be <= cfg.maxBet;
    add('S1-BET-USED', usedOk, `evento = c×l de doSpin${lastChanged !== undefined ? ' = último BET_CHANGED' : ''} ≤ ${fmt(cfg.maxBet)}`,
      `evento ${fmt(be)} · red ${fmt(bn)}${lastChanged !== undefined ? ` · BET_CHANGED ${fmt(lastChanged)}` : ''}`, ['event', 'network'], [],
      be === undefined || bn === undefined ? 'Falta una fuente obligatoria de la apuesta' : usedOk ? 'Todas las fuentes coinciden' : be > cfg.maxBet ? 'La apuesta supera la máxima configurada' : 'Las fuentes de la apuesta se contradicen');

    const vb = vis('bet');
    const vbProblem = visualProblem(vb);
    const bs = r?.bet.screen;
    add('S1-BET-VISIBLE', !vbProblem && bs !== undefined && bs === be && bs === bn, `${fmt(be)} en pantalla (= evento = red)`,
      vb ? `«${vb.raw}» → ${fmt(bs)} (confianza ${vb.confidence.toFixed(2)})` : 'sin lectura', ['screen', 'event', 'network'], [vb?.cropPath, ev.settled],
      vbProblem ?? (bs === be && bs === bn ? 'La apuesta que ve el jugador es la que se cobró' : 'La apuesta mostrada no coincide con la usada'));

    const curOk = currencyCheck(r, cfg);
    add('S1-CURRENCY', curOk.pass, cfg.currency, curOk.observed, ['event', 'wallet', 'screen'], [vb?.cropPath], curOk.message);

    const b0 = r?.balanceBefore.event;
    const w = r?.win.event;
    const after = r?.balanceAfter.event;
    const net = r?.balanceAfter.network;
    const exp = b0 !== undefined && be !== undefined && w !== undefined ? b0 - be + w : undefined;
    const gameOk = exp !== undefined && after === exp && (net === undefined || net === after);
    add('S1-GAME-BALANCE', gameOk && net !== undefined, `${fmt(exp)} = ${fmt(b0)} − ${fmt(be)} + ${fmt(w)}`, `evento ${fmt(after)} · red ${fmt(net)}`, ['event', 'network'], [ev.settled],
      exp === undefined || after === undefined ? 'Faltan datos de los eventos de inicio o fin' : net === undefined ? 'Falta el saldo de la red (doSpin/doCollect)' : gameOk ? 'Cuadra con la fórmula y con el servidor' : 'No cuadra');

    const B0 = r?.betsson.before;
    const B1 = r?.betsson.after;
    const expB1 = B0 && be !== undefined && w !== undefined ? B0.amount - be + w : undefined;
    const refT = ended?.t ?? 0;
    const fresh = !!B1 && B1.t > refT;
    add('S1-BETSSON-BALANCE', expB1 !== undefined && !!B1 && fresh && B1.amount === expB1, `${fmt(expB1)} = ${fmt(B0?.amount)} − ${fmt(be)} + ${fmt(w)}`, B1 ? `${fmt(B1.amount)}${fresh ? '' : ' (lectura anterior a la ronda)'}` : 'sin lectura posterior', ['wallet'], [ev.wallet],
      !B0 ? 'Falta B0' : !B1 ? 'Cartera no actualizada a tiempo' : !fresh ? 'La lectura de cartera es anterior al fin de la ronda' : B1.amount === expB1 ? 'La cartera tras la ronda coincide con la fórmula' : 'La cartera no cuadra con la ronda');

    const vr = vis('rid');
    const vrProblem = visualProblem(vr);
    const rn = r?.rid.network;
    const rs = r?.rid.screen;
    add('S1-RID-VISIBLE', !vrProblem && !!rn && !!rs && ridMatches(rs, rn), `#${rn ?? '—'} (rid de doSpin)`, vr ? `«${vr.raw}» → ${rs ?? '—'}` : 'sin lectura', ['screen', 'network'], [vr?.cropPath, ev.settled],
      vrProblem ?? (!rn ? 'Falta el rid de la red' : ridMatches(rs!, rn) ? 'La ronda que vio el jugador es la que procesó el servidor' : 'El rid de la pantalla no es el de la red'));
  } else {
    const startedPaid = inp.trace?.events.filter((e) => e.type === 'ROUND_STARTED' && (e.data.bet ?? 0) > 0) ?? [];
    const paidSpins = inp.trace?.spins.filter((s) => !s.error) ?? [];
    const rejectedEv = inp.trace?.events.find((e) => e.type === 'REJECTED');
    add('S2-REJECTED', !!inp.trace && startedPaid.length === 0 && paidSpins.length === 0, 'ningún ROUND_STARTED con cobro ni doSpin cobrado',
      `${startedPaid.length} ROUND_STARTED · ${paidSpins.length} doSpin cobrados${rejectedEv ? ' · evento de rechazo' : ''}`, ['event', 'network'], [ev.rejected],
      !inp.trace ? 'No se llegó a intentar la tirada' : startedPaid.length || paidSpins.length ? 'La tirada se cobró' : 'La tirada no se completó como tirada pagada');

    const vm = vis('message');
    const vmProblem = visualProblem(vm);
    const langOk = vm?.language === cfg.language;
    add('S2-MSG-LANG-VISIBLE', !vmProblem && langOk, `aviso de saldo insuficiente en «${cfg.language}» (${cfg.texts.insufficientBalance.join(' / ')})`,
      vm ? `«${vm.raw.slice(0, 120)}» → idioma ${vm.language ?? 'no reconocido'}` : 'sin lectura', ['screen'], [vm?.cropPath, ev.rejected],
      vmProblem ?? (langOk ? 'El jugador ve el aviso en el idioma del mercado' : 'El aviso no está en el idioma esperado o no es de saldo insuficiente'));

    const vb = vis('bet');
    const vbProblem = visualProblem(vb);
    const tried = inp.initial?.currentBet;
    add('S2-BET-VISIBLE', !vbProblem && tried !== undefined && r?.bet.screen === tried, `${fmt(tried)} (último BET_CHANGED)`, vb ? `«${vb.raw}» → ${fmt(r?.bet.screen)}` : 'sin lectura', ['screen', 'event'], [vb?.cropPath, ev.rejected],
      vbProblem ?? (tried === undefined ? 'No se conoce la apuesta intentada (sin BET_CHANGED)' : r?.bet.screen === tried ? 'La apuesta mostrada es la intentada' : 'No coincide'));

    const curOk = currencyCheck(r, cfg);
    add('S2-CURRENCY', curOk.pass, cfg.currency, curOk.observed, ['event', 'wallet', 'screen'], [vb?.cropPath], curOk.message);

    const B0 = r?.betsson.before;
    const B1 = r?.betsson.after;
    add('S2-BETSSON-UNCHANGED', !!B0 && !!B1 && B1.amount === B0.amount && B1.t > (inp.trace?.action.t ?? Infinity), `${fmt(B0?.amount)} (sin cambios)`, B1 ? fmt(B1.amount) : 'sin lectura posterior', ['wallet'], [ev.wallet],
      !B0 || !B1 ? 'Falta una lectura de cartera' : B1.amount === B0.amount ? 'La cartera no cambió' : 'La cartera cambió');

    const gb = inp.initial?.gameBalance;
    const changed = inp.trace?.events.filter((e) => e.type === 'BALANCE' && e.data.amount !== gb) ?? [];
    add('S2-GAME-UNCHANGED', gb !== undefined && !!inp.trace && changed.length === 0, `${fmt(gb)} (ningún BALANCE distinto)`, changed.length ? `${changed.length} BALANCE distintos (${fmt(changed[0].data.amount)})` : fmt(gb), ['event'], [],
      gb === undefined ? 'No se conoce el saldo del juego antes' : changed.length ? 'El saldo del juego cambió' : 'El saldo del juego no cambió');
  }
  return out;
}

function currencyCheck(r: GameRound | null, cfg: RunConfig) {
  const c = r?.currency ?? {};
  const observed = `juego ${c.event ?? '—'} · cartera ${c.wallet ?? '—'} · pantalla ${c.screen ?? '—'}`;
  if (!c.event || !c.wallet) return { pass: false, observed, message: 'Falta la moneda del juego o de la cartera (obligatorias)' };
  const all = [c.event, c.wallet, c.screen].filter(Boolean);
  const pass = all.every((x) => x === cfg.currency);
  return { pass, observed, message: pass ? (c.screen ? 'Todas las fuentes muestran la moneda del mercado' : 'Juego y cartera en la moneda del mercado (símbolo en pantalla no leído)') : 'Alguna fuente muestra otra moneda' };
}

/** D13: los checks esperados que falten salen como FAIL "no evaluado". */
export function completeChecks(checks: Check[], cfg: RunConfig, scenario: Scenario, why: string): Check[] {
  const have = new Set(checks.map((c) => c.id));
  const missing: Check[] = expectedFor(scenario)
    .filter((e) => !have.has(e.id))
    .map((e) => ({ id: e.id, title: e.title, scenario, market: cfg.market, result: 'FAIL', expected: '—', observed: 'no evaluado', sources: e.sources, evidence: [], message: `No evaluado: ${why}` }));
  return [...checks, ...missing];
}
