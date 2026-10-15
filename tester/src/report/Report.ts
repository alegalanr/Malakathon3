/**
 * F12: RunReport (C14) → reports/<market>-<scenario>/report.json + report.html (DISENO.md §7-§8).
 * HTML autocontenido (D11): CSS dentro, sin JavaScript, rutas relativas, claro/oscuro y móvil.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expectedFor } from '../contracts/expectedChecks';
import { RunReport, type Check, type GameRound, type PhaseStatus, type RunConfig, type VisualReading } from '../contracts/schemas';
import { formatCents } from '../domain/Money';
import type { Evidence } from '../evidence/Evidence';
import { findSecrets, redact } from '../evidence/redact';
import { REPORTS_DIR } from '../config/RunConfig';

export function buildRunReport(a: {
  cfg: RunConfig;
  startedAt: string;
  finishedAt: string;
  phases: PhaseStatus[];
  checks: Check[];
  round: GameRound | null;
  visual: VisualReading[];
  sender?: string;
  ev: Evidence;
}): RunReport {
  return redact({
    schemaVersion: 1 as const,
    runId: `${a.startedAt.replace(/[:.]/g, '-')}-${a.cfg.market}-${a.cfg.scenario}`,
    mode: a.cfg.mode,
    market: a.cfg.market,
    scenario: a.cfg.scenario,
    game: { name: a.cfg.game.name, provider: 'pragmatic' as const, sender: a.sender },
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    phases: a.phases,
    checks: a.checks,
    round: a.round,
    visual: a.visual,
    timeline: a.ev.summaryTimeline(),
    artifacts: { screenshots: a.ev.screenshots },
  });
}

/** Valida C14, completa checks ausentes, escribe JSON + HTML y comprueba que no hay secretos. Devuelve la carpeta. */
export function writeRunReport(report: RunReport, cfg: RunConfig): { dir: string; secrets: string[]; contractErrors: string[] } {
  const dir = path.join(REPORTS_DIR, `${report.market}-${report.scenario}`);
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  const parsed = RunReport.safeParse(report);
  const contractErrors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const json = JSON.stringify(report, null, 2);
  const html = renderHtml(report, cfg, contractErrors, dir);
  const secrets = [...findSecrets(json), ...findSecrets(html)];
  fs.writeFileSync(path.join(dir, 'report.json'), json);
  fs.writeFileSync(path.join(dir, 'report.html'), html);
  return { dir, secrets: [...new Set(secrets)], contractErrors };
}

// ---------------------------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const SOURCE_LABEL: Record<string, string> = { event: 'Evento', network: 'Red', wallet: 'Cartera', screen: 'Pantalla', config: 'Config' };
const SCENARIO_LABEL: Record<string, string> = { 'completed-spin': 'Tirada completada', 'insufficient-balance': 'Saldo insuficiente' };

function img(dir: string, rel: string | undefined, alt: string, cls = '') {
  if (!rel) return '<span class="muted">captura no disponible</span>';
  if (!fs.existsSync(path.join(dir, rel))) return `<span class="muted">captura no disponible (${esc(rel)})</span>`;
  return `<a href="${esc(rel)}"><img class="${cls}" src="${esc(rel)}" alt="${esc(alt)}" loading="lazy"></a>`;
}

