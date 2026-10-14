# Arquitectura del código

Cómo está hecho el bot por dentro y cómo ejecutar cada parte. El **qué** y el **por qué** (etapas, cuándo es PASS, formato de `run.json`) están en [diseno.md](diseno.md); este documento sigue esa estructura.

## Ejecutar

Todo con Docker, desde la raíz del repo:

```bash
docker compose build                                    # la primera vez tarda (descarga la imagen de Playwright)
docker compose run --rm bot --check                     # comprueba el entorno
docker compose run --rm bot                             # flujo completo contra el casino simulado → PASS
docker compose run --rm bot --block "**/provider.html"  # FAIL provocado: el juego no carga
docker compose run --rm bot --url https://...           # contra otra web
docker compose down                                     # para el casino simulado
```

Opciones de `bot.run`:

| Opción | Para qué |
|---|---|
| `--url URL` | Lobby a probar (por defecto `LOBBY_URL` de `.env`) |
| `--game "Nombre"` | Buscar un juego concreto en vez de detectar el nuevo |
| `--play-mode auto\|keyboard\|vision` | `auto`: teclado y, si no funciona, IA |
| `--block PATRÓN` | Bloquea peticiones (glob de Playwright) para provocar un FAIL. Repetible |
| `--headed` | Ver el navegador (solo fuera de Docker) |

Código de salida: `0` PASS, `1` FAIL, `2` error del propio bot.

Cada ejecución deja `runs/<run_id>/` con `run.json`, las capturas, `trace.zip`, `evidence.json` (detalle en bruto), `report.html` (para verlo cómodo) y `video/`.

### Cada etapa por separado

Cada etapa se puede ejecutar sola con una entrada fija, como pide [AGENTS.md](../AGENTS.md). Deja su propio `runs/<run_id>/` (sin veredicto).

```bash
docker compose run --rm --entrypoint python bot -m bot.stages.enter  --url http://mock:8000/index.html
docker compose run --rm --entrypoint python bot -m bot.stages.detect --url http://mock:8000/index.html [--game "Nombre"] [--save-snapshot]
docker compose run --rm --entrypoint python bot -m bot.stages.launch --game-url "http://mock:8000/game.html?g=Neon%20Dragon"
docker compose run --rm --entrypoint python bot -m bot.stages.play   --game-url "http://mock:8000/game.html?g=Neon%20Dragon" --mode keyboard
docker compose run --rm --entrypoint python bot -m bot.stages.verdict runs/<run_id>
```

Sin Docker (con un entorno virtual y `pip install -r requirements.txt` + `python -m playwright install chromium`), los mismos comandos funcionan quitando `docker compose run --rm --entrypoint python bot` y levantando antes el casino simulado con `python -m http.server 8000 --directory mock_casino`.

## Ficheros

```
bot/
├── stages/
│   ├── enter.py      # 1. abrir la web, rechazar cookies, cerrar modales, detectar bloqueos
│   ├── detect.py     # 2. juego nuevo: etiqueta "New" (A) o foto del lobby (B); --game para uno concreto
│   ├── launch.py     # 3. clic en el tile o URL directa; busca el canvas en todos los frames y comprueba que pinta
│   ├── play.py       # 4. spin con Espacio (A) o IA con visión (B); espera la petición de jugada
│   └── verdict.py    # 5. reglas de diseno.md sobre lo registrado → PASS/FAIL con motivo
├── run.py            # orquestador: sesión, etapas en orden, run.json y reporte       ← compartido
├── evidence.py       # carpeta del run, capturas, run.json y evidence.json             ← compartido
├── browser.py        # sesión de Playwright y registro de red, consola y WebSocket     ← compartido
├── config.py         # ajustes y selectores (todo configurable por .env)              ← compartido
├── vision.py         # IA con visión (Claude o GPT-4o) para el plan B de la etapa 4
└── report.py         # report.html a partir de run.json
mock_casino/          # casino simulado: lobby con un juego "New", juego en iframe+canvas, api/spin.json
Dockerfile            # imagen oficial de Playwright + dependencias
docker-compose.yml    # servicios mock (casino simulado) y bot
```

## Cómo encajan

Todas las etapas tienen la misma firma: `run(session, ctx) -> Step`.

