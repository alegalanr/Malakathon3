"""
Etapa 1: Entrar.

Abre la web, rechaza las cookies no esenciales, cierra modales y detecta muros de
geobloqueo o anti-bot (no se saltan: se marca FAIL con el motivo).

Sola:  python -m bot.stages.enter --url <url>
"""
from __future__ import annotations

import logging
import re

from playwright.sync_api import TimeoutError as PWTimeout

from bot import config as C
from bot.evidence import Step, StepTimer

log = logging.getLogger("bot")


def run(session, ctx: dict) -> Step:
    step = Step(name="enter")
    page = session.page
    with StepTimer(step):
        url = ctx["url"]
        log.info("Etapa 1 · Entrando en %s", url)
        try:
            page.goto(url, wait_until="domcontentloaded")
        except Exception as e:
            step.notes = f"No se pudo abrir la URL: {str(e).splitlines()[0]}"
            step.screenshots = [s for s in [session.run.shot(page, "01_entrar.png")] if s]
            return step
        try:
            page.wait_for_load_state("networkidle", timeout=10_000)
        except PWTimeout:
            pass   # los lobbies con sondeo constante nunca llegan a "networkidle"

        cookies = handle_cookies(page)
        closed = close_modals(page)
        shot = session.run.shot(page, "01_entrar.png")
        step.screenshots = [s for s in [shot] if s]

        blocked = detect_block(page)
        if blocked:
            step.notes = f"Bloqueado: la página muestra «{blocked}». No se intenta saltar."
            return step

        step.status = "pass"
        step.notes = f"{cookies}; {closed} modal(es) cerrado(s)"
    return step


def handle_cookies(page) -> str:
    for sel in C.COOKIE_REJECT_SELECTORS:
        if _click_if_visible(page, sel, 1500):
            return "Cookies rechazadas"
    for sel in C.COOKIE_ACCEPT_SELECTORS:
        if _click_if_visible(page, sel, 1000):
            return "Cookies aceptadas (no había opción de rechazar)"
    return "Sin banner de cookies"


def close_modals(page, rounds: int = 3) -> int:
    closed = 0
    for _ in range(rounds):
        hit = False
        for sel in C.MODAL_CLOSE_SELECTORS:
            if _click_if_visible(page, sel, 500):
                closed += 1
                hit = True
                page.wait_for_timeout(300)
        if not hit:
            break
    return closed


def detect_block(page) -> str | None:
    try:
        text = page.locator("body").inner_text(timeout=5_000)[:5000] + " " + page.title()
    except Exception:
        return None
    m = re.search(C.BLOCK_PAGE_REGEX, text, re.I)
    return m.group(0) if m else None


def _click_if_visible(page, selector: str, timeout_ms: int) -> bool:
    try:
        el = page.locator(selector).first
        if el.is_visible(timeout=timeout_ms):
            el.click()
            return True
    except Exception:
        pass
    return False


if __name__ == "__main__":
    import argparse

    from bot.run import standalone
    p = argparse.ArgumentParser(description="Etapa 1: entrar en la web")
    p.add_argument("--url", default=C.LOBBY_URL)
    a = p.parse_args()
    standalone([run], {"url": a.url})
