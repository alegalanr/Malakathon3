#!/usr/bin/env node
/**
 * ¿El flujo es genérico? Compara los report.json del escenario 1 con varios juegos de Pragmatic Play.
 *
 *   GAME_NAME="…" GAME_SEARCH="…" GAME_PATH="/casino/…" npx playwright test --project=es tests/completed-spin.spec.ts
 *   cp -r reports/es-completed-spin reports/juegos/<juego>        # después de cada juego
 *   node scripts/compare-games.mjs reports/juegos/*               # → reports/juegos/comparison.md
 *
 * Por juego: sender, fases, checks, orden de los eventos de la ronda, eventos que el adaptador no conoce,
 * control con el que se giró y hallazgos. Un juego "rompe" el flujo si cambia algo de eso respecto al primero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_ORDER = ['ROUND_STARTED', 'SPIN_ENDED', 'ROUND_ENDED'];

export function profile(dir) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const tl = r.timeline ?? [];
  const types = tl.filter((e) => e.source === 'event').map((e) => e.type.split(' ')[0]);
  const fromAction = tl.findIndex((e) => e.source === 'action');
  const roundTypes = tl.slice(Math.max(0, fromAction)).filter((e) => e.source === 'event').map((e) => e.type.split(' ')[0]);
  const positions = EXPECTED_ORDER.map((x) => roundTypes.indexOf(x));
  const missing = EXPECTED_ORDER.filter((_, i) => positions[i] === -1);
  const inOrder = !missing.length && positions.every((p, i) => i === 0 || p > positions[i - 1]);
  const unknown = [...new Set(types.filter((t) => t.startsWith('UNKNOWN(')).map((t) => t.slice(8, -1)))];
  const spin = tl.find((e) => e.source === 'action' && e.type === 'spin');
  const failedPhase = r.phases.find((p) => p.status === 'failed');
  return {
    game: r.game.name,
    dir,
    mode: r.mode,
    sender: r.game.sender ?? '—',
    phases: failedPhase ? `${failedPhase.phase} falló: ${failedPhase.reason}` : 'todas ok',
    checks: `${r.checks.filter((c) => c.result === 'PASS').length}/${r.checks.length}`,
    failed: r.checks.filter((c) => c.result === 'FAIL').map((c) => c.id),
    order: inOrder ? 'OK' : missing.length ? `falta ${missing.join(', ')}` : 'desordenado',
    unknown,
    spinControl: spin?.summary ?? '—',
    doSpin: tl.some((e) => e.source === 'network' && e.type === 'doSpin'),
    findings: tl.filter((e) => e.source === 'note' && e.type === 'hallazgo').map((e) => e.summary),
  };
}

export function compare(profiles) {
  const [ref, ...rest] = profiles;
  const differences = [];
  for (const p of rest) {
    if (p.order !== ref.order) differences.push(`${p.game}: orden de eventos «${p.order}» frente a «${ref.order}» en ${ref.game}`);
    if (p.doSpin !== ref.doSpin) differences.push(`${p.game}: doSpin ${p.doSpin ? 'sí' : 'no'} en la red`);
    if (p.spinControl !== ref.spinControl) differences.push(`${p.game}: se giró con «${p.spinControl}» (en ${ref.game}, «${ref.spinControl}»)`);
    const extra = p.unknown.filter((u) => !ref.unknown.includes(u));
    if (extra.length) differences.push(`${p.game}: eventos que ${ref.game} no tiene: ${extra.join(', ')}`);
  }
  const generic = profiles.every((p) => p.order === 'OK' && p.doSpin) && !differences.length;
  return { generic, differences };
}

export function render(profiles, result) {
  const yn = (b) => (b ? 'sí' : 'no');
  const row = (label, f) => `| ${label} | ${profiles.map(f).join(' | ')} |`;
  return [
    '# Comparación de juegos de Pragmatic Play (escenario 1)',
    '',
    `**¿Flujo genérico?** ${result.generic ? '✅ sí: mismo orden de eventos, misma red y mismo control' : '⚠️ no del todo, ver diferencias'}`,
    '',
    `| | ${profiles.map((p) => p.game).join(' | ')} |`,
    `|---|${profiles.map(() => '---').join('|')}|`,
    row('Modo', (p) => p.mode),
    row('sender', (p) => `\`${p.sender}\``),
    row('Fases', (p) => p.phases),
    row('Checks PASS', (p) => p.checks + (p.failed.length ? ` (FAIL: ${p.failed.join(', ')})` : '')),
    row('Orden ROUND_STARTED → SPIN_ENDED → ROUND_ENDED', (p) => p.order),
    row('doSpin en la red', (p) => yn(p.doSpin)),
    row('Control de girar', (p) => p.spinControl),
    row('Eventos no traducidos', (p) => p.unknown.join(', ') || '—'),
    row('Hallazgos', (p) => p.findings.join('; ') || '—'),
    '',
    '## Diferencias',
    '',
    ...(result.differences.length ? result.differences.map((d) => `- ${d}`) : ['- Ninguna']),
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2).filter((d) => fs.existsSync(path.join(d, 'report.json')));
  if (dirs.length < 2) {
    console.error('Uso: node scripts/compare-games.mjs <carpeta-juego-1> <carpeta-juego-2> [...] (cada una con report.json)');
    process.exit(2);
  }
  const profiles = dirs.map(profile);
  const result = compare(profiles);
  const out = path.join(path.dirname(dirs[0]), 'comparison.md');
  fs.writeFileSync(out, render(profiles, result));
  console.log(`${result.generic ? '✅ Flujo genérico' : '⚠️ Hay diferencias'} · ${out}`);
  for (const d of result.differences) console.log(`  - ${d}`);
}
