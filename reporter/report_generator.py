"""
ReportGenerator: consume un TestResult y genera
  ./reports/<run_id>/result.json   (máquina / CI)
  ./reports/<run_id>/report.html   (humanos / jueces)
  ./reports/index.html             (histórico de ejecuciones)

Las imágenes del HTML se enlazan con rutas RELATIVAS al propio report.html,
de modo que la carpeta del proyecto se puede mover/comprimir sin romper enlaces.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from jinja2 import Environment, select_autoescape

from config import config as C
from utils.models import TestResult

COLORS = {"PASS": "#16a34a", "FAIL": "#dc2626", "BLOCK": "#7c3aed",
          "INCONCLUSIVE": "#d97706", "SKIPPED": "#6b7280"}

TEMPLATE = r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{ r.game_name }} · {{ r.verdict }}</title>
<style>
:root{--bg:#f7f7f8;--card:#fff;--ink:#111;--muted:#6b7280;--line:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8e8ea;--muted:#9aa0aa;--line:#262b35}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px}
.hero{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.badge{font-weight:800;font-size:28px;color:#fff;padding:10px 22px;border-radius:12px}
.muted{color:var(--muted)}h1{margin:0;font-size:22px}h2{margin:28px 0 10px;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:14px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.kpi b{display:block;font-size:20px}
.phase{background:var(--card);border:1px solid var(--line);border-left:6px solid;border-radius:12px;padding:14px;margin-bottom:12px}
.phase h3{margin:0 0 4px;font-size:16px}.pill{font-size:12px;font-weight:700;color:#fff;padding:2px 8px;border-radius:999px;margin-left:8px}
.shots{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.shots a img{height:120px;border-radius:8px;border:1px solid var(--line)}
details{margin-top:8px}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.lvl-ERROR{color:#dc2626}.lvl-WARN{color:#d97706}video{max-width:100%;border-radius:12px;border:1px solid var(--line)}
</style></head><body><div class="wrap">
<div class="hero">
  <div class="badge" style="background:{{ colors[r.verdict] }}">{{ r.verdict }}</div>
  <div><h1>{{ r.game_name }} — {{ r.site }}</h1>
  <div class="muted">Run {{ r.run_id }} · {{ r.started_at }} · {{ (r.duration_ms/1000)|round(1) }} s</div>
  <div>{{ r.verdict_reason }}</div></div>
</div>
{% if r.ai_summary %}<h2>Resumen (IA)</h2><div class="phase" style="border-left-color:#3b82f6">{{ r.ai_summary }}</div>{% endif %}
<div class="grid">
{% for k, v in r.metrics.items() %}<div class="kpi"><span class="muted">{{ k }}</span><b>{{ v }}</b></div>{% endfor %}
</div>
<h2>Fases</h2>
{% for p in r.phases %}
<div class="phase" style="border-left-color:{{ colors[p.status] }}">
  <h3>{{ p.name }}<span class="pill" style="background:{{ colors[p.status] }}">{{ p.status }}</span>
  <span class="muted" style="font-weight:400;font-size:13px"> · {{ p.duration_ms }} ms</span></h3>
  <div>{{ p.summary }}</div>
  <div class="shots">{% for s in p.screenshots %}<a href="{{ link(s) }}" target="_blank"><img src="{{ link(s) }}" alt="{{ s }}"></a>{% endfor %}</div>
  <details><summary>Detalles</summary><pre>{{ p.details | tojson(indent=2) }}</pre></details>
</div>
{% endfor %}
{% if r.artifacts.video %}<h2>Vídeo de la ejecución</h2><video controls src="{{ link(r.artifacts.video) }}"></video>{% endif %}
<h2>Timeline</h2>
<table><tr><th>t (s)</th><th>Fase</th><th>Evento</th><th>Evidencia</th></tr>
{% for e in r.timeline %}<tr class="lvl-{{ e.level }}"><td>{{ e.elapsed_s }}</td><td>{{ e.phase }}</td><td>{{ e.message }}</td>
<td>{% if e.screenshot %}<a href="{{ link(e.screenshot) }}" target="_blank">📸</a>{% endif %}</td></tr>{% endfor %}
</table>
<h2>Artefactos</h2><ul>
{% for k, v in r.artifacts.items() %}<li>{{ k }}: <a href="{{ link(v) }}">{{ v }}</a></li>{% endfor %}
<li>result.json: <a href="result.json">result.json</a></li></ul>
<p class="muted">El trace.zip se abre en https://trace.playwright.dev · Entorno: {{ r.environment | tojson }}</p>
</div></body></html>"""

INDEX_TEMPLATE = r"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Casino QA · Histórico</title>
<style>body{font:14px system-ui;margin:24px}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left}
.b{color:#fff;font-weight:700;padding:2px 8px;border-radius:6px}</style></head><body>
<h1>Histórico de ejecuciones</h1><table><tr><th>Run</th><th>Sitio</th><th>Juego</th><th>Veredicto</th><th>Duración</th></tr>
{% for r in runs %}<tr><td><a href="{{ r.run_id }}/report.html">{{ r.run_id }}</a></td><td>{{ r.site }}</td><td>{{ r.game_name }}</td>
<td><span class="b" style="background:{{ colors[r.verdict] }}">{{ r.verdict }}</span></td><td>{{ (r.duration_ms/1000)|round(1) }} s</td></tr>{% endfor %}
</table></body></html>"""


class ReportGenerator:
    def __init__(self, logger) -> None:
        self.log = logger
        self.env = Environment(autoescape=select_autoescape(["html"]))

    def generate(self, result: TestResult) -> dict[str, str]:
        out_dir = C.REPORTS_DIR / result.run_id
        out_dir.mkdir(parents=True, exist_ok=True)
        data = result.to_dict()

        json_path = out_dir / "result.json"
        json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        def link(project_rel: str) -> str:
            """Ruta relativa al proyecto → ruta relativa a reports/<run_id>/report.html."""
            if not project_rel:
                return ""
            return Path(os.path.relpath(C.PROJECT_ROOT / project_rel, out_dir)).as_posix()

        html = self.env.from_string(TEMPLATE).render(r=_Obj(data), colors=COLORS, link=link)
        html_path = out_dir / "report.html"
        html_path.write_text(html, encoding="utf-8")
        self._update_index()
        self.log.info(f"📄 Reporte: {C.rel(html_path)}")
        return {"html": C.rel(html_path), "json": C.rel(json_path)}

    def _update_index(self) -> None:
        runs = []
        for f in sorted(C.REPORTS_DIR.glob("*/result.json"), reverse=True):
            try:
                runs.append(_Obj(json.loads(f.read_text(encoding="utf-8"))))
            except Exception:
                continue
        html = self.env.from_string(INDEX_TEMPLATE).render(runs=runs, colors=COLORS)
        (C.REPORTS_DIR / "index.html").write_text(html, encoding="utf-8")


class _Obj(dict):
    """dict con acceso por atributo para Jinja (r.verdict, p.name...)."""

    def __getattr__(self, k):
        v = self.get(k)
        if isinstance(v, dict):
            return _Obj(v)
        if isinstance(v, list):
            return [_Obj(x) if isinstance(x, dict) else x for x in v]
        return v
