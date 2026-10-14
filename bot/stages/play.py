"""
Etapa 4: Jugar una ronda.

Plan A: lanzar el spin con el teclado (Espacio), que muchos juegos aceptan.
Plan B: IA con visión: localiza el botón en una captura y se hace clic en esas coordenadas.

La etapa se da por buena si, tras lanzar el spin, sale una petición de jugada (HTTP o
WebSocket) hacia el servidor. Si la ronda se resuelve lo decide la etapa 5.

Sola:  python -m bot.stages.play --game-url <url del juego> [--mode keyboard|vision|auto]
"""
from __future__ import annotations

import logging
import re
import time

from PIL import Image, ImageDraw

from bot import config as C
from bot.evidence import Step, StepTimer
from bot.stages.launch import find_surface, surface_png, wait_rendered

log = logging.getLogger("bot")
SPIN_TYPES = ("xhr", "fetch", "other", "websocket", "eventsource")


def run(session, ctx: dict) -> Step:
    step = Step(name="play")
    run_ = session.run
    page = session.page
    with StepTimer(step):
        surface = ctx.get("surface")
        if surface is None:
            step.notes = "No hay canvas del juego sobre el que jugar"
            return step
        mode = ctx.get("play_mode", "auto")
        ev = {"plan": None, "t_spin": None, "spin_requests": [], "ws_sent": 0, "ws_received": 0,
              "balance_before": None, "balance_after": None, "vision_steps": []}
        run_.evidence["play"] = ev

        # --- Plan A: teclado -------------------------------------------------
        if mode in ("auto", "keyboard"):
            log.info("Etapa 4 · Plan A: lanzar el spin con Espacio")
            for attempt in range(1, 4):   # el primer Espacio a veces solo quita la pantalla de inicio
                run_.shot(surface, "04a_antes.png")   # se sobrescribe: queda la de la pulsación buena
                t = time.time()
                _press_space(page, surface)
                if _wait_spin(session, t, C.SPIN_WAIT_S if attempt == 1 else 3):
                    ev["plan"], ev["t_spin"] = "teclado", t
                    break

        # --- Plan B: IA con visión ------------------------------------------
        if ev["t_spin"] is None and mode in ("auto", "vision"):
            if not C.ai_configured():
                log.warning("Plan B no disponible: falta la API key de la IA en .env")
            else:
                log.info("Etapa 4 · Plan B: IA con visión")
                _play_with_vision(session, surface, ev, step)

        if ev["t_spin"] is None:
            step.screenshots = [f for f in [run_.shot(surface, "04_sin_jugada.png")] if f]
            tried = [n for n, ok in (("A (teclado)", mode in ("auto", "keyboard")),
                                     ("B (IA)", mode in ("auto", "vision") and C.ai_configured())) if ok]
            step.notes = ("El spin no generó ninguna petición al servidor con el plan " + " ni con el plan ".join(tried)
                          if tried else "No se ha podido intentar: el plan B (IA) necesita la API key en .env")
            if mode == "vision" and not C.ai_configured() and tried:
                step.notes += " (plan B no disponible: falta la API key)"
            return step

        page.wait_for_timeout(C.ROUND_WAIT_S * 1000)   # dejar que la ronda termine antes de la captura final
        step.screenshots = [f for f in ["04a_antes.png", run_.shot(surface, "04b_despues.png")]
                            if f and (run_.dir / f).exists()]
        _collect_spin_evidence(session, ev)
        answered = [r for r in ev["spin_requests"] if r["status"] and r["status"] < 400]
        if not answered and not ev["ws_sent"]:
            r = ev["spin_requests"][0]
            step.notes = (f"El spin sale ({ev['plan']}) pero la petición falla: "
                          f"{r['error'] or 'HTTP ' + str(r['status'])} · {r['url']}")
            return step
        step.status = "pass"
        step.notes = (f"Spin lanzado con {ev['plan']}: {len(answered)} petición(es) de jugada respondida(s), "
                      f"{ev['ws_sent']} mensaje(s) WebSocket enviado(s)")
    return step


# ---------------------------------------------------------------------------
def _press_space(page, surface) -> None:
    try:   # el canvas tiene que tener el foco para recibir el teclado
        surface.evaluate("c => { if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0'); c.focus(); }")
    except Exception:
        pass
    page.keyboard.press("Space")


