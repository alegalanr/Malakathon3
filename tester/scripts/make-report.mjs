#!/usr/bin/env node
/**
 * Informe de entrega (requisito "Report and evidence" del reto): PASS/FAIL de cada check, por escenario y
 * mercado, con los checks de saldo de Betsson destacados y las capturas que lo demuestran.
 *
 * Lee reports/<mercado>-<escenario>/report.json (lo que deja cada ejecución) y escribe:
 *   informe/INFORME.md                          ← el informe
 *   informe/<mercado>-<escenario>/               ← report.html, report.json y evidence/
 *
 * Uso (desde tester/):  node scripts/make-report.mjs [reports] [informe]
 * Con Docker:           docker compose -f tester/compose.yaml run --rm tester node scripts/make-report.mjs
 *
 * Nunca copia la traza de Playwright (trace.zip): lleva instantáneas de la página con la cuenta (D9).
 * Las capturas de una ejecución real ya pasan por la revisión de privacidad, pero hay que mirarlas a mano
 * antes de subir la carpeta informe/ al repo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , inDir = 'reports', outDir = 'informe'] = process.argv;
const MAX_BYTES = 2 * 1024 * 1024; // AGENTS.md: nada de más de 2 MB en el repo
const SCENARIOS = { 'completed-spin': 'Escenario 1 · Tirada completada', 'insufficient-balance': 'Escenario 2 · Saldo insuficiente' };
const BALANCE = new Set(['S1-BETSSON-BALANCE', 'S2-BETSSON-UNCHANGED']);
const SOURCES = { event: 'eventos del juego', network: 'red', wallet: 'cartera Betsson', screen: 'pantalla (OCR)' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const res = (r) => (r === 'PASS' ? '✅ PASS' : '❌ FAIL');

const runs = [];
for (const key of fs.existsSync(inDir) ? fs.readdirSync(inDir).sort() : []) {
  const file = path.join(inDir, key, 'report.json');
  if (!fs.existsSync(file)) continue;
  try {
    runs.push({ key, dir: path.join(inDir, key), r: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch {
    console.warn(`⚠ ${file}: JSON inválido, se omite`);
  }
}
if (!runs.length) {
  console.error(`✘ No hay informes en ${inDir}/. Ejecuta antes los escenarios (npx playwright test --project=es).`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Copia de cada ejecución (sin ficheros de más de 2 MB ni trazas)
const skipped = [];
for (const { key, dir } of runs) {
  const dst = path.join(outDir, key);
  const copy = (src, to) => {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(to, f));
    } else if (/\.zip$/i.test(src)) skipped.push(`${src} (traza: no se publica)`);
    else if (fs.statSync(src).size > MAX_BYTES) skipped.push(`${src} (más de 2 MB)`);
    else fs.copyFileSync(src, to);
  };
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['report.html', 'report.json', 'evidence']) copy(path.join(dir, f), path.join(dst, f));
}

/** Contra qué se ejecutó: nunca se presenta una maqueta o una simulación como la web real. */
const kind = (r) => (r.mode !== 'real' ? 'simulado' : r.market === 'mock' ? 'maqueta local' : `real · betsson.${r.market}`);
const kinds = [...new Set(runs.map(({ r }) => kind(r)))];
const all = runs.flatMap(({ key, r }) => r.checks.map((c) => ({ ...c, key, mode: r.mode })));
const evLinks = (c) =>
  c.evidence.length ? c.evidence.map((e) => `[${path.basename(e)}](${c.key}/${e})`).join(' · ') : `[línea de tiempo](${c.key}/report.html)`;

const L = [];
L.push('# Informe de validación · Pragmatic Play en Betsson', '');
const NOTE = {
  simulado: '**Simulado**: juego falso dibujado en el navegador, OCR real. Sirve para ver el formato y que el validador caza los fallos.',
  'maqueta local':
    '**Maqueta local** de Betsson + Pragmatic Play (`tester/mock/`, la del centro de control) con el validador en **modo real**: el mismo código, fases y checks que contra betsson.es (login, Real Play, eventos `postMessage`, `doSpin`/`doCollect`, cartera `/api/v2/wallet/balance`). No es dinero real.',
};
for (const k of kinds) L.push(`> ${NOTE[k] ?? `**Real**: betsson.${k.split('betsson.')[1]} con las cuentas de prueba de Betsson.`}`, '');
L.push(`Generado el ${new Date().toISOString()} con \`tester/scripts/make-report.mjs\` a partir de \`tester/reports/*/report.json\`.`, '');

