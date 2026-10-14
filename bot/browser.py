"""
Sesión de navegador compartida por las etapas.

- Lanza Chromium con locale, zona horaria, geolocalización y viewport del mercado.
- Registra en segundo plano todo lo que necesita el veredicto: respuestas HTTP, fallos de red,
  errores de JavaScript, mensajes de consola y tráfico WebSocket (con marca de tiempo).
- Guarda la traza de Playwright (trace.zip) y el vídeo en la carpeta del run.
- `block` permite bloquear peticiones (page.route) para provocar un FAIL en la demo.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import BrowserContext, Page, sync_playwright

from bot import config as C
from bot.evidence import Run

log = logging.getLogger("bot")

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--autoplay-policy=no-user-gesture-required",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
]


class Session:
    def __init__(self, run: Run, headless: bool = C.HEADLESS, block: Optional[list[str]] = None) -> None:
        self.run = run
        self.headless = headless
        self.block = block or []
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._pw = None
        self._browser = None
        # Registro en bruto (lo consume la etapa 5)
        self.responses: list[dict] = []        # {t, url, method, status, type}
        self.failed: list[dict] = []           # {t, url, error}
        self.page_errors: list[dict] = []      # excepciones JS no capturadas
        self.console_errors: list[dict] = []   # console.error
        self.ws: list[dict] = []               # {t, dir: sent|received, url}

    # ------------------------------------------------------------------------
    def start(self) -> Page:
        self._pw = sync_playwright().start()
        kw = dict(headless=self.headless, args=LAUNCH_ARGS)
        if C.BROWSER_CHANNEL:
            kw["channel"] = C.BROWSER_CHANNEL
        try:
            self._browser = self._pw.chromium.launch(**kw)
        except Exception as e:
            log.warning("No se pudo abrir el canal '%s' (%s); uso Chromium de Playwright", C.BROWSER_CHANNEL, e)
            kw.pop("channel", None)
            self._browser = self._pw.chromium.launch(**kw)

        ctx_kw = dict(viewport=C.VIEWPORT, locale=C.LOCALE, timezone_id=C.TIMEZONE,
                      geolocation=C.GEOLOCATION, permissions=["geolocation"], ignore_https_errors=True)
        if C.AUTH_FILE.exists():
            ctx_kw["storage_state"] = str(C.AUTH_FILE)
            log.info("Sesión guardada cargada desde auth/storage_state.json")
        if C.RECORD_VIDEO:
            ctx_kw["record_video_dir"] = str(self.run.dir / "video")
            ctx_kw["record_video_size"] = C.VIEWPORT
        self.context = self._browser.new_context(**ctx_kw)
        self.context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        self.context.set_default_timeout(C.ACTION_TIMEOUT_MS)
        self.context.set_default_navigation_timeout(C.NAV_TIMEOUT_MS)
        self.context.tracing.start(screenshots=True, snapshots=True)

        for pattern in self.block:
            self.context.route(pattern, lambda route: route.abort())
            log.warning("Bloqueando peticiones que coinciden con '%s' (FAIL provocado)", pattern)

        self.page = self.context.new_page()
        self._listen(self.page)
        self.context.on("page", self._listen)
        return self.page

    def _listen(self, page: Page) -> None:
        page.on("response", lambda r: self.responses.append({
            "t": time.time(), "url": r.url[:400], "method": r.request.method,
            "status": r.status, "type": r.request.resource_type}))
        page.on("requestfailed", lambda r: self.failed.append({
            "t": time.time(), "url": r.url[:400], "method": r.method, "type": r.resource_type,
            "error": (r.failure or "")[:200]}))
        page.on("pageerror", lambda e: self.page_errors.append({"t": time.time(), "error": str(e)[:300]}))
        page.on("console", lambda m: m.type == "error" and self.console_errors.append(
            {"t": time.time(), "text": m.text[:300]}))
        page.on("websocket", self._on_ws)

    def _on_ws(self, ws) -> None:
        url = ws.url[:200]
        ws.on("framesent", lambda _p: self.ws.append({"t": time.time(), "dir": "sent", "url": url}))
        ws.on("framereceived", lambda _p: self.ws.append({"t": time.time(), "dir": "received", "url": url}))

    def use_page(self, page: Page) -> None:
        """Cambia la página activa (p. ej. si el juego se abre en una pestaña nueva)."""
        self.page = page
        page.bring_to_front()

    # ------------------------------------------------------------------------
    def stop(self) -> None:
        video = None
        try:
            if self.context:
                self.context.tracing.stop(path=str(self.run.dir / "trace.zip"))
        except Exception as e:
            log.warning("No se pudo guardar la traza: %s", e)
        try:
            video = self.page.video if self.page else None
            if self.context:
                self.context.close()
        except Exception as e:
            log.warning("Error al cerrar el contexto: %s", e)
        if video:
            try:
                self.run.evidence["video"] = Path(video.path()).relative_to(self.run.dir).as_posix()
            except Exception:
                pass
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()
        self.run.evidence["network"] = {
            "responses": self.responses[-500:], "failed": self.failed[-200:],
            "page_errors": self.page_errors, "console_errors": self.console_errors[-100:],
            "ws": self.ws[-500:]}

    def __enter__(self) -> "Session":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()