export function renderHtml(r: RunReport, cfg: RunConfig, contractErrors: string[], dir: string): string {
  const fmt = (c: number | undefined | null) => formatCents(c ?? undefined, cfg);
  const pass = r.checks.filter((c) => c.result === 'PASS').length;
  const allPass = pass === r.checks.length && r.checks.length === expectedFor(r.scenario).length;
  const dur = Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000);
  const round = r.round;
  const t0 = round?.startedAt ?? r.timeline?.[0]?.t ?? 0;

  const checkRows = r.checks
    .map(
      (c) => `<tr class="${c.result === 'PASS' ? 'ok' : 'ko'}">
  <td class="res">${c.result === 'PASS' ? '✅ PASS' : '❌ FAIL'}</td>
  <td><strong>${esc(c.title)}</strong><br><code>${esc(c.id)}</code></td>
  <td>${esc(c.expected)}</td><td>${esc(c.observed)}</td>
  <td>${c.sources.map((s) => `<span class="tag">${SOURCE_LABEL[s] ?? s}</span>`).join(' ')}</td>
  <td class="ev">${c.evidence.map((e) => img(dir, e, c.id, 'thumb')).join(' ') || '—'}</td>
</tr><tr class="msg"><td></td><td colspan="5">${esc(c.message)}</td></tr>`,
    )
    .join('\n');

  const SOURCES = ['event', 'network', 'wallet', 'screen'] as const;
  const multi = round
    ? (
        [
          ['Apuesta', round.bet, true],
          ['Premio', round.win, true],
          ['Saldo antes (juego)', round.balanceBefore, true],
          ['Saldo después (juego)', round.balanceAfter, true],
          ['Saldo Betsson', { wallet: round.betsson.before?.amount }, true],
          ['Saldo Betsson después', { wallet: round.betsson.after?.amount }, true],
          ['Moneda', round.currency, false],
          ['Ronda (rid)', round.rid, false],
        ] as [string, Record<string, unknown>, boolean][]
      )
        .map(([label, by, money]) => {
          const vals = SOURCES.map((s) => by[s]).filter((v) => v !== undefined);
          const agree = new Set(vals.map(String)).size <= 1;
          return `<tr><th>${label}</th>${SOURCES.map((s) => {
            const v = by[s];
            if (v === undefined) return '<td class="muted">—</td>';
            return `<td class="${agree ? 'agree' : 'disagree'}">${esc(money ? fmt(v as number) : v)}</td>`;
          }).join('')}</tr>`;
        })
        .join('\n')
    : '';

  const visual = r.visual
    .map(
      (v) => `<figure class="reading">${img(dir, v.cropPath, v.field, 'crop')}
<figcaption><strong>${esc(v.field)}</strong> · leído «${esc(v.raw)}» → <strong>${esc(v.value === null ? '—' : typeof v.value === 'number' && v.field === 'bet' ? fmt(v.value) : v.value)}</strong>
· confianza ${v.confidence.toFixed(2)} · ${v.attempts} intento(s)${v.language ? ` · idioma ${v.language}` : ''}${v.reason ? `<br><span class="muted">${esc(v.reason)}</span>` : ''}</figcaption></figure>`,
    )
    .join('\n');

  const shotsHtml = r.artifacts.screenshots.map((s) => `<figure>${img(dir, s.path, s.label, 'shot')}<figcaption>${esc(s.label)}</figcaption></figure>`).join('\n');

  const phases = r.phases
    .map((p) => `<li class="ph ${p.status}"><code>${p.phase}</code> ${esc(p.name)} · <strong>${p.status === 'ok' ? 'ok' : p.status === 'failed' ? 'falló' : 'no ejecutada'}</strong>${p.reason ? ` — ${esc(p.reason)}` : ''} <span class="muted">(${((p.endedAt - p.startedAt) / 1000).toFixed(1)} s)</span></li>`)
    .join('\n');

  const timeline = (r.timeline ?? [])
    .filter((e) => e.source !== 'phase')
    .map((e) => `<tr><td class="num">${((e.t - t0) / 1000).toFixed(2)} s</td><td><span class="tag">${esc(e.source)}</span></td><td>${esc(e.type)}</td><td>${esc(e.summary)}</td></tr>`)
    .join('\n');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SCENARIO_LABEL[r.scenario])} · ${esc(r.market)} · ${allPass ? 'PASS' : 'FAIL'}</title>
