"""
LobbyNavigator: llega al lobby de casino, limpia banners/modales, localiza el juego
objetivo y verifica que su tile es visible. Devuelve un LobbyState (ver utils/models.py).

Estrategias de búsqueda (en orden):
  1. Buscador del lobby (input search) → resultados.
  2. Scroll progresivo del lobby comparando textos de tiles con fuzzy matching.
  3. (Fallback IA) captura + VisionSolver.locate_text() si el DOM no expone el nombre.
"""
from __future__ import annotations

import re
import time
from typing import Optional

from playwright.sync_api import Locator, Page
from playwright.sync_api import TimeoutError as PWTimeout
from rapidfuzz import fuzz

from config import config as C
from utils.models import BoundingBox, LobbyState, Verdict

BLOCK_PATTERNS = re.compile(
    r"(not available in your (country|region)|no disponible en tu (país|región)|"
    r"access denied|verify you are human|just a moment|attention required|captcha)", re.I)

TILE_CANDIDATE_SELECTORS = [
    "[data-test-id*='game' i]",
    "[data-testid*='game' i]",
    "[class*='game-tile' i]",
    "[class*='gameTile' i]",
    "[class*='game-card' i]",
    "a[href*='/game' i]",
    "a[href*='/casino/' i]",
]


class LobbyNavigator:
    def __init__(self, driver, logger, timeline, vision=None) -> None:
        self.drv = driver
        self.page: Page = driver.page
        self.log = logger
        self.tl = timeline
        self.vision = vision
        self.tile: Optional[Locator] = None

    # ------------------------------------------------------------------ #
    def open_lobby(self, state: LobbyState) -> None:
        url = self.drv.cfg.site.lobby_url
        self.log.info(f"Navegando al lobby: {url}")
        self.page.goto(url, wait_until="domcontentloaded")
        try:
            self.page.wait_for_load_state("networkidle", timeout=10_000)
        except PWTimeout:
            pass
        state.lobby_url = self.page.url
        state.cookies_accepted = self.accept_cookies()
        state.modals_closed = self.close_modals()
        self.detect_block()

    def detect_block(self) -> None:
        """Lanza RuntimeError('BLOCK: ...') si la página es un muro de geo/anti-bot."""
        try:
            body = self.page.locator("body").inner_text(timeout=5_000)[:5000]
        except Exception:
            body = ""
        m = BLOCK_PATTERNS.search(body + " " + self.page.title())
        if m:
            raise RuntimeError(f"BLOCK: página bloqueada ({m.group(0)})")

    def accept_cookies(self) -> bool:
        for sel in C.COOKIE_ACCEPT_SELECTORS:
            try:
                btn = self.page.locator(sel).first
                if btn.is_visible(timeout=1_500):
                    btn.click()
                    self.tl.add("LOBBY", f"Cookies aceptadas ({sel})")
                    return True
            except Exception:
                continue
        return False

    def close_modals(self, rounds: int = 3) -> int:
        closed = 0
        for _ in range(rounds):
            hit = False
            for sel in C.MODAL_CLOSE_SELECTORS:
                try:
                    el = self.page.locator(sel).first
                    if el.is_visible(timeout=700):
                        el.click()
                        closed += 1
                        hit = True
                        time.sleep(0.4)
                except Exception:
                    continue
            if not hit:
                try:
                    self.page.keyboard.press("Escape")
                except Exception:
                    pass
                break
        return closed

    # ------------------------------------------------------------------ #
    def find_game(self, game_name: str) -> LobbyState:
        t0 = time.time()
        state = LobbyState(status=Verdict.FAIL, game_name_requested=game_name)
        try:
            self.open_lobby(state)
            state.screenshots.append(self.drv.screenshot("lobby"))

            tile = self._search_via_input(game_name, state) or self._search_via_scroll(game_name, state)
            if tile is None and self.vision:
                tile = self._search_via_vision(game_name, state)

            if tile is None:
                state.error = f"Juego '{game_name}' no encontrado en el lobby"
                state.screenshots.append(self.drv.screenshot("lobby_not_found", full_page=True))
                return state

            self.tile = tile
            tile.scroll_into_view_if_needed()
            self._verify_tile(tile, state)
            state.screenshots.append(self.drv.screenshot("lobby_tile", target=tile))
            state.screenshots.append(self.drv.screenshot("lobby_tile_context"))
            state.status = Verdict.PASS if state.tile_visible else Verdict.FAIL
        except RuntimeError as e:
            state.status = Verdict.BLOCK if str(e).startswith("BLOCK") else Verdict.FAIL
            state.error = str(e)
            state.screenshots.append(self.drv.screenshot("lobby_blocked"))
        except Exception as e:
            state.error = f"{type(e).__name__}: {e}"
            state.screenshots.append(self.drv.screenshot("lobby_error"))
        finally:
            state.duration_ms = int((time.time() - t0) * 1000)
        return state

    def _search_via_input(self, game_name: str, state: LobbyState) -> Optional[Locator]:
        search = self._find_search_input()
        if search is None:
            return None
        search.fill(game_name)
        search.press("Enter")
        time.sleep(2.0)
        tile = self._best_tile(game_name, state)
        if tile:
            state.strategy = "search"
            self.tl.add("LOBBY", f"Juego encontrado vía buscador: {state.game_name_found}",
                        score=state.match_score)
        return tile

    def _find_search_input(self) -> Optional[Locator]:
        for sel in C.SEARCH_INPUT_SELECTORS:
            loc = self.page.locator(sel).first
            try:
                if loc.is_visible(timeout=1_000):
                    return loc
            except Exception:
                pass
        for sel in C.SEARCH_OPEN_SELECTORS:   # buscador oculto tras un icono
            try:
                btn = self.page.locator(sel).first
                if btn.is_visible(timeout=1_000):
                    btn.click()
                    for s2 in C.SEARCH_INPUT_SELECTORS:
                        loc = self.page.locator(s2).first
                        if loc.is_visible(timeout=2_000):
                            return loc
            except Exception:
                continue
        return None

    def _search_via_scroll(self, game_name: str, state: LobbyState) -> Optional[Locator]:
        for i in range(C.LOBBY_MAX_SCROLLS):
            tile = self._best_tile(game_name, state)
            if tile:
                state.strategy = "scroll"
                self.tl.add("LOBBY", f"Juego encontrado tras {i} scrolls", score=state.match_score)
                return tile
            self.page.mouse.wheel(0, 900)
            time.sleep(0.8)
        return None

    def _search_via_vision(self, game_name: str, state: LobbyState) -> Optional[Locator]:
        """Fallback IA: localiza el tile por imagen y devuelve el elemento bajo esas coordenadas."""
        shot = self.drv.screenshot("lobby_vision_search")
        resp = self.vision.locate_text(shot, game_name, C.VIEWPORT["width"], C.VIEWPORT["height"])
        if resp.action == "click" and resp.x is not None and resp.confidence >= C.VISION_MIN_CONFIDENCE:
            handle = self.page.evaluate_handle(
                "([x,y]) => { let e = document.elementFromPoint(x,y);"
                " return e ? (e.closest('a,button,[role=button],[class*=game i]') || e) : null }",
                [resp.x, resp.y])
            el = handle.as_element()
            if el:
                state.strategy = "search"
                state.game_name_found = f"{game_name} (IA)"
                state.match_score = resp.confidence * 100
                self.tl.add("LOBBY", f"Juego localizado por IA en ({resp.x},{resp.y})",
                            confidence=resp.confidence)
                return _ElementLocatorAdapter(el)  # type: ignore[return-value]
        return None

    def _best_tile(self, game_name: str, state: LobbyState, min_score: int = 80) -> Optional[Locator]:
        best, best_score, best_text = None, 0.0, None
        target = game_name.lower()
        for sel in TILE_CANDIDATE_SELECTORS:
            loc = self.page.locator(sel)
            try:
                n = min(loc.count(), 200)
            except Exception:
                continue
            for i in range(n):
                el = loc.nth(i)
                try:
                    text = " ".join(filter(None, [
                        el.get_attribute("aria-label") or "",
                        el.get_attribute("title") or "",
                        el.inner_text(timeout=300) or "",
                        el.locator("img").first.get_attribute("alt", timeout=300) or "",
                    ])).strip().lower()
                except Exception:
                    continue
                if not text:
                    continue
                score = max(fuzz.partial_ratio(target, text), fuzz.token_set_ratio(target, text))
                if score > best_score:
                    best, best_score, best_text = el, score, text[:80]
            if best_score >= 95:
                break
        if best is not None and best_score >= min_score:
            state.game_name_found, state.match_score = best_text, float(best_score)
            return best
        return None

    def _verify_tile(self, tile, state: LobbyState) -> None:
        box = tile.bounding_box()
        if box:
            state.tile_bbox = BoundingBox(**box)
            vw, vh = C.VIEWPORT["width"], C.VIEWPORT["height"]
            in_viewport = box["width"] > 20 and box["height"] > 20 and box["x"] < vw and box["y"] < vh \
                and box["x"] + box["width"] > 0 and box["y"] + box["height"] > 0
            state.tile_visible = tile.is_visible() and in_viewport
        try:
            state.tile_image_loaded = bool(tile.evaluate(
                "el => { const i = el.tagName==='IMG' ? el : el.querySelector('img');"
                " return !i || (i.complete && i.naturalWidth > 0); }"))
        except Exception:
            state.tile_image_loaded = False

    # ------------------------------------------------------------------ #
    def open_game(self) -> None:
        """Clic en el tile (hover + botón 'Play/Demo' si aparece)."""
        if self.tile is None:
            raise RuntimeError("No hay tile seleccionado")
        self.tile.hover()
        time.sleep(0.5)
        for sel in C.PLAY_BUTTON_SELECTORS:
            try:
                btn = self.tile.locator(sel).first
                if btn.is_visible(timeout=800):
                    btn.click()
                    self.tl.add("LAUNCH", f"Clic en botón de juego ({sel})")
                    return
            except Exception:
                continue
        self.tile.click()
        self.tl.add("LAUNCH", "Clic directo en tile")
        # Algunos lobbies abren una ficha del juego con su propio botón "Jugar/Demo"
        time.sleep(1.5)
        for sel in C.PLAY_BUTTON_SELECTORS:
            try:
                btn = self.page.locator(sel).first
                if btn.is_visible(timeout=1_000):
                    btn.click()
                    self.tl.add("LAUNCH", f"Clic en botón de la ficha ({sel})")
                    return
            except Exception:
                continue


class _ElementLocatorAdapter:
    """Envuelve un ElementHandle con la API mínima de Locator que usa este módulo."""

    def __init__(self, el) -> None:
        self._el = el

    def scroll_into_view_if_needed(self):
        return self._el.scroll_into_view_if_needed()

    def bounding_box(self):
        return self._el.bounding_box()

    def is_visible(self):
        return self._el.is_visible()

    def evaluate(self, expr):
        return self._el.evaluate(expr)

    def screenshot(self, **kw):
        return self._el.screenshot(**kw)

    def hover(self):
        return self._el.hover()

    def click(self):
        return self._el.click()

    def locator(self, sel):
        class _Nothing:
            first = None

            def is_visible(self, timeout=0):
                return False
        n = _Nothing()
        n.first = n
        return n
