"""
GameLauncher: lanza el juego desde el lobby, resuelve la superficie de render
(página → iframe(s) anidados → <canvas>), verifica el renderizado y ejecuta la
jugada con ayuda del VisionSolver.

Salidas: LaunchState (fase LAUNCH) y PlayState (fase PLAY) — ver utils/models.py.
"""
from __future__ import annotations

import io
import time
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import ElementHandle, Frame, Page

from config import config as C
from utils.models import (BoundingBox, LaunchState, PlayEvidence, PlayState, VisionRequest,
                          VisionResponse, Verdict)


# --------------------------------------------------------------------------- #
# Utilidades de imagen
# --------------------------------------------------------------------------- #
def image_std(png: bytes) -> float:
    return float(np.array(Image.open(io.BytesIO(png)).convert("L")).std())


def diff_ratio(png_a: bytes, png_b: bytes, pixel_threshold: int = 25) -> float:
    a = np.array(Image.open(io.BytesIO(png_a)).convert("L"), dtype=np.int16)
    b = np.array(Image.open(io.BytesIO(png_b)).convert("L"), dtype=np.int16)
    if a.shape != b.shape:
        b = np.array(Image.open(io.BytesIO(png_b)).convert("L").resize(a.shape[::-1]), dtype=np.int16)
    return float((np.abs(a - b) > pixel_threshold).mean())


def annotate_click(png_path, x: int, y: int, label: str = "") -> None:
    """Dibuja un círculo rojo + etiqueta sobre la captura donde se hizo clic."""
    img = Image.open(png_path).convert("RGB")
    d = ImageDraw.Draw(img)
    r = 18
    d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 0, 0), width=4)
    d.line([x - 6, y, x + 6, y], fill=(255, 0, 0), width=2)
    d.line([x, y - 6, x, y + 6], fill=(255, 0, 0), width=2)
    if label:
        d.rectangle([x + r + 4, y - 12, x + r + 12 + 7 * len(label), y + 10], fill=(255, 0, 0))
        d.text((x + r + 8, y - 9), label, fill=(255, 255, 255))
    img.save(png_path)


