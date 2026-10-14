"""
Etapa 2: Detectar juego nuevo.

Plan A: señal del propio lobby (etiqueta "New"/"Nuevo" en el tile, o atributos con "new").
Plan B: comparar los juegos del lobby con la foto guardada en bot/data/lobby_snapshot.json.
Con --game "<nombre>" se busca ese juego concreto (útil para pruebas y demos).

Sola:  python -m bot.stages.detect --url <url del lobby> [--game "Nombre"] [--save-snapshot]
"""
from __future__ import annotations

import json
import logging
import re

from rapidfuzz import fuzz

from bot import config as C
from bot.evidence import Step, StepTimer

log = logging.getLogger("bot")

# Marca cada tile candidato con data-qabot="<i>" y devuelve sus datos.
COLLECT_JS = """
([selectors, badgeRe]) => {
  const re = new RegExp(badgeRe, 'i');
  const seen = new Set(); const out = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el) || [...seen].some(s => s.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      seen.add(el);
      const i = out.length; el.setAttribute('data-qabot', String(i));
      const img = el.querySelector('img');
      const text = (el.innerText || '').trim();
      const attrs = [...el.querySelectorAll('*')].concat([el])
        .map(n => (n.className && n.className.baseVal === undefined ? n.className : '') + ' ' +
                  Object.keys(n.dataset || {}).join(' ')).join(' ');
      const isNewText = re.test(text);
      const isNewAttr = /(^|[\\s_-])(new|is-new|badge-new|data-new)([\\s_-]|$)/i.test(attrs) ||
                        !!el.querySelector('[data-new], [class*="new" i]');
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || (img && img.alt) ||
                    text.split('\\n')[0] || '').replace(re, '').replace(/[()\\[\\]]/g, '').trim();
      out.push({ index: i, name, href: el.href || (el.querySelector('a') || {}).href || null,
                 provider: el.dataset ? (el.dataset.provider || null) : null,
                 is_new: isNewText || isNewAttr,
                 why: isNewText ? 'texto' : (isNewAttr ? 'atributo' : null) });
    }
  }
  return out;
}
"""


def run(session, ctx: dict) -> Step:
    step = Step(name="detect")
    page = session.page
    run_ = session.run
    with StepTimer(step):
        log.info("Etapa 2 · Buscando el juego %s", f"«{ctx['game_name']}»" if ctx.get("game_name") else "nuevo")
        if ctx.get("game_name"):
            _search_box(page, ctx["game_name"])
        tiles = _collect(page)
        if not tiles:   # lobby con carga perezosa: hacer scroll y volver a mirar
            for _ in range(6):
                page.mouse.wheel(0, 900)
                page.wait_for_timeout(600)
            tiles = _collect(page)
        step.screenshots = [s for s in [run_.shot(page, "02_lobby.png")] if s]
        run_.evidence["lobby"] = {"tiles_found": len(tiles), "names": [t["name"] for t in tiles][:200]}

        if ctx.get("save_snapshot"):
            C.SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
            C.SNAPSHOT_FILE.write_text(json.dumps(sorted({t["name"] for t in tiles if t["name"]}),
                                                  indent=2, ensure_ascii=False), encoding="utf-8")
            log.info("Foto del lobby guardada en %s (%d juegos)", C.SNAPSHOT_FILE.relative_to(C.ROOT), len(tiles))

        chosen, why = _choose(tiles, ctx.get("game_name"))
        if not chosen:
            step.notes = (f"No se encontró «{ctx['game_name']}» en el lobby" if ctx.get("game_name")
                          else f"Ningún juego con señal de novedad entre {len(tiles)} tiles y sin foto previa con la que comparar")
            return step

        tile = page.locator(f'[data-qabot="{chosen["index"]}"]').first
        try:
            tile.scroll_into_view_if_needed()
            visible = tile.is_visible()
        except Exception:
            visible = False
        if not visible:
            step.notes = f"«{chosen['name']}» está en el DOM pero no es visible"
            return step
        tile_shot = run_.shot(tile, "02b_juego.png")
        if tile_shot:
            step.screenshots.append(tile_shot)

        run_.game = {"id": _game_id(chosen), "name": chosen["name"], "provider": chosen.get("provider"),
                     "why_new": why}
        ctx["tile"] = tile
        ctx["game_url"] = chosen.get("href")
        step.status = "pass"
        step.notes = f"«{chosen['name']}»: {why}"
    return step


def _collect(page) -> list[dict]:
    try:
        return page.evaluate(COLLECT_JS, [C.TILE_SELECTORS, C.NEW_BADGE_REGEX])
    except Exception as e:
        log.warning("No se pudieron leer los tiles del lobby: %s", e)
        return []


def _choose(tiles: list[dict], game_name: str | None) -> tuple[dict | None, str]:
    if game_name:
        best, score = None, 0
        for t in tiles:
            s = max(fuzz.partial_ratio(game_name.lower(), t["name"].lower()),
                    fuzz.token_set_ratio(game_name.lower(), t["name"].lower())) if t["name"] else 0
            if s > score:
                best, score = t, s
        return (best, f"Buscado por nombre (coincidencia {score:.0f}%)") if best and score >= 80 else (None, "")

    news = [t for t in tiles if t["is_new"]]                       # plan A
    if news:
        why = "Tiene la etiqueta New" if news[0]["why"] == "texto" else "Marcado como nuevo en el HTML del lobby"
        return news[0], why

    if C.SNAPSHOT_FILE.exists():                                   # plan B
        known = set(json.loads(C.SNAPSHOT_FILE.read_text(encoding="utf-8")))
        fresh = [t for t in tiles if t["name"] and t["name"] not in known]
        if fresh:
            return fresh[0], "No estaba en la foto guardada del lobby"
    return None, ""


def _search_box(page, name: str) -> None:
    for sel in C.SEARCH_INPUT_SELECTORS:
        try:
            box = page.locator(sel).first
            if box.is_visible(timeout=1000):
                box.fill(name)
                box.press("Enter")
                page.wait_for_timeout(1500)
                return
        except Exception:
            continue


def _game_id(tile: dict) -> str:
    if tile.get("href"):
        tail = tile["href"].rstrip("/").split("/")[-1].split("?")[0]
        if tail and not tail.endswith(".html"):
            return tail
    return re.sub(r"[^a-z0-9]+", "-", (tile.get("name") or "").lower()).strip("-") or None


if __name__ == "__main__":
    import argparse

    from bot.run import standalone
    from bot.stages import enter
    p = argparse.ArgumentParser(description="Etapa 2: detectar juego nuevo en el lobby")
    p.add_argument("--url", default=C.LOBBY_URL, help="URL del lobby")
    p.add_argument("--game", help="Buscar un juego concreto por nombre")
    p.add_argument("--save-snapshot", action="store_true", help="Guardar la lista de juegos como foto del lobby")
    a = p.parse_args()
    standalone([enter.run, run], {"url": a.url, "game_name": a.game, "save_snapshot": a.save_snapshot})
