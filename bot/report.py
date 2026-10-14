"""
Reporte HTML de una ejecución (runs/<run_id>/report.html), generado a partir de run.json
y evidence.json. Es solo para verlo cómodo: la fuente de verdad es run.json.
"""
from __future__ import annotations

from jinja2 import Environment, select_autoescape

from bot.evidence import Run

TEMPLATE = r"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ r.game.name or 'Ejecución' }} · {{ v.result }}</title>
<style>
:root{--bg:#f6f6f7;--card:#fff;--ink:#111;--muted:#6b7280;--line:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8e8ea;--muted:#9aa0aa;--line:#262b35}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.w{max-width:1000px;margin:0 auto;padding:24px 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.hero{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.b{color:#fff;font-weight:800;font-size:26px;padding:8px 20px;border-radius:10px}
.PASS{background:#15803d}.FAIL{background:#b91c1c}.pass{border-left:6px solid #15803d}.fail{border-left:6px solid #b91c1c}.skipped{border-left:6px solid #6b7280}
.m{color:var(--muted)}h1{font-size:20px;margin:0}h2{font-size:16px;margin:20px 0 8px}
.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.shots{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.shots img{height:120px;border-radius:8px;border:1px solid var(--line)}
pre{white-space:pre-wrap;word-break:break-all;font-size:12px}video{max-width:100%;border-radius:10px}
</style></head><body><div class="w">
<div class="card hero"><div class="b {{ v.result }}">{{ v.result }}</div><div>
<h1>{{ r.game.name or '—' }}</h1><div class="m">{{ r.run_id }} · {{ r.url }}</div><div>{{ v.reason }}</div>
{% if r.game.why_new %}<div class="m">Por qué es nuevo: {{ r.game.why_new }}</div>{% endif %}</div></div>
<h2>Comprobaciones</h2><div class="checks">
{% for k, val in v.checks.items() %}<div class="card"><div class="m">{{ k }}</div><b>{{ 'sí' if val is sameas true else ('no' if val is sameas false else val) }}</b></div>{% endfor %}
<div class="card"><div class="m">IA (llamadas · USD aprox.)</div><b>{{ r.ai_usage.calls }} · {{ r.ai_usage.usd }}</b></div></div>
<h2>Etapas</h2>
{% for s in r.steps %}<div class="card {{ s.status }}"><b>{{ s.name }}</b> <span class="m">{{ s.status }} · {{ s.duration_ms }} ms</span>
<div>{{ s.notes }}</div><div class="shots">{% for f in s.screenshots %}<a href="{{ f }}"><img src="{{ f }}" alt="{{ f }}"></a>{% endfor %}</div></div>{% endfor %}
{% if video %}<h2>Vídeo</h2><video controls src="{{ video }}"></video>{% endif %}
<h2>Ficheros</h2><div class="card"><a href="run.json">run.json</a> · <a href="evidence.json">evidence.json</a> · <a href="trace.zip">trace.zip</a>
<span class="m">(se abre en trace.playwright.dev)</span></div>
</div></body></html>"""


def write_report(run: Run) -> str:
    data = run.to_dict()
    verdict = data["verdict"] or {"result": "—", "reason": "Sin veredicto", "checks": {}}
    html = Environment(autoescape=select_autoescape(["html"])).from_string(TEMPLATE).render(
        r=_Obj(data), v=_Obj(verdict), video=run.evidence.get("video"))
    path = run.dir / "report.html"
    path.write_text(html, encoding="utf-8")
    return str(path)


class _Obj(dict):
    def __getattr__(self, k):
        v = self.get(k)
        if isinstance(v, dict):
            return _Obj(v)
        if isinstance(v, list):
            return [_Obj(x) if isinstance(x, dict) else x for x in v]
        return v


if __name__ == "__main__":
    import sys
    from pathlib import Path
    print(write_report(Run.load(Path(sys.argv[1]))))