L.push('## Resumen', '');
L.push('| Escenario | Mercado | Contra qué | Juego | Resultado | Checks | Informe completo |', '|---|---|---|---|---|---|---|');
for (const { key, r } of runs) {
  const pass = r.checks.filter((c) => c.result === 'PASS').length;
  const ok = r.checks.length && pass === r.checks.length;
  L.push(`| ${SCENARIOS[r.scenario] ?? r.scenario} | ${r.market} | ${kind(r)} | ${cell(r.game?.name)} | ${ok ? '✅ PASS' : '❌ FAIL'} | ${pass}/${r.checks.length} | [report.html](${key}/report.html) |`);
}
L.push('');

L.push('## Saldo de Betsson', '');
L.push('Regla del escenario 1: `saldo después = saldo antes − apuesta + premio`. Escenario 2: el saldo no cambia. Se lee de la cartera de Betsson (su API), no del juego.', '');
L.push('| Check | Escenario | Mercado | Resultado | Esperado | Observado |', '|---|---|---|---|---|---|');
for (const c of all.filter((x) => BALANCE.has(x.id))) L.push(`| \`${c.id}\` | ${c.scenario} | ${c.market} | ${res(c.result)} | ${cell(c.expected)} | ${cell(c.observed)} |`);
L.push('');

L.push('## Todos los checks', '');
L.push('| Check | Qué comprueba | Escenario | Mercado | Resultado | Esperado | Observado | Fuentes | Evidencia |', '|---|---|---|---|---|---|---|---|---|');
for (const c of all) {
  L.push(
    `| \`${c.id}\` | ${cell(c.title)} | ${c.scenario} | ${c.market} | ${res(c.result)} | ${cell(c.expected)} | ${cell(c.observed)} | ${c.sources.map((s) => SOURCES[s] ?? s).join(', ')} | ${evLinks(c)} |`,
  );
}
L.push('');

const failed = all.filter((c) => c.result !== 'PASS');
if (failed.length) {
  L.push('## Por qué falla', '');
  for (const c of failed) L.push(`- \`${c.id}\` (${c.scenario} · ${c.market}): ${cell(c.message)}`);
  for (const { r } of runs) for (const p of r.phases.filter((x) => x.status !== 'ok')) L.push(`- Fase ${p.phase} ${cell(p.name)} (${r.scenario}): ${p.status}${p.reason ? ` · ${cell(p.reason)}` : ''}`);
  L.push('');
}

L.push('## Evidencias', '');
for (const { key, r } of runs) {
  L.push(`### ${SCENARIOS[r.scenario] ?? r.scenario} · ${r.market}`, '');
  for (const s of r.artifacts?.screenshots ?? []) L.push(`**${cell(s.label)}**`, '', `![${cell(s.label)}](${key}/${s.path})`, '');
  const crops = fs.existsSync(path.join(outDir, key, 'evidence')) ? fs.readdirSync(path.join(outDir, key, 'evidence')).filter((f) => f.startsWith('crop-')) : [];
  if (crops.length) {
    L.push('Recortes que leyó el OCR (rid, apuesta, mensaje):', '');
    for (const f of crops) L.push(`![${f}](${key}/evidence/${f})`);
    L.push('');
  }
  L.push(`Traza de la ejecución (eventos del juego, red, cartera y lecturas de pantalla con sus tiempos): línea de tiempo de [report.html](${key}/report.html), también en \`timeline\` de [report.json](${key}/report.json).`, '');
}

L.push('## Cómo se obtiene', '');
L.push('- Cada ejecución deja `tester/reports/<mercado>-<escenario>/` con `report.html`, `report.json` (incluye la línea de tiempo, censurada) y `evidence/`.');
L.push('- En GitHub Actions (workflow *Validate games*) se suben como artefactos y el resumen PASS/FAIL sale en la propia ejecución.');
L.push('- La traza de Playwright (`trace.zip`, con capturas de cada paso) queda solo en local, en `tester/test-results/`: lleva instantáneas de la página con la cuenta, así que no se publica.');
L.push('- Regenerar este informe: `docker compose -f tester/compose.yaml run --rm tester node scripts/make-report.mjs`.', '');

fs.writeFileSync(path.join(outDir, 'INFORME.md'), L.join('\n'));

// Misma revisión de secretos que antes de publicar en CI
try {
  execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'scan-secrets.mjs'), outDir], { stdio: 'inherit' });
} catch {
  console.error(`✘ La revisión de secretos ha encontrado algo en ${outDir}/: no lo subas.`);
  process.exit(1);
}
for (const s of skipped) console.warn(`  · no copiado: ${s}`);
console.log(`✔ ${path.join(outDir, 'INFORME.md')} (${runs.length} ejecución(es), ${all.length} checks, ${failed.length} FAIL)`);
if (runs.some(({ r }) => r.mode === 'real' && r.market !== 'mock')) console.log('  Ejecución real: revisa a mano las capturas de informe/*/evidence/ antes de subirlas.');
