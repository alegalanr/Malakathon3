"""
BrowserDriver: arranque y ciclo de vida de Playwright.

Responsabilidades
- Lanzar Chrome/Chromium (headed por defecto) con flags que reducen la huella de automatización.
- Contexto con locale, timezone, geolocalización, viewport, vídeo y storageState (sesión persistida).
- Captura de red (peticiones de jugada, errores 4xx/5xx), consola y WebSockets → evidencias.
- Trace de Playwright (trace.zip) para depuración y para el reporte.

Uso:
    with BrowserDriver(run_cfg, logger) as drv:
        page = drv.page
        ...
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from config import config as C

# Script inyectado antes de cualquier script de la página: oculta señales típicas de automatización.
STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', {get: () => ['es-ES', 'es', 'en-US', 'en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
const _q = window.navigator.permissions && window.navigator.permissions.query;
if (_q) {
  window.navigator.permissions.query = (p) =>
    p && p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : _q(p);
}
"""

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--autoplay-policy=no-user-gesture-required",   # juegos con audio/vídeo de intro
    "--disable-features=IsolateOrigins,site-per-process",  # facilita acceso a iframes cross-origin
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
]


class BrowserDriver:
    def __init__(self, run_cfg: C.RunConfig, logger, timeline=None) -> None:
        self.cfg = run_cfg
        self.log = logger
        self.timeline = timeline
        self._pw: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

        # Evidencias de red/consola recogidas durante toda la ejecución
        self.network_log: list[dict] = []
        self.spin_requests: list[dict] = []
        self.failed_requests: list[str] = []
        self.console_errors: list[str] = []
        self.ws_frames_sent: int = 0
        self._spin_re = re.compile("|".join(C.SPIN_URL_PATTERNS), re.IGNORECASE)
        self._capture_spins = False   # se activa sólo durante la fase PLAY

        self.video_path: Optional[str] = None
        self.trace_path: Optional[str] = None

    # ------------------------------------------------------------------ #
    def start(self) -> Page:
        self._pw = sync_playwright().start()
        launch_kwargs = dict(headless=self.cfg.headless, args=LAUNCH_ARGS, slow_mo=C.SLOW_MO_MS)
        if C.BROWSER_CHANNEL:
            launch_kwargs["channel"] = C.BROWSER_CHANNEL
        try:
            self.browser = self._pw.chromium.launch(**launch_kwargs)
        except Exception as e:  # canal "chrome" no instalado → Chromium de Playwright
            self.log.warning(f"No se pudo lanzar canal '{C.BROWSER_CHANNEL}' ({e}); uso Chromium")
            launch_kwargs.pop("channel", None)
            self.browser = self._pw.chromium.launch(**launch_kwargs)

        site = self.cfg.site
        ctx_kwargs = dict(
            viewport=C.VIEWPORT,
            locale=site.locale,
            timezone_id=site.timezone_id,
            geolocation=site.geolocation,
            permissions=["geolocation"],
            ignore_https_errors=True,
            user_agent=None,  # UA real del canal Chrome (no "HeadlessChrome")
        )
        if C.STORAGE_STATE_FILE.exists():
            ctx_kwargs["storage_state"] = str(C.STORAGE_STATE_FILE)
            self.log.info("Sesión previa cargada desde ./auth/storage_state.json")
        if C.RECORD_VIDEO:
            ctx_kwargs["record_video_dir"] = str(self.cfg.report_dir / "video")
            ctx_kwargs["record_video_size"] = C.VIEWPORT

        self.context = self.browser.new_context(**{k: v for k, v in ctx_kwargs.items() if v is not None})
        self.context.add_init_script(STEALTH_INIT_SCRIPT)
        self.context.set_default_timeout(C.ACTION_TIMEOUT_MS)
        self.context.set_default_navigation_timeout(C.NAV_TIMEOUT_MS)
        if C.RECORD_TRACE:
            self.context.tracing.start(screenshots=True, snapshots=True, sources=False)

        self.page = self.context.new_page()
        self._attach_listeners(self.page)
        self.context.on("page", self._attach_listeners)   # popups/nuevas pestañas del juego
        return self.page

    # ------------------------------------------------------------------ #
    def _attach_listeners(self, page: Page) -> None:
        page.on("request", self._on_request)
        page.on("response", self._on_response)
        page.on("console", lambda m: m.type == "error" and self.console_errors.append(m.text[:300]))
        page.on("pageerror", lambda e: self.console_errors.append(f"pageerror: {str(e)[:300]}"))
        page.on("websocket", self._on_websocket)

    def _on_request(self, req) -> None:
        if self._capture_spins and req.method in ("POST", "PUT", "GET") and self._spin_re.search(req.url):
            if req.resource_type in ("xhr", "fetch", "other"):
                self.spin_requests.append({"url": req.url[:300], "method": req.method, "t": time.time()})

    def _on_response(self, resp) -> None:
        if resp.status >= 400 and resp.request.resource_type in ("xhr", "fetch", "document", "script"):
            self.failed_requests.append(f"{resp.status} {resp.url[:200]}")

    def _on_websocket(self, ws) -> None:
        def sent(_payload):
            if self._capture_spins:
                self.ws_frames_sent += 1
        ws.on("framesent", sent)

    # ------------------------------------------------------------------ #
    def begin_play_capture(self) -> None:
        self.spin_requests.clear()
        self.ws_frames_sent = 0
        self._capture_spins = True

    def end_play_capture(self) -> None:
        self._capture_spins = False

    def screenshot(self, name: str, full_page: bool = False, target=None) -> str:
        """Guarda ./screenshots/<run_id>/<NN>_<name>.png y devuelve ruta relativa."""
        idx = len(list(self.cfg.screenshots_dir.glob("*.png"))) + 1
        path = self.cfg.screenshots_dir / f"{idx:02d}_{name}.png"
        try:
            (target or self.page).screenshot(path=str(path), **({} if target else {"full_page": full_page}))
        except Exception as e:
            self.log.warning(f"Captura '{name}' fallida: {e}")
            self.page.screenshot(path=str(path))
        return C.rel(path)

    def save_session(self) -> None:
        if self.context:
            self.context.storage_state(path=str(C.STORAGE_STATE_FILE))

    # ------------------------------------------------------------------ #
    def stop(self) -> None:
        try:
            if self.context and C.RECORD_TRACE:
                trace = self.cfg.report_dir / "trace.zip"
                self.context.tracing.stop(path=str(trace))
                self.trace_path = C.rel(trace)
        except Exception as e:
            self.log.warning(f"No se pudo guardar trace: {e}")
        try:
            video = self.page.video if self.page else None
            if self.context:
                self.context.close()
            if video:
                self.video_path = C.rel(Path(video.path()))
        except Exception as e:
            self.log.warning(f"Cierre de contexto: {e}")
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    def __enter__(self) -> "BrowserDriver":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()