- `session` (`browser.py`) es el navegador compartido. Además de la página, va guardando con marca de tiempo las respuestas HTTP, las peticiones fallidas, las excepciones JavaScript, los `console.error` y los mensajes WebSocket.
- `ctx` es un diccionario que pasa datos de una etapa a la siguiente: `url`, `game_name`, `tile` (el elemento del lobby), `game_url`, `surface` (el canvas), `play_mode`…
- `Step` es exactamente un elemento de `steps[]` de `run.json`: `name`, `status` (`pass`/`fail`/`skipped`), `duration_ms`, `screenshots` y `notes` (en español).

`run.py` crea el `Run` y la `Session`, llama a las etapas 1-4 en orden (si una falla, las siguientes quedan `skipped`), cierra el navegador, aplica la etapa 5 y guarda todo.

La etapa 5 no necesita navegador: lee `run.json` + `evidence.json`. Por eso se puede volver a ejecutar sobre cualquier carpeta de run.

## Cómo decide cada etapa

| Etapa | `pass` si… | Notas |
|---|---|---|
| enter | la página abre y no muestra un muro de geobloqueo o anti-bot | Rechaza cookies no esenciales; acepta solo si no hay forma de rechazar. Los bloqueos no se saltan |
| detect | hay un tile visible con señal de novedad (o que no está en la foto del lobby, o que coincide con `--game`) | Lee nombre, enlace y proveedor del tile. `--save-snapshot` guarda la foto en `bot/data/lobby_snapshot.json` |
| launch | aparece un `<canvas>` en algún frame, pinta algo (varianza de píxeles) 2 s seguidos y no hay errores 4xx/5xx del dominio del juego | Si la página o el iframe del juego no se pueden descargar, falla a los 5 s en vez de esperar al timeout |
| play | tras el spin sale una petición que coincide con `SPIN_URL_REGEX` (o un mensaje WebSocket) y tiene respuesta | Plan A: hasta 3 pulsaciones de Espacio (la primera suele quitar la pantalla de inicio). Plan B: IA, máx. `VISION_MAX_STEPS` pasos |

Etapa 5: aplica las cuatro comprobaciones de [diseno.md](diseno.md#cuándo-es-pass). `console_errors` cuenta solo las excepciones JavaScript no capturadas desde que se abre el juego, porque las webs reales llenan la consola de errores que no tienen que ver con el juego.

## Casino simulado

`mock_casino/` permite ensayar el flujo entero sin la web real y con resultados reproducibles:

- Lobby con 6 juegos; **Neon Dragon** lleva la etiqueta "New". Banner de cookies con "Rechazar todo".
- `game.html` abre el juego en un iframe; `provider.html` es una tragaperras en canvas: carga → pantalla de inicio → spin (ratón o Espacio) → resultado.
- Cada spin pide `api/spin.json`, que hace de "servidor del proveedor".

| Comando | Resultado esperado |
|---|---|
| `docker compose run --rm bot` | PASS |
| `... --block "**/provider.html"` | FAIL en `launch`: el juego no se puede cargar |
| `... --block "**/api/spin*"` | FAIL en `play`: el spin sale pero la petición falla |
| `... --game "Juego Inexistente"` | FAIL en `detect` |

## Ajustar para la web real

Todo está en `bot/config.py` y se puede sobrescribir con `.env`:

- `SPIN_URL_REGEX`: patrón de la petición de jugada. Se ve en DevTools → Network al pulsar spin.
- `TILE_SELECTORS`, `COOKIE_REJECT_SELECTORS`, `MODAL_CLOSE_SELECTORS`, `PLAY_BUTTON_SELECTORS`: selectores, en orden de prioridad.
- `NEW_BADGE_REGEX`: textos que cuentan como "nuevo".
- `GAME_LOAD_TIMEOUT_S`, `SPIN_WAIT_S`, `ROUND_WAIT_S`: tiempos.
- Si la web exige login para el modo demo, se puede dejar una sesión en `auth/storage_state.json` (no se sube) y el bot la carga sola.

Lo que se aprenda de la web va a [web-betsson.md](web-betsson.md).

## Pendiente

- Probar contra la web real de Betsson y ajustar selectores y `SPIN_URL_REGEX`.
- Probar el plan B con la API de IA real (solo se ha probado con una visión simulada).
- Detectar pantallas de error dentro del canvas (ahora solo se detectan con la IA).
- Plan B de la etapa 5: que la IA explique el resultado o desempate.