def _spin_traffic(session, since: float) -> tuple[list[dict], int, int]:
    """Peticiones de jugada desde `since` (con respuesta o fallidas) y mensajes WebSocket."""
    rx = re.compile(C.SPIN_URL_REGEX, re.I)
    reqs = [r for r in session.responses if r["t"] >= since and r["type"] in SPIN_TYPES and rx.search(r["url"])]
    reqs += [{"url": f["url"], "method": f.get("method"), "status": None, "error": f["error"], "t": f["t"]}
             for f in session.failed if f["t"] >= since and f.get("type") in SPIN_TYPES and rx.search(f["url"])]
    sent = sum(1 for w in session.ws if w["t"] >= since and w["dir"] == "sent")
    recv = sum(1 for w in session.ws if w["t"] >= since and w["dir"] == "received")
    return reqs, sent, recv


def _wait_spin(session, since: float, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        # Esperar con Playwright (no con time.sleep): así procesa los eventos de red mientras tanto
        session.page.wait_for_timeout(250)
        reqs, sent, _ = _spin_traffic(session, since)
        if reqs or sent:
            return True
    return False


def _collect_spin_evidence(session, ev: dict) -> None:
    reqs, sent, recv = _spin_traffic(session, ev["t_spin"])
    ev["spin_requests"] = [{"url": r["url"], "method": r.get("method"), "status": r.get("status"),
                            "error": r.get("error"), "t": r["t"]} for r in reqs][:20]
    ev["ws_sent"], ev["ws_received"] = sent, recv


def _play_with_vision(session, surface, ev: dict, step: Step) -> None:
    from bot.vision import Vision
    vision = Vision()
    run_ = session.run
    history: list[str] = []
    for i in range(1, C.VISION_MAX_STEPS + 1):
        png = surface_png(surface, session.page)
        decision = vision.decide(png, history)
        if decision.balance_text and ev["balance_before"] is None:
            ev["balance_before"] = decision.balance_text
        name = f"04_ia_{i:02d}.png"
        (run_.dir / name).write_bytes(png)
        ev["vision_steps"].append(decision.to_dict() | {"screenshot": name})

        if decision.state == "error":
            step.notes = f"El juego muestra un error: {decision.reason}"
            break
        if decision.action == "click" and decision.confidence >= C.VISION_MIN_CONFIDENCE:
            if decision.state == "ready":
                (run_.dir / "04a_antes.png").write_bytes(png)
            t = time.time()
            _click(session.page, surface, png, decision.x, decision.y)
            _annotate(run_.dir / name, decision.x, decision.y)
            history.append(f"paso {i}: clic en '{decision.target}' ({decision.state})")
            if _wait_spin(session, t, C.SPIN_WAIT_S if decision.state == "ready" else 2):
                ev["plan"], ev["t_spin"] = "IA con visión", t
                break
        else:
            history.append(f"paso {i}: espera ({decision.state})")
            session.page.wait_for_timeout(1500)

    if ev["t_spin"] is not None:   # leer el saldo al final de la ronda
        session.page.wait_for_timeout(C.ROUND_WAIT_S * 1000)
        after = vision.decide(surface_png(surface, session.page), history + ["spin done, read the balance"])
        ev["balance_after"] = after.balance_text
    run_.ai_usage = {"calls": vision.calls, "usd": vision.usd}


def _click(page, surface, png: bytes, x: int, y: int) -> None:
    """Convierte coordenadas de la captura del canvas a coordenadas de la página."""
    import io
    w, h = Image.open(io.BytesIO(png)).size
    box = surface.bounding_box()
    px, py = box["x"] + x * box["width"] / w, box["y"] + y * box["height"] / h
    page.mouse.move(px, py, steps=6)
    page.mouse.click(px, py, delay=60)


def _annotate(path, x: int, y: int) -> None:
    img = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(img)
    d.ellipse([x - 16, y - 16, x + 16, y + 16], outline=(255, 0, 0), width=4)
    img.save(path)


if __name__ == "__main__":
    import argparse

    from bot.run import standalone
    p = argparse.ArgumentParser(description="Etapa 4: jugar una ronda en un juego ya abierto")
    p.add_argument("--game-url", required=True)
    p.add_argument("--mode", choices=["auto", "keyboard", "vision"], default="auto")
    a = p.parse_args()

    def open_game(session, ctx):
        session.page.goto(ctx["game_url"], wait_until="domcontentloaded")
        surface, _ = find_surface(session.page, C.GAME_LOAD_TIMEOUT_S)
        if surface is not None and wait_rendered(surface, C.GAME_LOAD_TIMEOUT_S):
            ctx["surface"] = surface
        return None   # preparación: no cuenta como etapa

    standalone([open_game, run], {"url": a.game_url, "game_url": a.game_url, "play_mode": a.mode})