<style>
:root{--bg:#fff;--fg:#1b1f24;--muted:#6a737d;--card:#f6f8fa;--line:#d0d7de;--ok:#1a7f37;--okbg:#dafbe1;--ko:#cf222e;--kobg:#ffebe9;--warn:#9a6700;--warnbg:#fff8c5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--card:#161b22;--line:#30363d;--ok:#3fb950;--okbg:#12261e;--ko:#f85149;--kobg:#2d1214;--warn:#d29922;--warnbg:#2b2111}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{margin:.2em 0}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
.banner{background:var(--warnbg);color:var(--warn);border:1px solid var(--warn);padding:10px 14px;border-radius:8px;font-weight:600}
.verdict{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700}.verdict.ok{background:var(--okbg);color:var(--ok)}.verdict.ko{background:var(--kobg);color:var(--ko)}
.meta{color:var(--muted)}.muted{color:var(--muted)}code{font-size:.85em}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
tr.ok td.res{color:var(--ok);font-weight:700}tr.ko td.res{color:var(--ko);font-weight:700}tr.msg td{border-bottom:2px solid var(--line);color:var(--muted);padding-top:0}
.tag{display:inline-block;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:12px}
td.agree{background:var(--okbg)}td.disagree{background:var(--kobg)}td.num{white-space:nowrap;font-variant-numeric:tabular-nums}
img.thumb{max-width:110px;max-height:70px;border:1px solid var(--line);border-radius:4px}img.crop{max-width:100%;max-height:120px;border:1px solid var(--line);background:#fff}
img.shot{max-width:100%;border:1px solid var(--line);border-radius:6px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
figure{margin:0;background:var(--card);padding:8px;border-radius:8px}figcaption{font-size:13px;margin-top:4px}
.ph{list-style:none}.ph.failed{color:var(--ko)}.ph.skipped{color:var(--muted)}ul{padding-left:0}
</style></head><body><main>
${r.mode === 'simulated' ? '<p class="banner">⚠ Datos simulados: no es una ejecución real.</p>' : ''}
${contractErrors.length ? `<p class="banner">⚠ El informe no cumple el contrato C14: ${esc(contractErrors.join('; '))}</p>` : ''}
<h1>${esc(SCENARIO_LABEL[r.scenario])} · ${esc(r.market)} <span class="verdict ${allPass ? 'ok' : 'ko'}">${allPass ? '✅ PASS' : '❌ FAIL'}</span></h1>
<p class="meta">${esc(r.game.name)} (Pragmatic Play${r.game.sender ? `, ${esc(r.game.sender)}` : ''}) · ${esc(r.startedAt)} · ${dur} s · <code>${esc(r.runId)}</code></p>
<p><strong>${pass} de ${r.checks.length} PASS</strong></p>

<h2>Checks</h2>
<div class="scroll"><table><thead><tr><th>Resultado</th><th>Check</th><th>Esperado</th><th>Obtenido</th><th>Fuentes</th><th>Evidencias</th></tr></thead>
<tbody>${checkRows}</tbody></table></div>

${round ? `<h2>Un dato, varias fuentes</h2>
<div class="scroll"><table><thead><tr><th></th>${SOURCES.map((s) => `<th>${SOURCE_LABEL[s]}</th>`).join('')}</tr></thead><tbody>${multi}</tbody></table></div>
${round.findings.length ? `<p><strong>Hallazgos (invariantes incumplidas):</strong></p><ul>${round.findings.map((f) => `<li>⚠ ${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">Sin hallazgos: todas las invariantes se cumplen.</p>'}` : ''}

<h2>Lo que vio el tester</h2>
${visual || '<p class="muted">Sin lecturas del testigo visual.</p>'}

<h2>Capturas clave</h2>
<div class="grid">${shotsHtml || '<p class="muted">Sin capturas.</p>'}</div>

<h2>Fases</h2>
<ul>${phases}</ul>

<h2>Línea temporal</h2>
<div class="scroll"><table><thead><tr><th>t</th><th>Fuente</th><th>Tipo</th><th>Resumen</th></tr></thead><tbody>${timeline}</tbody></table></div>
</main></body></html>
`;
}
