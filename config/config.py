"""
Configuración central del proyecto.

Todas las rutas son RELATIVAS a la raíz del proyecto (se resuelven a partir de
la ubicación de este archivo), de modo que el proyecto es portable a cualquier
máquina o carpeta. Los secretos se leen de variables de entorno / fichero .env.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Raíz del proyecto = carpeta padre de ./config
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "y", "si", "sí"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# Rutas relativas de salida
# --------------------------------------------------------------------------- #
SCREENSHOTS_DIR = PROJECT_ROOT / "screenshots"
REPORTS_DIR = PROJECT_ROOT / "reports"
AUTH_DIR = PROJECT_ROOT / "auth"            # storageState (cookies/sesión), NO versionar
STORAGE_STATE_FILE = AUTH_DIR / "storage_state.json"

for _d in (SCREENSHOTS_DIR, REPORTS_DIR, AUTH_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def rel(path: Path | str) -> str:
    """Convierte una ruta en relativa a la raíz del proyecto (formato POSIX) para reportes."""
    p = Path(path).resolve()
    try:
        return p.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return p.name


# --------------------------------------------------------------------------- #
# Sitios objetivo (ajustar mañana con las URLs/cuentas que facilite Betsson)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class SiteConfig:
    key: str
    base_url: str
    lobby_path: str = "/casino"
    locale: str = "es-ES"
    timezone_id: str = "Europe/Madrid"
    geolocation: dict = field(default_factory=lambda: {"latitude": 36.7213, "longitude": -4.4214})

    @property
    def lobby_url(self) -> str:
        return self.base_url.rstrip("/") + self.lobby_path


SITES: dict[str, SiteConfig] = {
    "betsson_com": SiteConfig(key="betsson_com", base_url="https://www.betsson.com", lobby_path="/en/casino",
                              locale="en-GB"),
    "betsson_es": SiteConfig(key="betsson_es", base_url="https://www.betsson.es", lobby_path="/casino"),
    # Casino simulado local para ensayos offline: python -m http.server 8000 --directory mock_casino
    "mock": SiteConfig(key="mock", base_url="http://localhost:8000", lobby_path="/index.html"),
}

DEFAULT_SITE = os.getenv("SITE", "betsson_com")
DEFAULT_GAME = os.getenv("GAME_NAME", "Starburst")


# --------------------------------------------------------------------------- #
# Credenciales de prueba (NUNCA hardcodear: van en .env)
# --------------------------------------------------------------------------- #
TEST_USERNAME = os.getenv("BETSSON_USERNAME", "")
TEST_PASSWORD = os.getenv("BETSSON_PASSWORD", "")


# --------------------------------------------------------------------------- #
# IA / Visión
# --------------------------------------------------------------------------- #
VISION_PROVIDER = os.getenv("VISION_PROVIDER", "anthropic")  # "anthropic" | "openai"
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
VISION_MAX_TOKENS = _env_int("VISION_MAX_TOKENS", 400)
VISION_MIN_CONFIDENCE = float(os.getenv("VISION_MIN_CONFIDENCE", "0.55"))


# --------------------------------------------------------------------------- #
# Navegador
# --------------------------------------------------------------------------- #
HEADLESS = _env_bool("HEADLESS", False)          # headed reduce bloqueos anti-bot
BROWSER_CHANNEL = os.getenv("BROWSER_CHANNEL", "chrome")  # "chrome" | "msedge" | "" (chromium)
VIEWPORT = {"width": _env_int("VIEWPORT_W", 1366), "height": _env_int("VIEWPORT_H", 768)}
SLOW_MO_MS = _env_int("SLOW_MO_MS", 0)
RECORD_VIDEO = _env_bool("RECORD_VIDEO", True)
RECORD_TRACE = _env_bool("RECORD_TRACE", True)


# --------------------------------------------------------------------------- #
# Timeouts (ms) y límites
# --------------------------------------------------------------------------- #
NAV_TIMEOUT_MS = _env_int("NAV_TIMEOUT_MS", 45_000)
ACTION_TIMEOUT_MS = _env_int("ACTION_TIMEOUT_MS", 15_000)
GAME_LOAD_TIMEOUT_MS = _env_int("GAME_LOAD_TIMEOUT_MS", 60_000)
CANVAS_STABLE_SECONDS = _env_int("CANVAS_STABLE_SECONDS", 3)
GAME_AGENT_MAX_STEPS = _env_int("GAME_AGENT_MAX_STEPS", 12)
GLOBAL_RUN_TIMEOUT_S = _env_int("GLOBAL_RUN_TIMEOUT_S", 300)
LOBBY_MAX_SCROLLS = _env_int("LOBBY_MAX_SCROLLS", 15)


# --------------------------------------------------------------------------- #
# Heurísticas de verificación
# --------------------------------------------------------------------------- #
# Patrones de URL que suelen indicar una jugada en el servidor del proveedor.
# Ajustar tras inspeccionar DevTools → Network en juegos reales.
SPIN_URL_PATTERNS = [r"spin", r"/play", r"bet", r"round", r"wager", r"gameplay", r"doSpin", r"action"]
CANVAS_MIN_STD = float(os.getenv("CANVAS_MIN_STD", "12"))   # varianza mínima: canvas "no vacío"
VISUAL_DIFF_THRESHOLD = float(os.getenv("VISUAL_DIFF_THRESHOLD", "0.02"))  # 2% de píxeles cambiados

# Selectores genéricos (fallbacks; se prueban en orden)
COOKIE_ACCEPT_SELECTORS = [
    "#onetrust-accept-btn-handler",
    "button#accept-recommended-btn-handler",
    "[data-test-id*='accept' i]",
    "button:has-text('Accept all')",
    "button:has-text('Accept')",
    "button:has-text('Aceptar todo')",
    "button:has-text('Aceptar')",
    "button:has-text('Godkänn')",
]
MODAL_CLOSE_SELECTORS = [
    "[aria-label='Close' i]",
    "[aria-label='Cerrar' i]",
    "button:has-text('Close')",
    "button:has-text('Cerrar')",
    "button:has-text('No thanks')",
    "[data-test-id*='close' i]",
    ".modal [class*='close' i]",
]
SEARCH_INPUT_SELECTORS = [
    "input[type='search']",
    "input[placeholder*='Search' i]",
    "input[placeholder*='Buscar' i]",
    "[data-test-id*='search' i] input",
]
SEARCH_OPEN_SELECTORS = [
    "[aria-label*='search' i]",
    "[data-test-id*='search' i]",
    "button:has-text('Search')",
    "button:has-text('Buscar')",
]
PLAY_BUTTON_SELECTORS = [
    "button:has-text('Play for fun')",
    "button:has-text('Demo')",
    "button:has-text('Jugar gratis')",
    "button:has-text('Play now')",
    "button:has-text('Play')",
    "button:has-text('Jugar')",
]
GAME_IFRAME_SELECTORS = [
    "iframe[src*='game' i]",
    "iframe[id*='game' i]",
    "iframe[class*='game' i]",
    "iframe",
]


@dataclass
class RunConfig:
    """Parámetros de una ejecución concreta (CLI → orquestador)."""
    site: SiteConfig
    game_name: str
    run_id: str
    headless: bool = HEADLESS
    login: bool = False

    @property
    def screenshots_dir(self) -> Path:
        p = SCREENSHOTS_DIR / self.run_id
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def report_dir(self) -> Path:
        p = REPORTS_DIR / self.run_id
        p.mkdir(parents=True, exist_ok=True)
        return p
