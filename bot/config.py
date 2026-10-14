"""
Configuración del bot. Única fuente de ajustes: el resto de módulos importa de aquí.

Todas las rutas son relativas a la raíz del repo (se calculan desde este fichero).
Los secretos y ajustes personales van en `.env`, que no se sube.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "si", "sí"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


# --- Rutas -------------------------------------------------------------------
RUNS_DIR = ROOT / "runs"                       # una carpeta por ejecución (no se sube)
AUTH_FILE = ROOT / "auth" / "storage_state.json"  # sesión guardada (no se sube)
SNAPSHOT_FILE = ROOT / "bot" / "data" / "lobby_snapshot.json"  # foto del lobby para el plan B de la etapa 2

# --- Objetivo ----------------------------------------------------------------
# URL del lobby. Por defecto, el casino simulado (mock_casino/).
LOBBY_URL = os.getenv("LOBBY_URL", "http://localhost:8000/index.html")

# --- Navegador ---------------------------------------------------------------
HEADLESS = _bool("HEADLESS", True)
BROWSER_CHANNEL = os.getenv("BROWSER_CHANNEL", "")   # "" = Chromium de Playwright; "chrome" = Chrome instalado
VIEWPORT = {"width": _int("VIEWPORT_W", 1366), "height": _int("VIEWPORT_H", 768)}
LOCALE = os.getenv("LOCALE", "es-ES")
TIMEZONE = os.getenv("TIMEZONE", "Europe/Madrid")
GEOLOCATION = {"latitude": _float("GEO_LAT", 36.7213), "longitude": _float("GEO_LON", -4.4214)}
RECORD_VIDEO = _bool("RECORD_VIDEO", True)

# --- Tiempos (ms / s) --------------------------------------------------------
NAV_TIMEOUT_MS = _int("NAV_TIMEOUT_MS", 45_000)
ACTION_TIMEOUT_MS = _int("ACTION_TIMEOUT_MS", 15_000)
GAME_LOAD_TIMEOUT_S = _int("GAME_LOAD_TIMEOUT_S", 60)
CANVAS_STABLE_S = _int("CANVAS_STABLE_S", 2)
SPIN_WAIT_S = _int("SPIN_WAIT_S", 6)          # cuánto esperar la petición de jugada tras lanzar el spin
ROUND_WAIT_S = _int("ROUND_WAIT_S", 5)        # cuánto dura, como mucho, una ronda
GLOBAL_TIMEOUT_S = _int("GLOBAL_TIMEOUT_S", 300)

# --- Heurísticas -------------------------------------------------------------
# Peticiones que cuentan como "jugada" (ajustar mirando DevTools > Network en juegos reales)
SPIN_URL_REGEX = os.getenv("SPIN_URL_REGEX", r"spin|/play|bet|round|wager|gameplay|doSpin")
CANVAS_MIN_STD = _float("CANVAS_MIN_STD", 12)  # desviación típica mínima de píxeles: canvas "no vacío"
NEW_BADGE_REGEX = r"\b(new|nuevo|nueva|novedad|nyhet|uusi|neu)\b"

COOKIE_REJECT_SELECTORS = [
    "#onetrust-reject-all-handler",
    "button:has-text('Reject all')",
    "button:has-text('Rechazar todo')",
    "button:has-text('Rechazar')",
    "button:has-text('Only necessary')",
    "button:has-text('Solo necesarias')",
    "button:has-text('Avvisa alla')",
]
COOKIE_ACCEPT_SELECTORS = [  # último recurso si no hay forma de rechazar
    "#onetrust-accept-btn-handler",
    "button:has-text('Accept all')",
    "button:has-text('Aceptar todo')",
    "button:has-text('Aceptar')",
]
MODAL_CLOSE_SELECTORS = [
    "[aria-label='Close' i]", "[aria-label='Cerrar' i]",
    "button:has-text('Close')", "button:has-text('Cerrar')", "button:has-text('No thanks')",
    "[data-test-id*='close' i]",
]
SEARCH_INPUT_SELECTORS = [
    "input[type='search']", "input[placeholder*='Search' i]", "input[placeholder*='Buscar' i]",
    "[data-test-id*='search' i] input",
]
TILE_SELECTORS = [
    "[data-test-id*='game' i]", "[data-testid*='game' i]", "[class*='game-tile' i]",
    "[class*='gameTile' i]", "[class*='game-card' i]", "a[href*='/game' i]",
]
PLAY_BUTTON_SELECTORS = [
    "button:has-text('Play for fun')", "button:has-text('Demo')", "button:has-text('Jugar gratis')",
    "button:has-text('Play now')", "button:has-text('Play')", "button:has-text('Jugar')",
]
BLOCK_PAGE_REGEX = (r"not available in your (country|region)|no disponible en tu (país|región)|"
                    r"access denied|verify you are human|just a moment|attention required|captcha")

# --- IA (plan B de la etapa 4) ----------------------------------------------
VISION_PROVIDER = os.getenv("VISION_PROVIDER", "anthropic")   # anthropic | openai
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
VISION_MIN_CONFIDENCE = _float("VISION_MIN_CONFIDENCE", 0.55)
VISION_MAX_STEPS = _int("VISION_MAX_STEPS", 10)
# Precio aproximado (USD por millón de tokens) para estimar ai_usage.usd; ajustar al modelo usado
AI_USD_PER_MTOK_IN = _float("AI_USD_PER_MTOK_IN", 3.0)
AI_USD_PER_MTOK_OUT = _float("AI_USD_PER_MTOK_OUT", 15.0)


def ai_configured() -> bool:
    return bool(ANTHROPIC_API_KEY if VISION_PROVIDER == "anthropic" else OPENAI_API_KEY)
