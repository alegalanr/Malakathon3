"""
Etapa 5: Veredicto PASS/FAIL.

Reglas de docs/diseno.md ("Cuándo es PASS"), sobre lo que han registrado las etapas anteriores:
  1. loaded          el juego carga: canvas renderizado y sin errores 4xx/5xx del proveedor
  2. spin_request    al lanzar el spin sale una petición (HTTP o WebSocket) y vuelve respuesta válida
  3. round_resolved  la ronda se resuelve: respuesta 2xx de la jugada, mensajes WS de vuelta o cambio de saldo
  4. console_errors  0 errores graves (excepciones JavaScript no capturadas desde que se abre el juego)
Las capturas son prueba visual, pero no deciden. Si falla cualquier punto: FAIL con motivo y etapa.

Sola:  python -m bot.stages.verdict runs/<run_id>
"""
from __future__ import annotations

import logging
from pathlib import Path

from bot.evidence import Run

log = logging.getLogger("bot")
STEP_LABEL = {"enter": "entrar", "detect": "detectar el juego nuevo", "launch": "abrir el juego",
              "play": "jugar una ronda"}


def decide(run: Run) -> dict:
    ev = run.evidence
    launch = ev.get("launch") or {}
    play = ev.get("play") or {}
    net = ev.get("network") or {}
    t0 = launch.get("t0") or 0

    spin_reqs = play.get("spin_requests") or []
    ok_spin = [r for r in spin_reqs if r.get("status") and r["status"] < 400]
    bal_b, bal_a = play.get("balance_before"), play.get("balance_after")
    grave = [e for e in net.get("page_errors", []) if e.get("t", 0) >= t0]

    checks = {
        "loaded": bool(launch.get("rendered")) and not launch.get("provider_errors"),
        "spin_request": bool(ok_spin) or play.get("ws_sent", 0) > 0,
        "round_resolved": any(200 <= r["status"] < 300 for r in ok_spin) or play.get("ws_received", 0) > 0
                          or bool(bal_b and bal_a and bal_b != bal_a),
        "console_errors": len(grave),
    }

    failed = next((s for s in run.steps if s.status == "fail"), None)
    if failed:
        return _fail(failed.name, checks, f"Falla al {STEP_LABEL.get(failed.name, failed.name)}: {failed.notes}")
    if not checks["loaded"]:
        return _fail("launch", checks, "El juego no carga correctamente: " +
                     ("; ".join(launch.get("provider_errors", [])[:2]) or "canvas vacío"))
    if not checks["spin_request"]:
        bad = [f"{r.get('status') or r.get('error')} {r['url']}" for r in spin_reqs if not r.get("status") or r["status"] >= 400]
        return _fail("play", checks, "La jugada no llega al servidor" + (f" (responde {bad[0]})" if bad else ""))
    if not checks["round_resolved"]:
        return _fail("play", checks, "La jugada sale, pero no hay respuesta válida ni cambio de saldo")
    if grave:
        return _fail("play", checks, f"Errores JavaScript en el juego: {grave[0]['error']}")

    parts = ["Carga", "el spin recibe respuesta del servidor"]
    if bal_b and bal_a and bal_b != bal_a:
        parts.append(f"el saldo cambia ({bal_b} → {bal_a})")
    reason = ", ".join(parts[:-1]) + " y " + parts[-1]
    return {"result": "PASS", "failed_step": None, "reason": reason, "checks": checks}


def _fail(step: str, checks: dict, reason: str) -> dict:
    return {"result": "FAIL", "failed_step": step, "reason": reason, "checks": checks}


if __name__ == "__main__":
    import argparse
    import logging as _l

    from bot.report import write_report
    _l.basicConfig(level=_l.INFO, format="%(message)s")
    p = argparse.ArgumentParser(description="Etapa 5: recalcular el veredicto de una ejecución")
    p.add_argument("run_dir", type=Path, help="Carpeta runs/<run_id>")
    a = p.parse_args()
    r = Run.load(a.run_dir)
    r.verdict = decide(r)
    r.save()
    write_report(r)
    log.info("Veredicto: %s · %s", r.verdict["result"], r.verdict["reason"])
