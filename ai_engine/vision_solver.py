"""
VisionSolver: motor de visión multimodal (Claude o GPT-4o) para interactuar con
juegos renderizados en <canvas>/iframe sin DOM accesible.

Funciones públicas
- analyze(VisionRequest) -> VisionResponse : clasifica el estado del juego y propone la acción
                                             (con coordenadas x,y en el sistema de la imagen enviada).
- locate_text(path, text, w, h) -> VisionResponse : localiza un texto/tile (fallback del lobby).
- summarize(dict) -> str : redacta el resumen del veredicto en lenguaje natural.

Detalles clave
- La imagen se reescala a un máximo de MAX_SIDE px para reducir latencia/coste; las coordenadas
  devueltas por el modelo se reescalan de vuelta al tamaño ORIGINAL de la captura.
- La respuesta del modelo se fuerza a JSON estricto y se valida/sanea (clamp a límites de la imagen).
"""
from __future__ import annotations

import base64
import io
import json
import re
import time
from pathlib import Path
from typing import Optional

from PIL import Image

from config import config as C
from utils.models import VisionRequest, VisionResponse

MAX_SIDE = 1280

SYSTEM_PROMPT = """You are a senior QA automation agent testing online casino games in DEMO / play-for-fun mode.
You receive a screenshot of the game surface. Your job: get the game to play EXACTLY ONE round
(press the main Spin / Play / Deal / Bet button once) and recognise when the round has finished.

Classify the screen into one state:
- loading  : progress bar, spinner, logo while loading
- splash   : intro screen needing a click (Continue, Start, Tap to play, Press anywhere, sound on/off prompt)
- tutorial : feature explanation / onboarding overlay that must be dismissed
- popup    : any modal over the game (reality check, promo, info) that must be closed
- ready    : game idle, main play button available
- spinning : reels/cards/ball are animating, round in progress
- result   : round finished (win/lose message, reels stopped after a spin, balance updated)
- error    : game error message (connection lost, not available, session expired)
- unknown

Rules:
- Coordinates are in pixels of THIS image (origin top-left). Point at the CENTER of the target.
- Never click deposit, cashier, real-money, buy-feature, autoplay, max bet or settings buttons.
- If state is ready, the target is the main spin/play button (often a big round button bottom-center/right).
- If the previous action was a spin and the reels are now stopped, answer state "result".
- If nothing to do, action "wait".
Respond with ONLY a JSON object, no markdown:
{"state": "...", "action": "click|wait|none", "x": int|null, "y": int|null,
 "target": "short description", "confidence": 0.0-1.0, "reason": "one short sentence",
 "balance_text": "visible balance/credit text or null"}"""


