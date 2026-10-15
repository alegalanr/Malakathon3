#!/usr/bin/env node
/**
 * P5 (DISENO.md §4): junta los artefactos report-<market>-<scenario> en site/:
 * index.html (matriz check × ejecución), runs/<market>-<scenario>/… (copia de cada informe) y summary.md.
 * Uso: node scripts/merge-reports.mjs <carpeta-descargada> <site>
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , inDir = 'downloaded', outDir = 'site'] = process.argv;
const SCENARIOS = { 'completed-spin': 'Tirada completada', 'insufficient-balance': 'Saldo insuficiente' };
const MARKETS = (process.env.MARKETS ?? 'es').split(',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function findReports(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findReports(p));
    else if (e.name === 'report.json') out.push(p);
  }
  return out;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'runs'), { recursive: true });

const runs = {};
const warnings = [];
for (const file of findReports(inDir)) {
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    warnings.push(`${file}: JSON inválido`);
    continue;
  }
  if (r.schemaVersion !== 1) warnings.push(`${r.market}-${r.scenario}: schemaVersion ${r.schemaVersion} (se esperaba 1)`);
  const key = `${r.market}-${r.scenario}`;
  // Se publica solo el informe y sus evidencias (nunca playwright-report ni trazas, D9)
  const src = path.dirname(file);
  const dst = path.join(outDir, 'runs', key);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['report.json', 'report.html']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  if (fs.existsSync(path.join(src, 'evidence'))) fs.cpSync(path.join(src, 'evidence'), path.join(dst, 'evidence'), { recursive: true });
  runs[key] = r;
}

const cols = MARKETS.flatMap((m) => Object.keys(SCENARIOS).map((s) => ({ m, s, key: `${m}-${s}` })));
const checkIds = [...new Set(Object.values(runs).flatMap((r) => r.checks.map((c) => c.id)))].sort();
const anySimulated = Object.values(runs).some((r) => r.mode === 'simulated');
const verdict = (r) => (r && r.checks.length && r.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL');

const rows = checkIds
  .map((id) => {
    const title = Object.values(runs).flatMap((r) => r.checks).find((c) => c.id === id)?.title ?? id;
    return `<tr><th>${esc(title)}<br><code>${esc(id)}</code></th>${cols
      .map(({ key }) => {
        const c = runs[key]?.checks.find((x) => x.id === id);
        if (!runs[key]) return '<td class="muted">sin informe</td>';
        if (!c) return '<td class="muted">—</td>';
        return `<td class="${c.result === 'PASS' ? 'ok' : 'ko'}"><a href="runs/${key}/report.html">${c.result === 'PASS' ? '✅ PASS' : '❌ FAIL'}</a></td>`;
      })
      .join('')}</tr>`;
  })
  .join('\n');

const ctx = { run: process.env.GITHUB_RUN_ID, repo: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF_NAME, server: process.env.GITHUB_SERVER_URL ?? 'https://github.com' };
const runLink = ctx.run && ctx.repo ? `<a href="${ctx.server}/${ctx.repo}/actions/runs/${ctx.run}">ejecución ${ctx.run}</a>` : 'ejecución local';

fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación de juegos</title>
<style>:root{--bg:#fff;--fg:#1b1f24;--muted:#6a737d;--line:#d0d7de;--ok:#1a7f37;--okbg:#dafbe1;--ko:#cf222e;--kobg:#ffebe9;--warn:#9a6700;--warnbg:#fff8c5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--ok:#3fb950;--okbg:#12261e;--ko:#f85149;--kobg:#2d1214;--warn:#d29922;--warnbg:#2b2111}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:16px}
.banner{background:var(--warnbg);color:var(--warn);border:1px solid var(--warn);padding:10px 14px;border-radius:8px;font-weight:600}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
td.ok{background:var(--okbg)}td.ko{background:var(--kobg)}td a{color:inherit;font-weight:600}.muted{color:var(--muted)}</style></head><body><main>
${anySimulated ? '<p class="banner">⚠ Alguna ejecución usa datos simulados: no es una ejecución real.</p>' : ''}
${warnings.length ? `<p class="banner">⚠ ${esc(warnings.join(' · '))}</p>` : ''}
<h1>Validación de juegos · Pragmatic Play en Betsson</h1>
<p class="muted">${new Date().toISOString()} · rama ${esc(ctx.ref ?? 'local')} · ${runLink}</p>
<div class="scroll"><table><thead><tr><th>Check</th>${cols.map(({ m, s, key }) => `<th>${esc(SCENARIOS[s])} · ${esc(m)}<br>${runs[key] ? `<a href="runs/${key}/report.html">${verdict(runs[key]) === 'PASS' ? '✅' : '❌'} informe</a>${runs[key].mode === 'simulated' ? ' <span class="muted">(simulado)</span>' : ''}` : '<span class="muted">sin informe</span>'}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table></div></main></body></html>`,
);

const base = process.env.PAGES_URL ? process.env.PAGES_URL.replace(/\/$/, '') + '/' : '';
const summary = [
  `## Validación de juegos · ${MARKETS.join(', ')}`,
  anySimulated ? '> ⚠ Datos simulados en alguna ejecución.' : '',
  '| Escenario | Resultado | Checks | Informe |',
  '|---|---|---|---|',
  ...cols.map(({ m, s, key }) => {
    const r = runs[key];
    if (!r) return `| ${SCENARIOS[s]} · ${m} | ⚠ sin informe | — | — |`;
    const pass = r.checks.filter((c) => c.result === 'PASS').length;
    return `| ${SCENARIOS[s]} · ${m}${r.mode === 'simulated' ? ' (simulado)' : ''} | ${verdict(r) === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${pass}/${r.checks.length} | [abrir](${base}runs/${key}/report.html) |`;
  }),
]
  .filter(Boolean)
  .join('\n');
fs.writeFileSync(path.join(outDir, 'summary.md'), summary + '\n');
console.log(summary);
