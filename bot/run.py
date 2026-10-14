"""
Orquestador: encadena las 5 etapas y deja runs/<run_id>/ con run.json, capturas, traza y reporte.

    python -m bot.run --url <url del lobby>                 # todo el flujo
    python -m bot.run --url <url> --game "Nombre"           # buscar un juego concreto
    python -m bot.run --url <url> --block "**/provider*"    # FAIL provocado (bloquea el proveedor)
    python -m bot.run --check                               # comprobar el entorno

Código de salida: 0 = PASS, 1 = FAIL, 2 = error del propio bot.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time

from bot import config as C
from bot.browser import Session
from bot.evidence import Run, Step, utc_now_iso
from bot.report import write_report
from bot.stages import detect, enter, launch, play, verdict

log = logging.getLogger("bot")
STAGES = [("enter", enter.run), ("detect", detect.run), ("launch", launch.run), ("play", play.run)]


def setup_logging() -> None:
    try:
        from rich.logging import RichHandler
        logging.basicConfig(level=logging.INFO, format="%(message)s", datefmt="%H:%M:%S",
                            handlers=[RichHandler(show_path=False)])
    except ImportError:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")


def finish(run: Run) -> int:
    run.finished_at = utc_now_iso()
    run.verdict = verdict.decide(run)
    run.save()
    write_report(run)
    v = run.verdict
    log.info("Veredicto: %s · %s", v["result"], v["reason"])
    log.info("Resultado en %s (run.json, report.html, capturas y trace.zip)", run.dir.relative_to(C.ROOT).as_posix())
    return 0 if v["result"] == "PASS" else 1


def full_run(args) -> int:
    run = Run(url=args.url)
    ctx = {"url": args.url, "game_name": args.game, "play_mode": args.play_mode}
    log.info("Ejecución %s", run.run_id)
    t0 = time.time()
    session = Session(run, headless=not args.headed, block=args.block)
    try:
        session.start()
        failed = False
        for name, fn in STAGES:
            if failed or time.time() - t0 > C.GLOBAL_TIMEOUT_S:
                run.steps.append(Step(name=name, status="skipped",
                                      notes="No se ejecuta porque falló una etapa anterior" if failed
                                      else "Tiempo máximo de la ejecución agotado"))
                continue
            try:
                step = fn(session, ctx)
            except Exception as e:
                log.exception("Error en la etapa %s", name)
                step = Step(name=name, status="fail", notes=f"Error inesperado: {type(e).__name__}: {e}")
            run.steps.append(step)
            log.info("  %s → %s · %s", name, step.status, step.notes)
            failed = step.status != "pass"
    finally:
        session.stop()
    return finish(run)


def standalone(fns, ctx: dict) -> int:
    """Ejecuta una o varias etapas sueltas con una entrada fija y guarda su run.json (sin veredicto)."""
    setup_logging()
    run = Run(url=ctx.get("url", ""))
    with Session(run) as session:
        for fn in fns:
            step = fn(session, ctx)
            if step is not None:
                run.steps.append(step)
                log.info("  %s → %s · %s", step.name, step.status, step.notes)
    run.finished_at = utc_now_iso()
    run.save()
    write_report(run)
    log.info("Resultado en %s", run.dir.relative_to(C.ROOT).as_posix())
    return 0 if all(s.status == "pass" for s in run.steps) else 1


def check() -> int:
    ok = True
    for mod in ("playwright", "numpy", "PIL", "jinja2", "rapidfuzz", "dotenv", "anthropic", "openai"):
        try:
            __import__(mod)
            log.info("✔ %s", mod)
        except ImportError:
            ok = False
            log.error("✘ falta %s", mod)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            b.new_page().set_content("<canvas></canvas>")
            b.close()
        log.info("✔ Chromium arranca")
    except Exception as e:
        ok = False
        log.error("✘ Chromium: %s", e)
    log.info("%s IA (%s): %s", "✔" if C.ai_configured() else "⚠", C.VISION_PROVIDER,
             "API key configurada" if C.ai_configured() else "sin API key (el plan B de la etapa 4 no estará disponible)")
    log.info("URL del lobby: %s", C.LOBBY_URL)
    return 0 if ok else 2


def main() -> int:
    setup_logging()
    p = argparse.ArgumentParser(description="Bot de QA: juego nuevo en el lobby → abrir → jugar → veredicto")
    p.add_argument("--url", default=C.LOBBY_URL, help="URL del lobby (por defecto LOBBY_URL de .env)")
    p.add_argument("--game", help="Buscar un juego concreto por nombre en vez de detectar el nuevo")
    p.add_argument("--play-mode", choices=["auto", "keyboard", "vision"], default="auto",
                   help="auto: teclado y, si no funciona, IA")
    p.add_argument("--block", action="append", default=[], metavar="PATRÓN",
                   help="Bloquear peticiones (glob de Playwright) para provocar un FAIL. Repetible")
    p.add_argument("--headed", action="store_true", help="Ver el navegador (fuera de Docker)")
    p.add_argument("--check", action="store_true", help="Comprobar el entorno y salir")
    args = p.parse_args()
    if args.check:
        return check()
    try:
        return full_run(args)
    except Exception:
        log.exception("Error del bot")
        return 2


if __name__ == "__main__":
    sys.exit(main())
