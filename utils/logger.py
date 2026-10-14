"""
Logger del proyecto: consola con colores (rich) + fichero por ejecución + timeline
de eventos estructurados que consume el ReportGenerator.
"""
from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

try:
    from rich.logging import RichHandler
    _HAS_RICH = True
except ImportError:  # pragma: no cover
    _HAS_RICH = False


@dataclass
class TimelineEvent:
    t: float                     # epoch seconds
    phase: str                   # SESSION | LOBBY | LAUNCH | PLAY | VERDICT | REPORT
    level: str                   # INFO | WARN | ERROR
    message: str
    screenshot: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class Timeline:
    """Registro ordenado de eventos; se serializa en el reporte final."""

    def __init__(self) -> None:
        self.events: list[TimelineEvent] = []
        self.start = time.time()

    def add(self, phase: str, message: str, level: str = "INFO",
            screenshot: str | None = None, **data: Any) -> TimelineEvent:
        ev = TimelineEvent(t=time.time(), phase=phase, level=level, message=message,
                           screenshot=screenshot, data=data)
        self.events.append(ev)
        return ev

    def to_list(self) -> list[dict]:
        return [e.to_dict() | {"elapsed_s": round(e.t - self.start, 2)} for e in self.events]


def get_logger(name: str = "casino_qa", log_file: Path | None = None, level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        if log_file and not any(isinstance(h, logging.FileHandler) for h in logger.handlers):
            _add_file_handler(logger, log_file)
        return logger

    logger.setLevel(level)
    if _HAS_RICH:
        handler: logging.Handler = RichHandler(rich_tracebacks=True, show_path=False, markup=True)
        handler.setFormatter(logging.Formatter("%(message)s", datefmt="%H:%M:%S"))
    else:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", "%H:%M:%S"))
    logger.addHandler(handler)
    if log_file:
        _add_file_handler(logger, log_file)
    logger.propagate = False
    return logger


def _add_file_handler(logger: logging.Logger, log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logger.addHandler(fh)
