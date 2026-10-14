"""
IA con visión (plan B de la etapa 4): mira una captura del juego y dice en qué estado está
y dónde hacer clic. Claude o GPT-4o, a elegir con VISION_PROVIDER.

Las coordenadas que devuelve el modelo se reescalan al tamaño real de la captura.
La IA nunca decide el veredicto: solo ayuda a jugar.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from dataclasses import asdict, dataclass
from typing import Optional

from PIL import Image

from bot import config as C

log = logging.getLogger("bot")
MAX_SIDE = 1280

PROMPT = """You are a QA agent testing an online casino game in DEMO / play-for-fun mode.
Goal: play exactly ONE round by pressing the main Spin / Play / Deal button once.
Classify the screenshot as one state: loading, splash (intro needing a click: Continue, Start, Tap to play,
sound prompt), tutorial, popup (any modal over the game), ready (idle, main play button available),
spinning, result (round finished), error, unknown.
Rules: coordinates are pixels of THIS image, at the CENTER of the target. Never click deposit, cashier,
real money, buy feature, autoplay, max bet or settings. If state is ready, target the main spin/play button.
If nothing to click, action "wait".
Reply ONLY with JSON: {"state":"...","action":"click|wait|none","x":int|null,"y":int|null,
"target":"short text","confidence":0.0-1.0,"reason":"short","balance_text":"visible balance or null"}"""

STATES = {"loading", "splash", "tutorial", "popup", "ready", "spinning", "result", "error", "unknown"}


@dataclass
class Decision:
    state: str = "unknown"
    action: str = "wait"
    x: Optional[int] = None
    y: Optional[int] = None
    target: str = ""
    confidence: float = 0.0
    reason: str = ""
    balance_text: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


class Vision:
    def __init__(self) -> None:
        self.provider = C.VISION_PROVIDER
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        if self.provider == "anthropic":
            import anthropic
            self.client = anthropic.Anthropic(api_key=C.ANTHROPIC_API_KEY)
            self.model = C.ANTHROPIC_MODEL
        else:
            from openai import OpenAI
            self.client = OpenAI(api_key=C.OPENAI_API_KEY)
            self.model = C.OPENAI_MODEL

    @property
    def usd(self) -> float:
        return (self.tokens_in * C.AI_USD_PER_MTOK_IN + self.tokens_out * C.AI_USD_PER_MTOK_OUT) / 1e6

    def decide(self, png: bytes, history: list[str]) -> Decision:
        img = Image.open(io.BytesIO(png)).convert("RGB")
        w, h = img.size
        scale = min(1.0, MAX_SIDE / max(w, h))
        if scale < 1:
            img = img.resize((int(w * scale), int(h * scale)))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        user = "Previous actions:\n" + ("\n".join(history[-5:]) or "none") + "\nReturn the JSON."

        t0 = time.time()
        self.calls += 1
        try:
            if self.provider == "anthropic":
                msg = self.client.messages.create(
                    model=self.model, max_tokens=300, system=PROMPT,
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                        {"type": "text", "text": user}]}])
                self.tokens_in += msg.usage.input_tokens
                self.tokens_out += msg.usage.output_tokens
                raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            else:
                r = self.client.chat.completions.create(
                    model=self.model, max_tokens=300,
                    messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": [
                        {"type": "text", "text": user},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}]}])
                if r.usage:
                    self.tokens_in += r.usage.prompt_tokens
                    self.tokens_out += r.usage.completion_tokens
                raw = r.choices[0].message.content or ""
        except Exception as e:
            log.error("Error llamando a la IA: %s", e)
            return Decision(reason=f"error de la API: {e}")

        m = re.search(r"\{.*\}", raw, re.S)
        try:
            data = json.loads(m.group(0)) if m else {}
        except json.JSONDecodeError:
            data = {}
        d = Decision(
            state=data.get("state") if data.get("state") in STATES else "unknown",
            action=data.get("action") if data.get("action") in {"click", "wait", "none"} else "wait",
            target=str(data.get("target", ""))[:60],
            confidence=float(data.get("confidence") or 0),
            reason=str(data.get("reason", ""))[:160],
            balance_text=data.get("balance_text"))
        try:
            if data.get("x") is not None and data.get("y") is not None:
                d.x = max(0, min(int(round(float(data["x"]) / scale)), w - 1))
                d.y = max(0, min(int(round(float(data["y"]) / scale)), h - 1))
        except (TypeError, ValueError):
            pass
        if d.action == "click" and d.x is None:
            d.action = "wait"
        log.info("IA: estado=%s acción=%s objetivo='%s' (%s,%s) confianza=%.2f [%d ms]",
                 d.state, d.action, d.target, d.x, d.y, d.confidence, int((time.time() - t0) * 1000))
        return d
