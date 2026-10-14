"""
Contratos de datos compartidos entre módulos (ver README §4).

Todos los objetos son dataclasses serializables a JSON con .to_dict().
Las rutas a capturas se guardan SIEMPRE relativas a la raíz del proyecto.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Literal, Optional


class Verdict(str, Enum):
    PASS = "PASS"            # Fase/test superado con evidencia suficiente
    FAIL = "FAIL"            # Defecto real del producto (juego no aparece, no carga, no juega)
    BLOCK = "BLOCK"          # No se pudo probar por causa externa (geo, captcha, login, red)
    INCONCLUSIVE = "INCONCLUSIVE"  # Hay indicios, pero no evidencia suficiente
    SKIPPED = "SKIPPED"      # No ejecutada porque una fase previa falló


class _Serializable:
    def to_dict(self) -> dict[str, Any]:
        def conv(v: Any) -> Any:
            if isinstance(v, Enum):
                return v.value
            if isinstance(v, list):
                return [conv(x) for x in v]
            if isinstance(v, dict):
                return {k: conv(x) for k, x in v.items()}
            return v
        return {k: conv(v) for k, v in asdict(self).items()}  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# LobbyNavigator → main.py
# --------------------------------------------------------------------------- #
@dataclass
class BoundingBox(_Serializable):
    x: float
    y: float
    width: float
    height: float


@dataclass
class LobbyState(_Serializable):
    status: Verdict
    game_name_requested: str
    game_name_found: Optional[str] = None
    match_score: float = 0.0                 # 0-100 (rapidfuzz)
    strategy: Literal["search", "scroll", "direct_url", "none"] = "none"
    tile_visible: bool = False
    tile_image_loaded: bool = False
    tile_bbox: Optional[BoundingBox] = None
    lobby_url: str = ""
    cookies_accepted: bool = False
    modals_closed: int = 0
    screenshots: list[str] = field(default_factory=list)
    duration_ms: int = 0
    error: Optional[str] = None


# --------------------------------------------------------------------------- #
# GameLauncher → main.py
# --------------------------------------------------------------------------- #
@dataclass
class LaunchState(_Serializable):
    status: Verdict
    game_url: str = ""
    iframe_found: bool = False
    iframe_src: Optional[str] = None
    canvas_found: bool = False
    canvas_rendered: bool = False            # varianza de píxeles > umbral
    canvas_bbox: Optional[BoundingBox] = None
    render_surface: Literal["canvas", "iframe", "page", "unknown"] = "unknown"
    load_time_ms: int = 0
    console_errors: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)
    error: Optional[str] = None


# --------------------------------------------------------------------------- #
# VisionSolver: petición y respuesta
# --------------------------------------------------------------------------- #
GameScreenState = Literal["loading", "splash", "tutorial", "popup", "ready",
                          "spinning", "result", "error", "unknown"]
VisionAction = Literal["click", "wait", "none"]


@dataclass
class VisionRequest(_Serializable):
    image_path: str                          # ruta relativa a la captura
    image_width: int                         # px de la imagen enviada
    image_height: int
    goal: str = "Play exactly one round in demo mode (press Spin/Play/Deal)."
    step: int = 0
    history: list[str] = field(default_factory=list)   # acciones previas (texto corto)


@dataclass
class VisionResponse(_Serializable):
    state: GameScreenState
    action: VisionAction
    x: Optional[int] = None                  # coordenadas en el sistema de la IMAGEN enviada
    y: Optional[int] = None
    target: str = ""                         # "Spin button", "Continue", ...
    confidence: float = 0.0                  # 0..1
    reason: str = ""
    balance_text: Optional[str] = None       # saldo leído por la IA, si es visible
    provider: str = ""
    model: str = ""
    latency_ms: int = 0
    raw: str = ""                            # respuesta cruda (debug)


# --------------------------------------------------------------------------- #
# Evidencias de la jugada
# --------------------------------------------------------------------------- #
@dataclass
class PlayEvidence(_Serializable):
    spin_requests: list[dict] = field(default_factory=list)   # [{url, method, status, t}]
    ws_frames: int = 0
    visual_diff_ratio: float = 0.0           # 0..1 píxeles cambiados antes/después
    balance_before: Optional[str] = None
    balance_after: Optional[str] = None
    vision_saw_result: bool = False
    steps: list[dict] = field(default_factory=list)            # VisionResponse.to_dict() + screenshot


@dataclass
class PlayState(_Serializable):
    status: Verdict
    rounds_played: int = 0
    evidence: PlayEvidence = field(default_factory=PlayEvidence)
    screenshots: list[str] = field(default_factory=list)
    duration_ms: int = 0
    error: Optional[str] = None


# --------------------------------------------------------------------------- #
# TestResult → ReportGenerator
# --------------------------------------------------------------------------- #
@dataclass
class PhaseResult(_Serializable):
    name: Literal["SESSION", "LOBBY", "LAUNCH", "PLAY"]
    status: Verdict
    duration_ms: int = 0
    summary: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    screenshots: list[str] = field(default_factory=list)


@dataclass
class TestResult(_Serializable):
    run_id: str
    site: str
    game_name: str
    started_at: str                          # ISO-8601
    finished_at: str = ""
    duration_ms: int = 0
    verdict: Verdict = Verdict.INCONCLUSIVE
    verdict_reason: str = ""
    ai_summary: str = ""
    phases: list[PhaseResult] = field(default_factory=list)
    timeline: list[dict] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)      # tiempos, coste IA, nº llamadas
    artifacts: dict[str, str] = field(default_factory=dict)    # video, trace, log (rutas relativas)
    environment: dict[str, Any] = field(default_factory=dict)  # browser, viewport, headless, versión
