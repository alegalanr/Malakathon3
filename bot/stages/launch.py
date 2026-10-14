"""
Etapa 3: Abrir el juego.

Plan A: clic en el tile (y en "Jugar/Demo" si aparece) y esperar a que el canvas esté visible.
Plan B: ir directamente a la URL del juego.
Busca el <canvas> en todos los frames (también iframes del proveedor) y comprueba que
renderiza algo (no es una pantalla vacía) durante unos segundos seguidos.

Sola:  python -m bot.stages.launch --game-url <url del juego>
"""
from __future__ import annotations

import io
import logging
import time
from urllib.parse import urlparse

import numpy as np
from PIL import Image

from bot import config as C
from bot.evidence import Step, StepTimer

log = logging.getLogger("bot")


def run(session, ctx: dict) -> Step:
    step = Step(name="launch")
    run_ = session.run
    with StepTimer(step):
        t0 = time.time()
        ctx["launch_t0"] = t0
        how = _open(session, ctx)
        log.info("Etapa 3 · Abriendo el juego (%s)", how)

        surface, frame_url = find_surface(session.page, C.GAME_LOAD_TIMEOUT_S, session=session, since=t0)
        if surface is None:
            step.screenshots = [s for s in [run_.shot(session.page, "03_juego.png")] if s]
            broken = _broken_documents(session, t0)
            step.notes = (f"El juego no se puede cargar: falla {broken[0]}" if broken
                          else f"No aparece el canvas del juego tras {C.GAME_LOAD_TIMEOUT_S} s ({how})")
            _record(session, ctx, t0, rendered=False, frame_url=None)
            return step

        rendered = wait_rendered(surface, C.GAME_LOAD_TIMEOUT_S)
        load_s = time.time() - t0
        step.screenshots = [s for s in [run_.shot(session.page, "03_juego.png")] if s]
        ctx["surface"] = surface
        info = _record(session, ctx, t0, rendered=rendered, frame_url=frame_url)

        if not rendered:
            step.notes = "El canvas aparece pero está vacío (pantalla negra o en blanco)"
            return step
        if info["provider_errors"]:
            step.notes = f"El juego carga pero hay {len(info['provider_errors'])} petición(es) con error: {info['provider_errors'][0]}"
            return step
        step.status = "pass"
        step.notes = f"Canvas visible y renderizado en {load_s:.1f} s ({how})"
    return step


def _open(session, ctx: dict) -> str:
    page = session.page
    pages_before = len(session.context.pages)
    tile = ctx.get("tile")
    how = "URL directa"
    if tile is not None:
        try:
            tile.hover()
            page.wait_for_timeout(400)
            if not _click_first(tile, C.PLAY_BUTTON_SELECTORS):
                tile.click()
            page.wait_for_timeout(1500)
            _click_first(page, C.PLAY_BUTTON_SELECTORS)   # ficha intermedia del juego, si la hay
            how = "clic en el tile"
        except Exception as e:
            log.warning("No se pudo hacer clic en el tile (%s); pruebo con la URL", e)
            tile = None
    if tile is None:
        if not ctx.get("game_url"):
            raise RuntimeError("No hay ni tile ni URL del juego")
        page.goto(ctx["game_url"], wait_until="domcontentloaded")
    page.wait_for_timeout(1000)
    if len(session.context.pages) > pages_before:      # el juego se abrió en otra pestaña
        session.use_page(session.context.pages[-1])
        how += ", en pestaña nueva"
    return how


def find_surface(page, timeout_s: int, session=None, since: float = 0):
    """Devuelve (canvas más grande en cualquier frame, url del frame) o (None, None).
    Si la página o el iframe del juego no se han podido descargar, se rinde a los 5 s."""
    deadline = time.time() + timeout_s
    start = time.time()
    while time.time() < deadline:
        if session is not None and time.time() - start > 5 and _broken_documents(session, since):
            return None, None
        best, area, frame_url = None, 0, None
        for fr in page.frames:
            try:
                for c in fr.query_selector_all("canvas"):
                    b = c.bounding_box()
                    if b and b["width"] > 200 and b["height"] > 150 and b["width"] * b["height"] > area:
                        best, area, frame_url = c, b["width"] * b["height"], fr.url
            except Exception:
                continue
        if best is not None:
            return best, frame_url
        page.wait_for_timeout(1000)
    return None, None


def _broken_documents(session, since: float) -> list[str]:
    """Páginas o iframes que no se han podido descargar (red caída, bloqueo, 4xx/5xx)."""
    out = [f"{f['url']} ({f['error']})" for f in session.failed if f["t"] >= since and f.get("type") == "document"]
    out += [f"{r['url']} (HTTP {r['status']})" for r in session.responses
            if r["t"] >= since and r["type"] == "document" and r["status"] >= 400]
    return out


def surface_png(surface, page) -> bytes:
    try:
        return surface.screenshot()
    except Exception:
        return page.screenshot()


def pixel_std(png: bytes) -> float:
    return float(np.array(Image.open(io.BytesIO(png)).convert("L")).std())


def wait_rendered(surface, timeout_s: int) -> bool:
    """True si el canvas tiene contenido (varianza de píxeles) durante CANVAS_STABLE_S seguidos."""
    deadline = time.time() + timeout_s
    ok_since = None
    while time.time() < deadline:
        try:
            std = pixel_std(surface.screenshot())
        except Exception:
            std = 0
        if std > C.CANVAS_MIN_STD:
            ok_since = ok_since or time.time()
            if time.time() - ok_since >= C.CANVAS_STABLE_S:
                return True
        else:
            ok_since = None
        time.sleep(0.5)
    return False


def _record(session, ctx, t0, rendered, frame_url) -> dict:
    # Solo cuentan los errores del dominio del juego (el proveedor): la analítica de la web
    # suele fallar a menudo y no dice nada del juego.
    host = urlparse(frame_url).netloc if frame_url else None

    def from_game(url: str) -> bool:
        return host is None or urlparse(url).netloc == host

    provider_errors = [f"{r['status']} {r['url']}" for r in session.responses
                       if r["t"] >= t0 and r["status"] >= 400 and from_game(r["url"])
                       and r["type"] in ("xhr", "fetch", "document", "script")]
    provider_errors += [f"bloqueada/fallida {f['url']}" for f in session.failed
                        if f["t"] >= t0 and from_game(f["url"])]
    info = {"t0": t0, "canvas_found": frame_url is not None, "rendered": rendered, "frame_url": frame_url,
            "provider_errors": provider_errors[:20], "load_s": round(time.time() - t0, 2)}
    session.run.evidence["launch"] = info
    return info


def _click_first(scope, selectors) -> bool:
    for sel in selectors:
        try:
            btn = scope.locator(sel).first
            if btn.is_visible(timeout=700):
                btn.click()
                return True
        except Exception:
            continue
    return False


if __name__ == "__main__":
    import argparse

    from bot.run import standalone
    p = argparse.ArgumentParser(description="Etapa 3: abrir un juego")
    p.add_argument("--game-url", required=True, help="URL de la página del juego")
    a = p.parse_args()
    standalone([run], {"url": a.game_url, "game_url": a.game_url})
