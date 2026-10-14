"""
Orquestador principal: SESSION → LOBBY → LAUNCH → PLAY → VERDICT → REPORT.

Ejemplos
  python main.py --check                          # verifica entorno sin abrir webs reales
  python main.py --save-session                   # abre el navegador para login manual y guarda sesión
  python main.py --site betsson_com --game "Starburst"
  python main.py --game "Book of Dead" --headless --provider openai
"""
from __future__ import annotations

import argparse
import platform
import sys
import time
from datetime import datetime

from config import config as C
from utils.logger import Timeline, get_logger
from utils.models import PhaseResult, TestResult, Verdict


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Betsson Casino QA: lobby → lanzamiento → jugada")
    p.add_argument("--site", default=C.DEFAULT_SITE, choices=list(C.SITES))
    p.add_argument("--game", default=C.DEFAULT_GAME, help="Nombre del juego a verificar")
    p.add_argument("--headless", action="store_true", default=C.HEADLESS)
    p.add_argument("--provider", default=C.VISION_PROVIDER, choices=["anthropic", "openai"])
    p.add_argument("--no-ai", action="store_true", help="Desactiva la IA (sólo lobby + launch)")
    p.add_argument("--check", action="store_true", help="Self-test del entorno y reporte de ejemplo")
    p.add_argument("--save-session", action="store_true", help="Login manual y guardado de storageState")
    return p.parse_args()


# --------------------------------------------------------------------------- #
def decide_verdict(phases: list[PhaseResult]) -> tuple[Verdict, str]:
    """Veredicto global por reglas: el primer no-PASS determina el resultado."""
    for ph in phases:
        if ph.status == Verdict.BLOCK:
            return Verdict.BLOCK, f"Bloqueado en {ph.name}: {ph.summary}"
        if ph.status == Verdict.FAIL:
            return Verdict.FAIL, f"Falla en {ph.name}: {ph.summary}"
        if ph.status == Verdict.INCONCLUSIVE:
            return Verdict.INCONCLUSIVE, f"Evidencia insuficiente en {ph.name}: {ph.summary}"
    if len(phases) == 3 and all(p.status == Verdict.PASS for p in phases):
        return Verdict.PASS, "El juego aparece en el lobby, carga correctamente y se jugó una ronda."
    return Verdict.INCONCLUSIVE, "Ejecución incompleta"


def skipped(name: str) -> PhaseResult:
    return PhaseResult(name=name, status=Verdict.SKIPPED, summary="No ejecutada por fallo previo")


# --------------------------------------------------------------------------- #
def run(args: argparse.Namespace) -> TestResult:
    from ai_engine.vision_solver import VisionSolver
    from automation.browser_driver import BrowserDriver
    from automation.game_launcher import GameLauncher
    from automation.lobby_navigator import LobbyNavigator
    from reporter.report_generator import ReportGenerator

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    cfg = C.RunConfig(site=C.SITES[args.site], game_name=args.game, run_id=run_id, headless=args.headless)
    log = get_logger(log_file=cfg.report_dir / "run.log")
    tl = Timeline()
    t0 = time.time()
    result = TestResult(run_id=run_id, site=args.site, game_name=args.game,
                        started_at=datetime.now().isoformat(timespec="seconds"),
                        environment={"python": platform.python_version(), "os": platform.system(),
                                     "headless": args.headless, "viewport": C.VIEWPORT,
                                     "channel": C.BROWSER_CHANNEL or "chromium"})
    log.info(f"▶ Run {run_id} · sitio={args.site} · juego='{args.game}'")

    vision = None
    if not args.no_ai:
        try:
            vision = VisionSolver(log, provider=args.provider)
        except Exception as e:
            log.warning(f"IA desactivada: {e}")
            tl.add("SESSION", f"IA desactivada: {e}", level="WARN")

    driver = BrowserDriver(cfg, log, tl)
    try:
        driver.start()
        tl.add("SESSION", "Navegador iniciado")

        # ---------------- LOBBY ----------------
        lobby = LobbyNavigator(driver, log, tl, vision)
        ls = lobby.find_game(args.game)
        result.phases.append(PhaseResult(
            name="LOBBY", status=ls.status, duration_ms=ls.duration_ms, screenshots=ls.screenshots,
            summary=ls.error or f"Tile '{ls.game_name_found}' visible (match {ls.match_score:.0f}%, vía {ls.strategy})",
            details=ls.to_dict()))
        log.info(f"LOBBY → {ls.status.value}")
        if ls.status != Verdict.PASS:
            result.phases += [skipped("LAUNCH"), skipped("PLAY")]
            return result

        # ---------------- LAUNCH ----------------
        launcher = GameLauncher(driver, log, tl, vision)
        st = launcher.launch(lobby)
        result.phases.append(PhaseResult(
            name="LAUNCH", status=st.status, duration_ms=st.load_time_ms, screenshots=st.screenshots,
            summary=st.error or f"Juego renderizado en {st.render_surface} en {st.load_time_ms} ms",
            details=st.to_dict()))
        log.info(f"LAUNCH → {st.status.value}")
        if st.status != Verdict.PASS or time.time() - t0 > C.GLOBAL_RUN_TIMEOUT_S:
            result.phases.append(skipped("PLAY"))
            return result

        # ---------------- PLAY ----------------
        ps = launcher.play_round()
        ev = ps.evidence
        result.phases.append(PhaseResult(
            name="PLAY", status=ps.status, duration_ms=ps.duration_ms,
            screenshots=ps.screenshots + [s["screenshot"] for s in ev.steps][-6:],
            summary=ps.error or (f"Rondas={ps.rounds_played} · peticiones de jugada={len(ev.spin_requests)} · "
                                 f"WS={ev.ws_frames} · diff visual={ev.visual_diff_ratio:.1%} · "
                                 f"saldo {ev.balance_before} → {ev.balance_after}"),
            details=ps.to_dict()))
        log.info(f"PLAY → {ps.status.value}")
        return result

    except Exception as e:
        log.exception("Error no controlado")
        tl.add("SESSION", f"Excepción global: {e}", level="ERROR")
        result.phases.append(PhaseResult(name="SESSION", status=Verdict.FAIL, summary=str(e)))
        return result

    finally:
        driver.stop()
        result.verdict, result.verdict_reason = decide_verdict(result.phases)
        result.finished_at = datetime.now().isoformat(timespec="seconds")
        result.duration_ms = int((time.time() - t0) * 1000)
        result.timeline = tl.to_list()
        phase_ms = {f"{p.name.lower()}_ms": p.duration_ms for p in result.phases if p.duration_ms}
        result.metrics = {"total_s": round(result.duration_ms / 1000, 1), **phase_ms,
                          "console_errors": len(driver.console_errors),
                          "failed_requests": len(driver.failed_requests)}
        if vision:
            s = vision.stats()
            result.metrics |= {"ai_calls": s["calls"], "ai_latency_ms": s["total_latency_ms"],
                               "ai_tokens": s["input_tokens"] + s["output_tokens"]}
            result.ai_summary = vision.summarize(result.to_dict())
        result.artifacts = {k: v for k, v in {"video": driver.video_path, "trace": driver.trace_path,
                                              "log": C.rel(cfg.report_dir / "run.log")}.items() if v}
        paths = ReportGenerator(log).generate(result)
        log.info(f"■ VEREDICTO: {result.verdict.value} — {result.verdict_reason}")
        log.info(f"   HTML: {paths['html']}  ·  JSON: {paths['json']}")


