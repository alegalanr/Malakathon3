"""
Evidencias de una ejecución: carpeta runs/<run_id>/, capturas, run.json y evidence.json.

- run.json sigue EXACTAMENTE el formato de docs/diseno.md (es compartido: no cambiarlo aquí).
- evidence.json guarda el detalle en bruto (red, consola, IA) que necesita la etapa 5
  para poder ejecutarse sola sobre una carpeta de run.
"""
from __future__ import annotations

import json
import secrets
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from bot import config as C

Status = Literal["pass", "fail", "skipped"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(2)


@dataclass
class Step:
    name: str                       # enter | detect | launch | play
    status: Status = "fail"
    duration_ms: int = 0
    screenshots: list[str] = field(default_factory=list)
    notes: str = ""                 # texto para personas, en español

    def to_dict(self) -> dict:
        return asdict(self)


class StepTimer:
    """Mide la duración de una etapa: `with StepTimer(step): ...`"""

    def __init__(self, step: Step) -> None:
        self.step = step

    def __enter__(self) -> Step:
        self.t0 = time.time()
        return self.step

    def __exit__(self, *exc) -> None:
        self.step.duration_ms = int((time.time() - self.t0) * 1000)


class Run:
    def __init__(self, url: str, run_id: Optional[str] = None, run_dir: Optional[Path] = None) -> None:
        self.run_id = run_id or new_run_id()
        self.dir = run_dir or (C.RUNS_DIR / self.run_id)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.started_at = utc_now_iso()
        self.finished_at: Optional[str] = None
        self.url = url
        self.game: dict[str, Any] = {"id": None, "name": None, "provider": None, "why_new": None}
        self.steps: list[Step] = []
        self.verdict: Optional[dict] = None
        self.ai_usage = {"calls": 0, "usd": 0.0}
        self.evidence: dict[str, Any] = {}     # detalle en bruto → evidence.json

    # --- capturas --------------------------------------------------------------
    def shot(self, target, filename: str) -> Optional[str]:
        """Guarda una captura de una página, frame-element o locator. Devuelve el nombre del fichero."""
        path = self.dir / filename
        try:
            target.screenshot(path=str(path))
            return filename
        except Exception:
            return None

    # --- persistencia ------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "url": self.url,
            "game": self.game,
            "steps": [s.to_dict() for s in self.steps],
            "verdict": self.verdict,
            "ai_usage": {"calls": self.ai_usage["calls"], "usd": round(self.ai_usage["usd"], 4)},
        }

    def save(self) -> Path:
        (self.dir / "evidence.json").write_text(
            json.dumps(self.evidence, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        path = self.dir / "run.json"
        path.write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    @classmethod
    def load(cls, run_dir: Path) -> "Run":
        data = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
        run = cls(url=data.get("url", ""), run_id=data["run_id"], run_dir=run_dir)
        run.started_at = data.get("started_at")
        run.finished_at = data.get("finished_at")
        run.game = data.get("game") or run.game
        run.steps = [Step(**s) for s in data.get("steps", [])]
        run.verdict = data.get("verdict")
        run.ai_usage = data.get("ai_usage") or run.ai_usage
        ev = run_dir / "evidence.json"
        if ev.exists():
            run.evidence = json.loads(ev.read_text(encoding="utf-8"))
        return run