class VisionSolver:
    def __init__(self, logger, provider: str = C.VISION_PROVIDER) -> None:
        self.log = logger
        self.provider = provider
        self.calls = 0
        self.total_latency_ms = 0
        self.input_tokens = 0
        self.output_tokens = 0
        if provider == "anthropic":
            import anthropic
            if not C.ANTHROPIC_API_KEY:
                raise RuntimeError("ANTHROPIC_API_KEY no definida en .env")
            self.client = anthropic.Anthropic(api_key=C.ANTHROPIC_API_KEY)
            self.model = C.ANTHROPIC_MODEL
        elif provider == "openai":
            from openai import OpenAI
            if not C.OPENAI_API_KEY:
                raise RuntimeError("OPENAI_API_KEY no definida en .env")
            self.client = OpenAI(api_key=C.OPENAI_API_KEY)
            self.model = C.OPENAI_MODEL
        else:
            raise ValueError(f"Proveedor de visión desconocido: {provider}")

    # ------------------------------------------------------------------ #
    @staticmethod
    def _load_scaled(image_path: str) -> tuple[str, float, int, int]:
        """Devuelve (base64 PNG reescalado, factor original/enviado, w_env, h_env)."""
        p = Path(image_path)
        if not p.is_absolute():
            p = C.PROJECT_ROOT / p
        img = Image.open(p).convert("RGB")
        w, h = img.size
        scale = min(1.0, MAX_SIDE / max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode(), 1 / scale, img.size[0], img.size[1]

    def _call(self, system: str, user_text: str, b64: Optional[str]) -> str:
        t0 = time.time()
        self.calls += 1
        if self.provider == "anthropic":
            content: list = []
            if b64:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}})
            content.append({"type": "text", "text": user_text})
            msg = self.client.messages.create(model=self.model, max_tokens=C.VISION_MAX_TOKENS, system=system,
                                              messages=[{"role": "user", "content": content}])
            self.input_tokens += getattr(msg.usage, "input_tokens", 0)
            self.output_tokens += getattr(msg.usage, "output_tokens", 0)
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        else:
            content = [{"type": "text", "text": user_text}]
            if b64:
                content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
            r = self.client.chat.completions.create(
                model=self.model, max_tokens=C.VISION_MAX_TOKENS,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": content}])
            if r.usage:
                self.input_tokens += r.usage.prompt_tokens
                self.output_tokens += r.usage.completion_tokens
            text = r.choices[0].message.content or ""
        self.total_latency_ms += int((time.time() - t0) * 1000)
        return text

    @staticmethod
    def _parse_json(text: str) -> dict:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}

    def _to_response(self, data: dict, raw: str, factor: float, w_orig: int, h_orig: int,
                     latency_ms: int) -> VisionResponse:
        def clamp(v, hi):
            return None if v is None else max(0, min(int(round(float(v) * factor)), hi - 1))
        state = data.get("state", "unknown")
        action = data.get("action", "wait")
        if state not in {"loading", "splash", "tutorial", "popup", "ready", "spinning", "result", "error", "unknown"}:
            state = "unknown"
        if action not in {"click", "wait", "none"}:
            action = "wait"
        try:
            x, y = clamp(data.get("x"), w_orig), clamp(data.get("y"), h_orig)
        except (TypeError, ValueError):
            x = y = None
        if action == "click" and (x is None or y is None):
            action = "wait"
        return VisionResponse(
            state=state, action=action, x=x, y=y,
            target=str(data.get("target", ""))[:80],
            confidence=float(data.get("confidence", 0) or 0),
            reason=str(data.get("reason", ""))[:200],
            balance_text=data.get("balance_text"),
            provider=self.provider, model=self.model, latency_ms=latency_ms, raw=raw[:600])

    # ------------------------------------------------------------------ #
    def analyze(self, req: VisionRequest) -> VisionResponse:
        b64, factor, _, _ = self._load_scaled(req.image_path)
        hist = "\n".join(req.history[-5:]) or "none"
        user = (f"Goal: {req.goal}\nStep: {req.step}\nPrevious actions:\n{hist}\n"
                f"Analyse the screenshot and return the JSON.")
        t0 = time.time()
        try:
            raw = self._call(SYSTEM_PROMPT, user, b64)
        except Exception as e:
            self.log.error(f"Error llamando a la API de visión: {e}")
            return VisionResponse(state="unknown", action="wait", reason=f"API error: {e}",
                                  provider=self.provider, model=self.model)
        resp = self._to_response(self._parse_json(raw), raw, factor, req.image_width, req.image_height,
                                 int((time.time() - t0) * 1000))
        self.log.info(f"👁  {resp.state} → {resp.action} {resp.target!r} ({resp.x},{resp.y}) "
                      f"conf={resp.confidence:.2f} [{resp.latency_ms} ms]")
        return resp

    def locate_text(self, image_path: str, text: str, w: int, h: int) -> VisionResponse:
        b64, factor, _, _ = self._load_scaled(image_path)
        system = ("You locate UI elements in screenshots of a casino lobby. Respond ONLY with JSON: "
                  '{"state":"ready","action":"click|none","x":int|null,"y":int|null,"target":"...",'
                  '"confidence":0-1,"reason":"..."}. Coordinates in pixels of this image, center of the element.')
        user = f"Find the game tile whose title is '{text}'. If it is not visible, action 'none'."
        t0 = time.time()
        raw = self._call(system, user, b64)
        return self._to_response(self._parse_json(raw), raw, factor, w, h, int((time.time() - t0) * 1000))

    def summarize(self, result_dict: dict) -> str:
        """Resumen ejecutivo en español del veredicto (no decide el veredicto, sólo lo explica)."""
        compact = {k: result_dict.get(k) for k in ("game_name", "site", "verdict", "verdict_reason")}
        compact["phases"] = [{"name": p["name"], "status": p["status"], "summary": p["summary"]}
                             for p in result_dict.get("phases", [])]
        system = "Eres un QA lead. Redacta en español, en 3-4 frases, un resumen ejecutivo factual del resultado."
        try:
            return self._call(system, json.dumps(compact, ensure_ascii=False), None).strip()
        except Exception as e:
            return f"(Resumen IA no disponible: {e})"

    def stats(self) -> dict:
        return {"provider": self.provider, "model": self.model, "calls": self.calls,
                "total_latency_ms": self.total_latency_ms,
                "input_tokens": self.input_tokens, "output_tokens": self.output_tokens}