# --------------------------------------------------------------------------- #
def save_session(args: argparse.Namespace) -> None:
    from automation.browser_driver import BrowserDriver
    cfg = C.RunConfig(site=C.SITES[args.site], game_name="", run_id="session_setup", headless=False)
    log = get_logger()
    with BrowserDriver(cfg, log) as drv:
        drv.page.goto(cfg.site.lobby_url)
        input("➡  Inicia sesión / acepta cookies en el navegador y pulsa ENTER aquí para guardar la sesión... ")
        drv.save_session()
        log.info(f"Sesión guardada en {C.rel(C.STORAGE_STATE_FILE)}")


def self_check() -> int:
    """Comprueba dependencias, navegador y API key, y genera un reporte de ejemplo."""
    from reporter.report_generator import ReportGenerator
    log = get_logger()
    ok = True
    for mod in ("playwright", "anthropic", "openai", "numpy", "PIL", "jinja2", "rapidfuzz", "dotenv"):
        try:
            __import__(mod)
            log.info(f"✔ {mod}")
        except ImportError:
            ok = False
            log.error(f"✘ falta {mod} → pip install -r requirements.txt")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            pg = b.new_page()
            pg.set_content("<canvas id=c width=200 height=100></canvas><script>"
                           "c.getContext('2d').fillRect(10,10,80,40)</script>")
            log.info(f"✔ Chromium operativo (canvas={pg.locator('canvas').count()})")
            b.close()
    except Exception as e:
        ok = False
        log.error(f"✘ Playwright/Chromium: {e} → python -m playwright install chromium")
    key = C.ANTHROPIC_API_KEY if C.VISION_PROVIDER == "anthropic" else C.OPENAI_API_KEY
    log.info(("✔" if key else "⚠") + f" API key {C.VISION_PROVIDER} {'presente' if key else 'NO definida en .env'}")

    demo = TestResult(run_id="selfcheck", site="demo", game_name="Demo Game",
                      started_at=datetime.now().isoformat(timespec="seconds"),
                      verdict=Verdict.PASS, verdict_reason="Reporte de ejemplo generado por --check",
                      phases=[PhaseResult(name=n, status=Verdict.PASS, summary="OK (simulado)")
                              for n in ("LOBBY", "LAUNCH", "PLAY")],
                      metrics={"total_s": 0})
    ReportGenerator(log).generate(demo)
    log.info("✔ Self-check completado" if ok else "✘ Self-check con errores")
    return 0 if ok else 1


if __name__ == "__main__":
    a = parse_args()
    if a.check:
        sys.exit(self_check())
    if a.save_session:
        save_session(a)
        sys.exit(0)
    res = run(a)
    sys.exit({Verdict.PASS: 0, Verdict.FAIL: 1, Verdict.BLOCK: 2}.get(res.verdict, 3))