class GameLauncher:
    def __init__(self, driver, logger, timeline, vision=None) -> None:
        self.drv = driver
        self.log = logger
        self.tl = timeline
        self.vision = vision
        self.game_page: Page = driver.page
        self.game_frame: Optional[Frame] = None
        self.surface: Optional[ElementHandle] = None   # canvas o iframe donde se juega
        self.surface_kind = "unknown"

    # ================================================================== #
    # FASE LAUNCH
    # ================================================================== #
    def launch(self, lobby_navigator) -> LaunchState:
        t0 = time.time()
        st = LaunchState(status=Verdict.FAIL)
        pages_before = len(self.drv.context.pages)
        errors_before = len(self.drv.console_errors)
        fails_before = len(self.drv.failed_requests)
        try:
            lobby_navigator.open_game()

            # ¿El juego abrió nueva pestaña?
            time.sleep(1.0)
            if len(self.drv.context.pages) > pages_before:
                self.game_page = self.drv.context.pages[-1]
                self.game_page.bring_to_front()
                self.drv.page = self.game_page
                self.tl.add("LAUNCH", "El juego abrió una nueva pestaña")
            self.game_page.wait_for_load_state("domcontentloaded")
            lobby_navigator.close_modals(rounds=1)
            st.game_url = self.game_page.url

            if not self._resolve_surface(st, timeout_ms=C.GAME_LOAD_TIMEOUT_MS):
                st.error = "No se encontró iframe/canvas del juego"
                st.screenshots.append(self.drv.screenshot("launch_no_surface"))
                return st

            st.canvas_rendered = self._wait_render_stable(timeout_ms=C.GAME_LOAD_TIMEOUT_MS)
            st.load_time_ms = int((time.time() - t0) * 1000)
            st.screenshots.append(self.drv.screenshot("game_loaded"))
            box = self.surface.bounding_box() if self.surface else None
            if box:
                st.canvas_bbox = BoundingBox(**box)

            st.console_errors = self.drv.console_errors[errors_before:][:20]
            st.failed_requests = self.drv.failed_requests[fails_before:][:20]
            st.status = Verdict.PASS if st.canvas_rendered else Verdict.FAIL
            if not st.canvas_rendered:
                st.error = "La superficie del juego no renderizó (imagen vacía/negra)"
            self.tl.add("LAUNCH", f"Juego cargado en {st.load_time_ms} ms (render={st.canvas_rendered})",
                        screenshot=st.screenshots[-1])
        except Exception as e:
            st.error = f"{type(e).__name__}: {e}"
            st.screenshots.append(self.drv.screenshot("launch_error"))
        finally:
            if not st.load_time_ms:
                st.load_time_ms = int((time.time() - t0) * 1000)
        return st

    def _resolve_surface(self, st: LaunchState, timeout_ms: int) -> bool:
        """Busca un <canvas> visible en la página o en cualquier frame (anidado). Si no, el iframe mayor."""
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            # 1) canvas en cualquier frame (Playwright ve frames cross-origin)
            best, best_area, best_frame = None, 0, None
            for fr in self.game_page.frames:
                try:
                    for c in fr.query_selector_all("canvas"):
                        b = c.bounding_box()
                        if b and b["width"] * b["height"] > best_area and b["width"] > 200:
                            best, best_area, best_frame = c, b["width"] * b["height"], fr
                except Exception:
                    continue
            if best is not None:
                self.surface, self.game_frame, self.surface_kind = best, best_frame, "canvas"
                st.canvas_found = True
                st.iframe_found = best_frame != self.game_page.main_frame
                st.iframe_src = best_frame.url[:300] if st.iframe_found else None
                st.render_surface = "canvas"
                self.tl.add("LAUNCH", f"Canvas detectado ({int(best_area)} px²)", frame=st.iframe_src)
                return True

            # 2) iframe grande (el canvas puede estar en shadow DOM o tardar)
            iframes = []
            for sel in C.GAME_IFRAME_SELECTORS:
                for f in self.game_page.query_selector_all(sel):
                    b = f.bounding_box()
                    if b and b["width"] > 300 and b["height"] > 200:
                        iframes.append((b["width"] * b["height"], f))
            if iframes and time.time() > deadline - timeout_ms / 2000:  # a mitad del timeout acepta iframe
                _, f = max(iframes, key=lambda t: t[0])
                self.surface, self.surface_kind = f, "iframe"
                self.game_frame = f.content_frame()
                st.iframe_found, st.render_surface = True, "iframe"
                st.iframe_src = (f.get_attribute("src") or "")[:300]
                self.tl.add("LAUNCH", "Usando iframe como superficie (sin canvas accesible)")
                return True
            time.sleep(1.0)
        return False

    def surface_png(self) -> bytes:
        try:
            return self.surface.screenshot() if self.surface else self.game_page.screenshot()
        except Exception:
            return self.game_page.screenshot()

    def _wait_render_stable(self, timeout_ms: int) -> bool:
        """Render OK = imagen con varianza > umbral durante CANVAS_STABLE_SECONDS seguidos."""
        deadline = time.time() + timeout_ms / 1000
        ok_since = None
        while time.time() < deadline:
            std = image_std(self.surface_png())
            if std > C.CANVAS_MIN_STD:
                ok_since = ok_since or time.time()
                if time.time() - ok_since >= C.CANVAS_STABLE_SECONDS:
                    return True
            else:
                ok_since = None
            time.sleep(0.7)
        return False

    # ================================================================== #
    # FASE PLAY
    # ================================================================== #
    def play_round(self) -> PlayState:
        t0 = time.time()
        ps = PlayState(status=Verdict.INCONCLUSIVE, evidence=PlayEvidence())
        if self.vision is None:
            ps.status, ps.error = Verdict.BLOCK, "VisionSolver no configurado (falta API key)"
            return ps

        ev = ps.evidence
        history: list[str] = []
        spin_clicked = False
        before_spin_png: Optional[bytes] = None
        self.drv.begin_play_capture()
        try:
            for step in range(1, C.GAME_AGENT_MAX_STEPS + 1):
                png = self.surface_png()
                shot_path = self.drv.cfg.screenshots_dir / f"play_step_{step:02d}.png"
                shot_path.write_bytes(png)
                w, h = Image.open(io.BytesIO(png)).size

                resp: VisionResponse = self.vision.analyze(VisionRequest(
                    image_path=C.rel(shot_path), image_width=w, image_height=h, step=step, history=history))
                step_rec = resp.to_dict() | {"step": step, "screenshot": C.rel(shot_path)}
                ev.steps.append(step_rec)
                if resp.balance_text and ev.balance_before is None:
                    ev.balance_before = resp.balance_text
                self.tl.add("PLAY", f"[{step}] state={resp.state} action={resp.action} "
                                    f"target='{resp.target}' conf={resp.confidence:.2f}",
                            screenshot=C.rel(shot_path))

                # ¿Terminó la ronda?
                if spin_clicked and resp.state in ("result", "ready"):
                    ev.vision_saw_result = resp.state == "result" or ev.vision_saw_result
                    ev.balance_after = resp.balance_text
                    after_png = png
                    ev.visual_diff_ratio = diff_ratio(before_spin_png, after_png) if before_spin_png else 0
                    ps.rounds_played = 1
                    break

                if resp.state == "error":
                    ps.error = f"El juego muestra un error: {resp.reason}"
                    break

                if resp.action == "click" and resp.x is not None and resp.confidence >= C.VISION_MIN_CONFIDENCE:
                    is_spin = resp.state == "ready"
                    if is_spin:
                        before_spin_png = png
                    self._click_on_surface(resp.x, resp.y, w, h)
                    annotate_click(shot_path, resp.x, resp.y, resp.target[:24])
                    history.append(f"step {step}: clicked '{resp.target}' at ({resp.x},{resp.y}) in state {resp.state}")
                    if is_spin:
                        spin_clicked = True
                        ps.screenshots.append(C.rel(shot_path))
                        time.sleep(4.0)   # duración típica de un giro
                        continue
                    time.sleep(1.5)
                else:
                    history.append(f"step {step}: waited (state {resp.state})")
                    time.sleep(2.0)
            else:
                if spin_clicked and before_spin_png:
                    ev.visual_diff_ratio = diff_ratio(before_spin_png, self.surface_png())

            ps.screenshots.append(self.drv.screenshot("after_play"))
        except Exception as e:
            ps.error = f"{type(e).__name__}: {e}"
            ps.screenshots.append(self.drv.screenshot("play_error"))
        finally:
            time.sleep(1.0)
            self.drv.end_play_capture()
            ev.spin_requests = list(self.drv.spin_requests)[:20]
            ev.ws_frames = self.drv.ws_frames_sent
            ps.duration_ms = int((time.time() - t0) * 1000)

        ps.status = self.judge_play(ps, spin_clicked)
        return ps

    def _click_on_surface(self, x: int, y: int, img_w: int, img_h: int) -> None:
        """Convierte coordenadas de la imagen de la superficie a coordenadas de página y hace clic."""
        box = self.surface.bounding_box() if self.surface else None
        if not box:
            self.game_page.mouse.click(x, y)
            return
        sx, sy = box["width"] / img_w, box["height"] / img_h   # corrige deviceScaleFactor
        px, py = box["x"] + x * sx, box["y"] + y * sy
        self.game_page.mouse.move(px, py, steps=8)
        time.sleep(0.15)
        self.game_page.mouse.click(px, py, delay=60)

    @staticmethod
    def judge_play(ps: PlayState, spin_clicked: bool) -> Verdict:
        """Reglas del veredicto de la fase PLAY (la IA aporta evidencia, no decide sola)."""
        ev = ps.evidence
        net = bool(ev.spin_requests) or ev.ws_frames > 0
        visual = ev.visual_diff_ratio >= C.VISUAL_DIFF_THRESHOLD
        balance = bool(ev.balance_before and ev.balance_after and ev.balance_before != ev.balance_after)
        if ps.error and "error" in (ps.error or "").lower() and not spin_clicked:
            return Verdict.FAIL
        if not spin_clicked:
            return Verdict.FAIL if ev.steps else Verdict.INCONCLUSIVE
        if net and (visual or balance or ev.vision_saw_result):
            return Verdict.PASS
        if visual and (balance or ev.vision_saw_result):
            return Verdict.PASS          # evidencia visual fuerte sin red identificable
        return Verdict.INCONCLUSIVE
