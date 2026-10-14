# Malakathon3: agente de QA para juegos nuevos de Betsson

Un bot que, sin intervención humana:

1. entra en la web de Betsson,
2. detecta un **juego nuevo** en el lobby,
3. lo abre,
4. juega una ronda,
5. hace capturas,
6. da un veredicto **PASS/FAIL** con su motivo.

👉 **Qué funciona y quién está con qué:** [ESTADO.md](ESTADO.md)

## Empezar

1. Clona el repo: `git clone https://github.com/alegalanr/Malakathon3.git`
2. Si no lo tienes ya, inicia sesión en GitHub desde la terminal: `gh auth login`
3. Abre tu agente (Claude Code, Cursor…) en la carpeta, mira [ESTADO.md](ESTADO.md) y dile qué parte vas a hacer. Por ejemplo: *"voy a hacer la etapa 3, abrir el juego"*.

El agente se encarga de crear la rama, abrir el PR y mantener [ESTADO.md](ESTADO.md) al día. Las reglas que sigue están en [AGENTS.md](AGENTS.md): no hace falta que te las aprendas.

## Cómo trabajamos

- **Cada parte del bot es un módulo separado y la lleva una persona.** Así no nos pisamos ni hay conflictos de merge.
- **Cada tarea va en su rama, con un PR abierto desde el principio.** Así la [lista de PRs](https://github.com/alegalanr/Malakathon3/pulls) dice quién está con qué parte.
- **Cualquiera puede fusionar su PR en `main`** cuando lo ha probado.

Y lo que no se hace nunca:

- jugar con dinero real (solo modo demo),
- subir credenciales al repo,
- saltarse CAPTCHAs o protecciones anti-bot.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Qué funciona y quién lo lleva | [ESTADO.md](ESTADO.md) |
| Enunciado y preguntas para la organización | [docs/reto.md](docs/reto.md) |
| Lo que sabemos de la web de Betsson | [docs/web-betsson.md](docs/web-betsson.md) |
| Cómo funciona el bot, módulos y decisiones | [docs/diseno.md](docs/diseno.md) |
| Presentación y pitch | [pitch/](pitch/) |

## Ejecutar

TODO: un único comando con Docker, en cuanto esté el stack.

## Idioma

Todo lo que lee una persona (docs, PRs, commits, comentarios, mensajes del bot) va en español. Solo el código en sí va en inglés.

---

## Anexo: propuesta de arquitectura detallada (rama `julia`)

> Documentación del esqueleto de código preparado en la rama `julia` (`config/`, `automation/`, `ai_engine/`, `reporter/`, `utils/`, `main.py`, `mock_casino/`). Es una **propuesta** que complementa a [docs/diseno.md](docs/diseno.md); donde no coincidan, manda lo acordado por el equipo en ese documento.

## 🎰 Betsson Casino QA Bot — Lobby, lanzamiento y jugada

> Aplicación autónoma que, ante la publicación de un juego nuevo en un casino de Betsson,
> **demuestra** que (1) se ve en el lobby, (2) se lanza correctamente y (3) se puede jugar una
> partida, dejando **capturas, vídeo, trace, logs y un veredicto explícito** (`PASS / FAIL / BLOCK / INCONCLUSIVE`).

Reto del hackatón: **"Casino Lobby, lanzamiento y jugada"** (Betsson) · Tags: Web development, Automation, AI, Testing · Dificultad 4-5/5.

---

### Índice

1. [Visión general de la arquitectura y contexto](#1-visión-general-de-la-arquitectura-y-contexto)
2. [Estructura de archivos y carpetas](#2-estructura-de-archivos-y-carpetas)
3. [Explicación detallada de cada módulo](#3-explicación-detallada-de-cada-módulo)
4. [Contratos de datos e interfaces](#4-contratos-de-datos-e-interfaces-entre-módulos)
5. [Instalación y ejecución en 3 pasos (Windows)](#5-instalación-setup-y-ejecución-en-3-pasos-windows)
6. [Plan de contingencia y edge cases](#6-plan-de-contingencia-y-gestión-de-edge-cases)
7. [Convenciones del equipo](#7-convenciones-del-equipo)

---

### 1. Visión general de la arquitectura y contexto

#### 1.1 El problema de negocio

Cada vez que un casino online publica un juego nuevo, QA tiene que comprobar manualmente, en cada
mercado, marca y dispositivo, que:

| Fase | Pregunta de negocio | Cómo lo demostramos |
|---|---|---|
| **LOBBY** | ¿El jugador puede **ver** el juego nuevo? | El tile existe, coincide en nombre (fuzzy match), es visible en el viewport y su imagen ha cargado. Captura del lobby y recorte del tile. |
| **LAUNCH** | ¿El juego **abre** sin errores? | Se encuentra la superficie de render (iframe y/o `<canvas>`), el canvas no está vacío y se mantiene estable N segundos. Se registran errores de consola y peticiones 4xx/5xx. Se mide el tiempo de carga. |
| **PLAY** | ¿Se puede **jugar una ronda**? | La IA de visión guía los clics (splash → continuar → spin). La jugada se **prueba** con evidencia objetiva: petición de red de jugada, diferencia visual antes/después y cambio de saldo. |

#### 1.2 Por qué es difícil

- **El juego es una caja negra.** Los juegos los sirven proveedores externos (NetEnt, Pragmatic,
  Play'n GO, Evolution…) en un **iframe de otro dominio** y se dibujan en un **`<canvas>` WebGL**.
  Dentro no hay botones en el DOM, solo píxeles. Por eso usamos **visión por IA** para "ver" el
  juego y decidir dónde hacer clic.
- **No hay dos juegos iguales.** Splash screens, tutoriales, avisos de sonido, "reality checks",
  posiciones del botón de spin… Unos selectores fijos no escalan.
- **Webs reales con protecciones.** Cookies, verificación de edad, bloqueos por geolocalización,
  anti-bot (Cloudflare/Akamai), login obligatorio para el modo demo según la licencia.
- **No determinismo.** Animaciones, tiempos de carga de 10-40 s y latencia de la IA de 2-8 s por llamada.

#### 1.3 Principios de diseño

1. **Determinista donde hay DOM, IA donde no lo hay.** Lobby y lanzamiento usan Playwright puro.
   La IA entra en el canvas y como fallback.
2. **La IA aporta evidencia; el veredicto lo deciden reglas.** Un LLM puede equivocarse, así que el
   PASS exige pruebas independientes (red y diferencia visual/saldo). Ver `GameLauncher.judge_play()`.
3. **Todo deja rastro.** Cada paso genera captura, evento en el timeline y entrada en el log.
   Además: vídeo, `trace.zip` de Playwright y `result.json` para CI.
4. **Veredicto honesto de 4 estados.** `FAIL` es un defecto del producto. `BLOCK` significa que no
   se pudo probar por una causa externa (geo, captcha). `INCONCLUSIVE` significa que hay indicios
   pero no pruebas.
5. **Portabilidad.** **Cero rutas absolutas.** Todo se resuelve desde la raíz del proyecto
   (`config.PROJECT_ROOT`) y los reportes enlazan las capturas con rutas relativas.
6. **Nunca dinero real.** Solo modo demo o cuentas de test. La IA tiene prohibido pulsar
   depósito, cajero, compra de bonus, autoplay o apuesta máxima.

#### 1.4 Diagrama de flujo de datos

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                               ORQUESTADOR PRINCIPAL  (main.py)                               │
│  CLI → RunConfig(site, game, run_id) → Timeline + Logger → fases secuenciales → veredicto    │
└───────┬──────────────────────────┬───────────────────────────────┬───────────────────────────┘
        │ (1) start()              │                               │
        ▼                          │                               │
┌──────────────────────────┐       │                               │
│  BROWSER DRIVER          │       │                               │
│  automation/             │       │                               │
│  browser_driver.py       │       │                               │
│  · Chrome headed+stealth │       │                               │
│  · locale/geo/viewport   │       │                               │
│  · storageState (sesión) │       │                               │
│  · listeners: red, WS,   │       │                               │
│    consola  ─────────────┼───────┼──► evidencias (spin_requests, │
│  · vídeo + trace         │       │    failed_requests, errores)  │
└───────────┬──────────────┘       │                               │
            │ page                 │                               │
            ▼                      │                               │
┌──────────────────────────┐ (2)   │                               │
│  LOBBY NAVIGATOR         │◄──────┤ find_game(game)               │
│  · goto lobby            │       │                               │
│  · cookies / modales     │       │                               │
│  · detecta BLOCK (geo)   │       │                               │
│  · buscador → scroll ────┼───────┼──► fallback: VisionSolver     │
│  · fuzzy match + verif.  │       │    .locate_text()             │
│  📸 lobby, tile          │──────►│ LobbyState                    │
└───────────┬──────────────┘       │                               │
            │ tile                 │                               │
            ▼                      │                               │
┌──────────────────────────┐ (3)   │                               │
│  GAME LAUNCHER: launch() │◄──────┤ launch(lobby)                 │
│  · clic tile / "Demo"    │       │                               │
│  · nueva pestaña?        │       │                               │
│  · frames → <canvas>     │       │                               │
│  · varianza píxeles      │       │                               │
│    estable N s           │       │                               │
│  📸 game_loaded          │──────►│ LaunchState                   │
└───────────┬──────────────┘       │                               │
            │ surface (canvas)     │                               │
            ▼                      │                               │
┌──────────────────────────┐ (4)   │      ┌─────────────────────────────────────┐
│  GAME LAUNCHER:          │◄──────┤      │  AI VISION ENGINE                   │
│  play_round()            │       │      │  ai_engine/vision_solver.py         │
│  loop máx N pasos:       │ PNG + │      │  · reescala imagen (≤1280px)        │
│   screenshot(canvas) ────┼───────┼─────►│  · prompt QA + historial            │
│                          │VisionRequest │  · Claude / GPT-4o → JSON estricto  │
│   ◄──────────────────────┼───────┼──────│  · valida y reescala coords x,y     │
│   VisionResponse         │       │      │  · state / action / confidence      │
│   (state, x, y, conf)    │       │      └─────────────────────────────────────┘
│   clic en coords reales  │       │
│   📸 anotada (círculo)   │       │
│  evidencias: red + diff  │       │
│  + saldo → judge_play()  │──────►│ PlayState
└──────────────────────────┘       │
                                   │ (5) decide_verdict(phases) → TestResult
                                   │     VisionSolver.summarize() → resumen IA
                                   ▼
                     ┌──────────────────────────────────────┐
                     │  REPORTER                            │
                     │  reporter/report_generator.py        │
                     │  → ./reports/<run_id>/report.html    │
                     │  → ./reports/<run_id>/result.json    │
                     │  → ./reports/index.html (histórico)  │
                     │  + video/, trace.zip, run.log        │
                     └──────────────────────────────────────┘
```

**Secuencia resumida:** `main` → `BrowserDriver.start` → `LobbyNavigator.find_game` →
`GameLauncher.launch` → `GameLauncher.play_round` (⇄ `VisionSolver.analyze` en bucle) →
`decide_verdict` → `ReportGenerator.generate`. Si una fase no da `PASS`, las siguientes se marcan
como `SKIPPED` y se genera igualmente el reporte.

---

### 2. Estructura de archivos y carpetas

```
./
├── config/
│   ├── __init__.py
│   └── config.py                 # URLs, credenciales (.env), timeouts, selectores, rutas relativas
├── automation/
│   ├── __init__.py
│   ├── browser_driver.py         # Playwright: navegador, contexto, stealth, listeners de red, capturas
│   ├── lobby_navigator.py        # Lobby: cookies, modales, búsqueda del juego, verificación del tile
│   └── game_launcher.py          # Lanzamiento, detección iframe/canvas, render, bucle de jugada
├── ai_engine/
│   ├── __init__.py
│   └── vision_solver.py          # Claude Vision / GPT-4o: estado del juego + coordenadas de clic
├── reporter/
│   ├── __init__.py
│   └── report_generator.py       # result.json + report.html + index.html
├── utils/
│   ├── __init__.py
│   ├── logger.py                 # Logger (consola + fichero) y Timeline de eventos
│   └── models.py                 # Contratos de datos (dataclasses) compartidos entre módulos
├── mock_casino/                  # Casino simulado local para ensayar sin internet ni bloqueos
│   ├── index.html                #   lobby con buscador, tiles y banner de cookies
│   ├── game.html                 #   página de juego con iframe
│   └── provider.html             #   "juego" en <canvas>: loading → splash → spin → result
├── screenshots/                  # ./screenshots/<run_id>/NN_<fase>.png  (no versionado)
├── reports/                      # ./reports/<run_id>/{report.html,result.json,trace.zip,video/,run.log}
├── auth/                         # ./auth/storage_state.json (sesión guardada, NO versionar)
├── .env.example                  # plantilla de variables de entorno
├── Dockerfile                    # imagen del bot (base oficial de Playwright con Chromium)
├── docker-compose.yml            # servicios: mock (casino simulado) + bot
├── .dockerignore                 # lo que no entra en la imagen (.env, .git, salidas…)
├── .gitignore
├── main.py                       # orquestador + CLI
├── requirements.txt
└── README.md
```

> `utils/models.py` y `mock_casino/` amplían la estructura mínima. El primero centraliza los
> contratos de datos (§4) para que ningún módulo dependa de dicts "mágicos". El segundo permite
> ensayar la demo completa offline.

---

### 3. Explicación detallada de cada módulo

#### 3.1 `config/config.py`: configuración central

**Propósito.** Ser la única fuente de configuración. Ningún otro módulo lee variables de entorno ni
construye rutas por su cuenta.

**Lógica interna**

- `PROJECT_ROOT = Path(__file__).resolve().parent.parent` es la raíz del proyecto, calculada desde
  la ubicación del propio archivo. **Todas** las rutas se derivan de aquí: `SCREENSHOTS_DIR`,
  `REPORTS_DIR`, `AUTH_DIR` y `STORAGE_STATE_FILE`. Las carpetas se crean automáticamente.
- `rel(path)` convierte cualquier ruta en relativa a la raíz (formato POSIX). Es lo que se guarda en
  reportes y JSON, para que sean portables.
- `load_dotenv(PROJECT_ROOT / ".env")` carga los secretos. **Nunca** se hardcodean API keys ni
  credenciales.
- `SiteConfig` (dataclass inmutable) define por sitio `base_url`, `lobby_path`, `locale`,
  `timezone_id` y `geolocation`. El diccionario `SITES` contiene `betsson_com`, `betsson_es` y
  `mock`.
- **Bloques de configuración:**
  - **IA:** `VISION_PROVIDER`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `VISION_MAX_TOKENS` y
    `VISION_MIN_CONFIDENCE` (por debajo de 0.55 no se hace clic).
  - **Navegador:** `HEADLESS` (por defecto `False`, porque headed reduce los bloqueos),
    `BROWSER_CHANNEL` (`chrome` real), `VIEWPORT`, `RECORD_VIDEO` y `RECORD_TRACE`.
  - **Timeouts:** `NAV_TIMEOUT_MS`, `ACTION_TIMEOUT_MS`, `GAME_LOAD_TIMEOUT_MS`,
    `CANVAS_STABLE_SECONDS`, `GAME_AGENT_MAX_STEPS` y `GLOBAL_RUN_TIMEOUT_S`.
  - **Heurísticas:**
    - `SPIN_URL_PATTERNS`: regex de URLs de jugada, que hay que **ajustar tras mirar DevTools**.
    - `CANVAS_MIN_STD`: varianza mínima para considerar que el canvas tiene contenido.
    - `VISUAL_DIFF_THRESHOLD`: un 2% de píxeles cambiados cuenta como diferencia visual.
  - **Selectores fallback (ordenados por prioridad):** `COOKIE_ACCEPT_SELECTORS`,
    `MODAL_CLOSE_SELECTORS`, `SEARCH_INPUT_SELECTORS`, `SEARCH_OPEN_SELECTORS`,
    `PLAY_BUTTON_SELECTORS` y `GAME_IFRAME_SELECTORS`. Incluyen textos en inglés, español y sueco.
- `RunConfig` agrupa los parámetros de una ejecución (`site`, `game_name`, `run_id`, `headless`) y
  expone `screenshots_dir` y `report_dir` por ejecución.

**Entradas:** `.env` y variables de entorno. **Salidas:** constantes y objetos importados como `from config import config as C`.

---

#### 3.2 `automation/browser_driver.py`: ciclo de vida de Playwright

**Propósito.** Arrancar un navegador lo más parecido posible a un usuario real, instrumentarlo para
capturar evidencias y cerrarlo guardando vídeo y trace.

**Lógica interna**

1. **Lanzamiento.**
   - Usa `chromium.launch(channel="chrome", headless=False, args=LAUNCH_ARGS)`. Si Chrome no está
     instalado, cae automáticamente a Chromium de Playwright.
   - Flags clave:
     - `--disable-blink-features=AutomationControlled` quita la marca de automatización.
     - `--autoplay-policy=no-user-gesture-required` permite intros con audio o vídeo.
     - `--disable-features=IsolateOrigins,site-per-process` facilita el acceso a iframes de
       proveedores.
2. **Contexto.**
   - Configura `viewport`, `locale`, `timezone_id`, `geolocation` y el permiso de geolocalización
     según el `SiteConfig`.
   - Si existe `./auth/storage_state.json`, carga cookies y sesión. Así no hay que hacer login ni
     aceptar cookies en cada ejecución.
   - Graba vídeo en `./reports/<run_id>/video/`.
3. **Stealth.** `add_init_script(STEALTH_INIT_SCRIPT)` oculta `navigator.webdriver`, define
   `window.chrome`, `languages` y `plugins`, y normaliza `permissions.query`.
4. **Listeners de evidencia.** Se registran en la página principal **y en cualquier pestaña nueva**
   (`context.on("page")`):
   - `request`: si la captura de jugada está activa (`begin_play_capture()`) y la URL coincide con
     `SPIN_URL_PATTERNS`, se guarda en `spin_requests`.
   - `response`: guarda en `failed_requests` los 4xx/5xx de XHR, fetch, document o script.
   - `console` y `pageerror` van a `console_errors`.
   - `websocket.framesent` incrementa `ws_frames_sent`, porque muchos proveedores juegan por WS.
5. **`screenshot(name, full_page, target)`** guarda `./screenshots/<run_id>/NN_<name>.png` con
   numeración secuencial y devuelve la **ruta relativa**. `target` permite recortar un elemento
   (tile, canvas).
6. **`save_session()`** persiste el `storageState`.
7. **`stop()`** cierra el trace (`trace.zip`), el contexto (que vuelca el vídeo), el navegador y
   Playwright. Rellena `video_path` y `trace_path`.

**Entradas:** `RunConfig` y logger. **Salidas:** `page`/`context` listos y listas de evidencia de red/consola.

---

#### 3.3 `automation/lobby_navigator.py`: lobby y localización del juego

**Propósito.** Llegar al lobby, limpiar interferencias, encontrar el juego objetivo y **demostrar
que es visible**.

**Lógica interna**

1. **`open_lobby()`**
   - Hace `goto(lobby_url)` y espera a `networkidle` como máximo 10 s, porque los lobbies con
     polling nunca llegan a idle.
   - Después llama a `accept_cookies()` y `close_modals()` (prueba selectores de cierre y, si no
     hay ninguno, pulsa `Escape`).
2. **`detect_block()`** busca en el texto de la página y en el título patrones de geobloqueo o
   anti-bot (`not available in your country`, `verify you are human`, `just a moment`, `captcha`…).
   Si encuentra alguno, lanza `RuntimeError("BLOCK: …")`, que se traduce en un veredicto `BLOCK`.
3. **Estrategias de búsqueda, en cascada:**
   1. **Buscador.** Localiza el input (directo o tras pulsar el icono de lupa), escribe el nombre y
      pulsa Enter.
   2. **Scroll.** Hasta `LOBBY_MAX_SCROLLS` desplazamientos de 900 px, evaluando los tiles en cada
      uno.
   3. **IA (fallback).** Toma una captura y llama a `VisionSolver.locate_text()`, que devuelve
      coordenadas. Con `document.elementFromPoint(x,y)` obtiene el elemento clicable más cercano.
4. **`_best_tile()`**
   - Recorre los candidatos de `TILE_CANDIDATE_SELECTORS` (hasta 200 por selector).
   - Para cada uno construye el texto a partir de `aria-label`, `title`, `inner_text` y el `alt`
     de la imagen.
   - Puntúa con `rapidfuzz` (`max(partial_ratio, token_set_ratio)`). Acepta el candidato si la
     puntuación es ≥ 80 y corta en ≥ 95.
5. **`_verify_tile()`** comprueba tres cosas:
   - El bounding box está dentro del viewport y mide más de 20 px.
   - El elemento cumple `is_visible()`.
   - La imagen ha cargado (`img.complete && naturalWidth > 0`). Un tile con la imagen rota es un
     defecto real.
6. **`open_game()`**
   - Hace hover sobre el tile y busca un botón "Play/Demo/Jugar" dentro de él. Si no lo hay, hace
     clic directo en el tile.
   - Después busca un botón de juego en una posible ficha intermedia del juego.

**Entradas:** `game_name`. **Salidas:** `LobbyState` (§4.1). Expone `self.tile` para el launcher.

---

#### 3.4 `automation/game_launcher.py`: lanzamiento, render y jugada

**Propósito.** Pasar del clic en el lobby a un juego renderizado, jugar una ronda guiada por IA y
**juzgar** la jugada con evidencias.

##### Fase LAUNCH: `launch(lobby_navigator)`

1. Llama a `open_game()`. Si el número de pestañas aumenta, cambia a la nueva (`bring_to_front`) y
   actualiza `driver.page`.
2. **`_resolve_surface()`**, que se repite hasta `GAME_LOAD_TIMEOUT_MS`:
   - Recorre **todos los frames** de la página, incluidos iframes anidados y de otro dominio, que
     Playwright sí puede ver. Elige el `<canvas>` de mayor área con más de 200 px de ancho.
   - Si a mitad del timeout no hay canvas accesible, usa el **iframe más grande** como superficie.
     Ese caso cubre shadow DOM o canvas inaccesibles.
3. **`_wait_render_stable()`** captura la superficie, calcula la desviación típica de los píxeles
   en escala de grises y exige `std > CANVAS_MIN_STD` durante `CANVAS_STABLE_SECONDS` seguidos.
   Esto detecta pantallas negras, blancas o de error vacías.
4. Recoge los errores de consola y las peticiones fallidas **producidas desde el clic**, y mide
   `load_time_ms`.

##### Fase PLAY: `play_round()`

1. `begin_play_capture()` activa la captura de red de jugada.
2. **Bucle agéntico** (máximo `GAME_AGENT_MAX_STEPS`):
   1. Captura la superficie (`play_step_NN.png`).
   2. Llama a `VisionSolver.analyze(VisionRequest)` con el historial de acciones.
   3. **Si `state=ready` y `action=click`**, es el spin:
      - Guarda la imagen *antes*.
      - Hace clic en las coordenadas.
      - Anota la captura con un círculo rojo y la etiqueta.
      - Espera unos 4 s, la duración típica de un giro.
   4. Si es splash, tutorial o popup con clic, hace clic y espera 1.5 s.
   5. Si es loading o spinning, espera 2 s.
   6. **Fin de ronda:** después del spin, un estado `result` o `ready` cierra la ronda. Se calculan
      `visual_diff_ratio` (antes frente a después) y `balance_after`.
   7. Un estado `error` aborta el bucle con el mensaje de error.
3. **`_click_on_surface()`** traduce las coordenadas de la imagen de la superficie a coordenadas de
   página: `box.x + x · (box.width / img_w)`. Así corrige el `deviceScaleFactor` y el offset del
   iframe. Mueve el ratón en 8 pasos y hace clic con 60 ms de delay, para parecer humano.
4. **`judge_play()`** aplica las reglas del veredicto, con la IA solo como fuente de evidencia:

| Condición | Veredicto |
|---|---|
| No se llegó a pulsar spin (con pasos ejecutados) | `FAIL` |
| Red de jugada (HTTP o WS) **y** (diff visual ≥ 2% **o** cambio de saldo **o** IA vio resultado) | `PASS` |
| Diff visual **y** (cambio de saldo **o** IA vio resultado), sin red identificable | `PASS` |
| Cualquier otro caso con spin pulsado | `INCONCLUSIVE` |

**Utilidades de imagen:** `image_std()`, `diff_ratio()` (porcentaje de píxeles con diferencia > 25
niveles) y `annotate_click()`.

**Entradas:** `LobbyNavigator` y `VisionSolver`. **Salidas:** `LaunchState` y `PlayState` (§4.2, §4.4).

---

#### 3.5 `ai_engine/vision_solver.py`: motor de visión multimodal

**Propósito.** Darle "ojos" al bot dentro del canvas. Clasifica el estado del juego, propone la
siguiente acción con **coordenadas exactas** y redacta el resumen final.

**Lógica interna**

1. **Proveedor intercambiable.** `anthropic` usa `messages.create` con un bloque de imagen en
   base64. `openai` usa `chat.completions` con `image_url` en data URI. Se selecciona con
   `VISION_PROVIDER` o `--provider`.
2. **Reescalado.** La imagen se reduce a un máximo de **1280 px** en el lado mayor (`_load_scaled`)
   para bajar la latencia y el coste. Se guarda el factor `original / enviado` y las coordenadas que
   devuelve el modelo se **multiplican por ese factor**, para que el clic caiga en el píxel real.
3. **Prompt de sistema (`SYSTEM_PROMPT`).**
   - Define el rol de agente QA en modo demo.
   - Fija la taxonomía de estados: `loading`, `splash`, `tutorial`, `popup`, `ready`, `spinning`,
     `result`, `error`, `unknown`.
   - Establece reglas de seguridad (no pulsar depósito, buy-feature, autoplay ni max bet) y pide
     apuntar al **centro** del objetivo.
   - Exige que la respuesta sea **solo JSON**.
4. **Contexto.** Cada petición incluye el objetivo, el número de paso y las últimas 5 acciones
   (`history`). Así el modelo sabe que ya pulsó spin y puede reconocer el estado `result`.
5. **Saneamiento (`_parse_json` + `_to_response`).**
   - Extrae el primer `{…}` aunque venga envuelto en texto.
   - Valida los enums de estado y acción, y limita las coordenadas a los bordes de la imagen.
   - Si piden `click` sin coordenadas, lo degrada a `wait`.
   - Ante un error de la API devuelve `state=unknown, action=wait`, para que el bucle no se rompa.
6. **`locate_text()`** es el fallback del lobby: localiza un tile por su título en una captura.
7. **`summarize()`** redacta en español un resumen ejecutivo del `TestResult`. **No decide** el
   veredicto, solo lo explica.
8. **`stats()`** devuelve llamadas, latencia acumulada y tokens. Se muestran como métricas en el
   reporte, para hablar de coste por ejecución en el pitch.

**Entradas:** `VisionRequest`. **Salidas:** `VisionResponse` (§4.3).

---

#### 3.6 `reporter/report_generator.py`: reportes

**Propósito.** Convertir un `TestResult` en artefactos legibles por humanos (jueces y QA) y por
máquinas (CI).

**Lógica interna**

1. Escribe `./reports/<run_id>/result.json` con `TestResult.to_dict()` (los enums se pasan a string).
2. Renderiza `report.html` con Jinja2 (plantilla embebida y autoescape). El reporte contiene:
   - **Cabecera** con el badge del veredicto (color por estado), el juego, el sitio, la duración y
     el motivo.
   - **Resumen IA.**
   - **KPIs**: tiempo total, tiempo por fase, errores de consola, peticiones fallidas, llamadas,
     latencia y tokens de IA.
   - **Una tarjeta por fase** con su estado, resumen, miniaturas clicables y un desplegable de
     detalles JSON.
   - **Vídeo** incrustado.
   - **Timeline** completo con un enlace 📸 a la captura de cada evento.
   - **Artefactos**: trace, log y JSON.
3. **Enlaces relativos.** `link()` transforma la ruta relativa al proyecto en una ruta relativa al
   propio `report.html` (`../../screenshots/<run_id>/…`). La carpeta del proyecto se puede mover o
   comprimir sin romper nada.
4. Regenera `./reports/index.html` con el **histórico** de todas las ejecuciones.
5. El HTML admite modo oscuro, es responsive y no depende de recursos externos.

**Entradas:** `TestResult`. **Salidas:** `{"html": "reports/<id>/report.html", "json": "reports/<id>/result.json"}`.

---

#### 3.7 `utils/logger.py`: logs y timeline

- `get_logger(name, log_file)` usa `rich` en consola (con fallback a `logging` estándar) y un
  `FileHandler` en `./reports/<run_id>/run.log`. Es idempotente: no duplica handlers.
- `Timeline.add(phase, message, level, screenshot, **data)` registra eventos estructurados
  (`TimelineEvent`) con su marca de tiempo. `to_list()` añade `elapsed_s` desde el inicio de la
  ejecución.

#### 3.8 `utils/models.py`: contratos de datos

Contiene las dataclasses serializables (`to_dict()`) con todos los contratos de la §4 y el enum
`Verdict`.

#### 3.9 `main.py`: orquestador

**Propósito.** Coordinar las fases, garantizar que **siempre** se genera un reporte y traducir el
resultado a un código de salida para CI.

**Lógica interna**

1. **CLI** (`argparse`): `--site`, `--game`, `--headless`, `--provider`, `--no-ai`, `--check` y
   `--save-session`.
2. Crea `run_id = YYYYmmdd_HHMMSS`, `RunConfig`, el logger con fichero y el `Timeline`. Instancia
   `VisionSolver`; si falta la API key, la IA queda desactivada con un aviso y la fase PLAY
   devolverá `BLOCK`.
3. Ejecuta **LOBBY → LAUNCH → PLAY** en secuencia. Cada fase produce un `PhaseResult`. Si una fase
   no da `PASS`, las restantes se añaden como `SKIPPED`. Antes de PLAY se respeta
   `GLOBAL_RUN_TIMEOUT_S`.
4. Una **excepción global** se registra como fase `SESSION` en `FAIL` con su traza en el log.
5. El bloque **`finally`** se ejecuta siempre:
   1. Cierra el navegador.
   2. Calcula el veredicto con `decide_verdict()` (el primer `BLOCK`, `FAIL` o `INCONCLUSIVE`
      decide; `PASS` solo si las 3 fases pasan).
   3. Calcula las métricas y pide el resumen IA.
   4. Registra los artefactos.
   5. Llama a `ReportGenerator.generate()`.
6. **Códigos de salida:** `0=PASS`, `1=FAIL`, `2=BLOCK`, `3=INCONCLUSIVE`, listos para GitHub
   Actions o Jenkins.
7. **`--check`** hace un self-test: comprueba los imports, lanza Chromium contra un canvas local,
   verifica la API key y genera el reporte de ejemplo `./reports/selfcheck/`.
8. **`--save-session`** abre un navegador headed para que una persona haga el login o acepte
   cookies, y guarda `./auth/storage_state.json`.

---

### 4. Contratos de datos e interfaces entre módulos

Definidos en `utils/models.py`. Las rutas a capturas son **siempre relativas a la raíz del proyecto**.

#### 4.0 Enum `Verdict`

```
"PASS" | "FAIL" | "BLOCK" | "INCONCLUSIVE" | "SKIPPED"
```

#### 4.1 `LobbyState` (`LobbyNavigator.find_game()` → `main.py`)

```json
{
  "status": "PASS",
  "game_name_requested": "Starburst",
  "game_name_found": "starburst netent",
  "match_score": 100.0,
  "strategy": "search",                       // "search" | "scroll" | "direct_url" | "none"
  "tile_visible": true,
  "tile_image_loaded": true,
  "tile_bbox": { "x": 312.0, "y": 410.5, "width": 180.0, "height": 240.0 },
  "lobby_url": "https://www.betsson.com/en/casino",
  "cookies_accepted": true,
  "modals_closed": 1,
  "screenshots": ["screenshots/20261015_101500/01_lobby.png",
                  "screenshots/20261015_101500/02_lobby_tile.png"],
  "duration_ms": 8421,
  "error": null
}
```

#### 4.2 `LaunchState` (`GameLauncher.launch()` → `main.py`)

```json
{
  "status": "PASS",
  "game_url": "https://www.betsson.com/en/casino/game/starburst",
  "iframe_found": true,
  "iframe_src": "https://provider-cdn.example/games/starburst/index.html?mode=demo",
  "canvas_found": true,
  "canvas_rendered": true,
  "canvas_bbox": { "x": 0, "y": 64, "width": 1366, "height": 704 },
  "render_surface": "canvas",                 // "canvas" | "iframe" | "page" | "unknown"
  "load_time_ms": 14230,
  "console_errors": [],
  "failed_requests": ["404 https://…/analytics.js"],
  "screenshots": ["screenshots/20261015_101500/04_game_loaded.png"],
  "error": null
}
```

#### 4.3 `VisionRequest` / `VisionResponse` (`GameLauncher` ⇄ `VisionSolver`)

**Petición** (`VisionSolver.analyze(req)`):

```json
{
  "image_path": "screenshots/20261015_101500/play_step_03.png",
  "image_width": 1366,
  "image_height": 704,
  "goal": "Play exactly one round in demo mode (press Spin/Play/Deal).",
  "step": 3,
  "history": ["step 1: waited (state loading)",
              "step 2: clicked 'Continue' at (683,520) in state splash"]
}
```

**Respuesta.** Las coordenadas están en píxeles de la imagen **original** (ya reescaladas):

```json
{
  "state": "ready",                           // loading|splash|tutorial|popup|ready|spinning|result|error|unknown
  "action": "click",                          // click|wait|none
  "x": 1203,
  "y": 612,
  "target": "Spin button",
  "confidence": 0.91,
  "reason": "Game idle, large round spin button bottom-right",
  "balance_text": "€1,000.00",
  "provider": "anthropic",
  "model": "claude-sonnet-5-5",
  "latency_ms": 2870,
  "raw": "{\"state\":\"ready\",…}"
}
```

**Formato JSON que se exige al LLM** (definido en `SYSTEM_PROMPT`):

```json
{"state":"...","action":"click|wait|none","x":0,"y":0,"target":"...","confidence":0.0,"reason":"...","balance_text":null}
```

#### 4.4 `PlayState` + `PlayEvidence` (`GameLauncher.play_round()` → `main.py`)

```json
{
  "status": "PASS",
  "rounds_played": 1,
  "evidence": {
    "spin_requests": [{ "url": "https://provider.example/api/spin", "method": "POST", "t": 1760516123.4 }],
    "ws_frames": 0,
    "visual_diff_ratio": 0.246,
    "balance_before": "1000",
    "balance_after": "1010",
    "vision_saw_result": true,
    "steps": [ { "step": 1, "state": "splash", "action": "click", "x": 480, "y": 295,
                 "confidence": 0.9, "screenshot": "screenshots/…/play_step_01.png", "...": "..." } ]
  },
  "screenshots": ["screenshots/…/play_step_03.png", "screenshots/…/08_after_play.png"],
  "duration_ms": 8040,
  "error": null
}
```

#### 4.5 `PhaseResult` y `TestResult` (`main.py` → `ReportGenerator`)

```json
{
  "run_id": "20261015_101500",
  "site": "betsson_com",
  "game_name": "Starburst",
  "started_at": "2026-10-15T10:15:00",
  "finished_at": "2026-10-15T10:15:42",
  "duration_ms": 42100,
  "verdict": "PASS",
  "verdict_reason": "El juego aparece en el lobby, carga correctamente y se jugó una ronda.",
  "ai_summary": "Se verificó Starburst en betsson.com…",
  "phases": [
    { "name": "LOBBY",  "status": "PASS", "duration_ms": 8421,  "summary": "…", "details": { /* LobbyState */ },  "screenshots": [] },
    { "name": "LAUNCH", "status": "PASS", "duration_ms": 14230, "summary": "…", "details": { /* LaunchState */ }, "screenshots": [] },
    { "name": "PLAY",   "status": "PASS", "duration_ms": 8040,  "summary": "…", "details": { /* PlayState */ },   "screenshots": [] }
  ],
  "timeline": [ { "t": 1760516100.1, "elapsed_s": 0.4, "phase": "LOBBY", "level": "INFO",
                  "message": "Cookies aceptadas (#onetrust-accept-btn-handler)", "screenshot": null, "data": {} } ],
  "metrics": { "total_s": 42.1, "lobby_ms": 8421, "launch_ms": 14230, "play_ms": 8040,
               "console_errors": 2, "failed_requests": 1, "ai_calls": 6, "ai_latency_ms": 17400, "ai_tokens": 9800 },
  "artifacts": { "video": "reports/…/video/abc.webm", "trace": "reports/…/trace.zip", "log": "reports/…/run.log" },
  "environment": { "python": "3.12.4", "os": "Windows", "headless": false,
                   "viewport": { "width": 1366, "height": 768 }, "channel": "chrome" }
}
```

#### 4.6 Interfaces públicas (firmas)

```python
BrowserDriver(run_cfg: RunConfig, logger, timeline=None)
  .start() -> Page;  .stop();  .screenshot(name, full_page=False, target=None) -> str
  .begin_play_capture();  .end_play_capture();  .save_session()

LobbyNavigator(driver, logger, timeline, vision: VisionSolver | None)
  .find_game(game_name: str) -> LobbyState;  .open_game();  .close_modals(rounds=3) -> int

GameLauncher(driver, logger, timeline, vision: VisionSolver | None)
  .launch(lobby_navigator) -> LaunchState;  .play_round() -> PlayState
  @staticmethod judge_play(ps: PlayState, spin_clicked: bool) -> Verdict

VisionSolver(logger, provider="anthropic" | "openai")
  .analyze(VisionRequest) -> VisionResponse
  .locate_text(image_path, text, w, h) -> VisionResponse
  .summarize(result_dict) -> str;  .stats() -> dict

ReportGenerator(logger).generate(TestResult) -> {"html": str, "json": str}
main.decide_verdict(phases: list[PhaseResult]) -> (Verdict, str)
```

---

### 5. Instalación, setup y ejecución en 3 pasos (Windows)

Requisitos: **Python 3.10+** (recomendado 3.12) y Google Chrome instalado (opcional; si no está, se
usa Chromium). Todos los comandos se ejecutan **desde la carpeta raíz del proyecto**.

#### Paso 1: entorno virtual

**PowerShell**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
# Si PowerShell bloquea el script:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**CMD**
```bat
python -m venv .venv
.venv\Scripts\activate.bat
```

#### Paso 2: dependencias, navegadores y `.env`

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium chrome
copy .env.example .env
notepad .env        # rellenar ANTHROPIC_API_KEY (u OPENAI_API_KEY + VISION_PROVIDER=openai)
```

> Si `playwright install chrome` falla porque ya tienes Chrome instalado, ignóralo: se usa tu Chrome.

#### Paso 3: verificación y ejecución

```powershell
# 3.1 Self-test (sin webs reales): dependencias, Chromium, API key y reporte de ejemplo
python main.py --check

# 3.2 Ensayo end-to-end offline contra el casino simulado (dos terminales)
python -m http.server 8000 --directory mock_casino        # terminal A
python main.py --site mock --game "Neon Dragon"           # terminal B

# 3.3 (Opcional) Guardar sesión real: login manual + cookies → ./auth/storage_state.json
python main.py --site betsson_com --save-session

# 3.4 Ejecución real
python main.py --site betsson_com --game "Starburst"
python main.py --site betsson_com --game "Book of Dead" --provider openai --headless
```

**Resultado:**
- Abre `.\reports\<run_id>\report.html` en el navegador. El histórico está en `.\reports\index.html`.
- El `trace.zip` se arrastra a <https://trace.playwright.dev> para ver el paso a paso con DOM, red y capturas.
- Código de salida: `echo $LASTEXITCODE` (PowerShell) o `echo %ERRORLEVEL%` (CMD). `0=PASS`,
  `1=FAIL`, `2=BLOCK`, `3=INCONCLUSIVE`.

**Variables útiles en caliente (PowerShell):**
```powershell
$env:BROWSER_CHANNEL=""; $env:GAME_AGENT_MAX_STEPS="20"; python main.py --game "Sweet Bonanza"
```

---

### 5 bis. Ejecución con Docker (recomendada por el equipo)

Requisito: Docker Desktop arrancado. No hace falta instalar Python ni navegadores en el host: la imagen
parte de `mcr.microsoft.com/playwright/python:v1.56.0-noble`, que ya trae Chromium.

```powershell
docker compose build                                            # construye la imagen (la primera vez tarda)
docker compose run --rm bot --check                             # self-test dentro del contenedor
docker compose run --rm bot --site mock --game "Neon Dragon" --no-ai   # ensayo con el casino simulado
docker compose run --rm bot --site mock --game "Neon Dragon"           # igual, con IA (requiere .env)
docker compose down                                             # para el casino simulado
```

- `docker-compose.yml` levanta dos servicios: `mock` (sirve `mock_casino/` en `http://mock:8000`) y `bot`.
- Dentro del contenedor siempre es **headless** y con el Chromium de Playwright; esas variables prevalecen sobre `.env`.
- `.env` es opcional y se lee si existe (API keys). No se copia a la imagen (`.dockerignore`).
- `reports/`, `screenshots/` y `auth/` se montan como volúmenes: los resultados aparecen en tu carpeta.
- `--save-session` (login manual) **no** funciona dentro de Docker porque no hay pantalla: hazlo fuera con el entorno virtual.

### 6. Plan de contingencia y gestión de edge cases

#### 6.1 El juego es `<canvas>` puro y los selectores DOM fallan

Escalera de fallbacks, de más barato y determinista a más caro:

| Nivel | Estrategia | Dónde |
|---|---|---|
| 1 | Buscar `<canvas>` en **todos** los frames (anidados y de otro dominio) | `_resolve_surface()` |
| 2 | Si no hay canvas accesible (shadow DOM, canvas tardío), usar el **iframe** completo como superficie y capturarlo | `_resolve_surface()` |
| 3 | **Visión IA** sobre la captura de la superficie → coordenadas → `page.mouse.click()` con escalado | `play_round()` + `VisionSolver` |
| 4 | Si la IA tiene baja confianza (`< VISION_MIN_CONFIDENCE`), esperar y reintentar con el historial; subir `GAME_AGENT_MAX_STEPS` | `.env` |
| 5 | Muchos juegos aceptan **`Space`** como spin: añadir `page.keyboard.press("Space")` tras el clic en el canvas | mejora rápida en `play_round()` |
| 6 | Cambiar de proveedor de IA (`--provider openai`) para comparar precisión de coordenadas | CLI |
| 7 | Para el lobby: `VisionSolver.locate_text()` + `elementFromPoint` cuando el tile no expone texto | `_search_via_vision()` |

**Consejos de precisión:**
- Capturad **la superficie**, no la página, para que las coordenadas sean del mismo sistema que el clic.
- No cambiéis el zoom del navegador durante la ejecución.
- Revisad las capturas anotadas (círculo rojo) para depurar clics desviados.

**Evidencia de jugada si la red no coincide:** ajustad `SPIN_URL_PATTERNS` tras inspeccionar
DevTools → Network al pulsar spin. Si el proveedor usa WebSocket, `ws_frames > 0` ya cuenta como
evidencia de red.

#### 6.2 Cloudflare, captchas y pop-ups inesperados

- **Prevención:**
  - Modo headed (`HEADLESS=false`), canal Chrome real, `STEALTH_INIT_SCRIPT`, sesión persistente
    (`--save-session`) y `SLOW_MO_MS=50` para un ritmo humano.
  - No lanzar ejecuciones en paralelo contra el mismo sitio.
- **Detección:** `detect_block()` reconoce los muros típicos y devuelve `BLOCK` con captura. Un
  bloqueo no es un fallo del juego, y el reporte lo distingue.
- **Si salta un captcha:** **no se automatiza su resolución**. Se resuelve a mano una vez con
  `--save-session`, y las cookies de verificación quedan en `./auth/storage_state.json`. Pedid
  también a Betsson que pongan vuestra IP o cuentas de test en una allowlist.
- **Pop-ups promocionales, de edad o de juego responsable:**
  - `close_modals()` se ejecuta tras cargar el lobby y tras abrir el juego.
  - Dentro del juego, la IA clasifica `popup`/`tutorial` y los cierra.
  - Si aparece uno nuevo y recurrente, añadid su selector a `MODAL_CLOSE_SELECTORS`, que es el
    único sitio que hay que tocar.
- **Banners de cookies:** se aceptan con `COOKIE_ACCEPT_SELECTORS` (OneTrust e inglés, español y
  sueco). Cuando ya están en `storageState` no vuelven a salir.

#### 6.3 Restricciones geográficas, login y latencia del iframe

- **Geo:** cada `SiteConfig` fija `locale`, `timezone_id` y `geolocation` coherentes con el
  mercado. Si la IP no es del mercado, el sitio puede redirigir o bloquear y `detect_block()`
  devolverá `BLOCK`. Para mitigarlo:
  - Usar la marca o dominio de vuestro mercado (`--site betsson_es`).
  - Usar la VPN o el proxy que facilite la organización.
  - Si no hay acceso real, hacer la demo con el **mock** y explicar el `BLOCK` como resultado
    correcto del sistema.
- **Login obligatorio para el modo demo:** usad `--save-session` con la cuenta de test de Betsson.
  Las credenciales nunca van en el código, solo en `.env`, y el login automático solo se añade si
  la organización lo permite.
- **Latencia de carga (10-60 s):**
  - Subid `GAME_LOAD_TIMEOUT_MS` (por ejemplo 90000).
  - Se puede reducir `CANVAS_STABLE_SECONDS` si la intro tiene animación constante.
  - Los estados `loading` de la IA no consumen clics, solo esperas.
- **El juego abre en una nueva pestaña o ventana:** se detecta automáticamente y los listeners de
  red también se enganchan a la nueva pestaña.
- **Streams de casino en vivo (Evolution):** no hay "spin". El objetivo de la IA se puede cambiar a
  "colocar una ficha mínima en modo demo", y como evidencia vale la diferencia visual más el
  mensaje de apuesta aceptada. Si no hay modo demo, el veredicto correcto es `BLOCK`.
- **Timeout global:** `GLOBAL_RUN_TIMEOUT_S` evita bucles infinitos en la demo, y
  `GAME_AGENT_MAX_STEPS` limita el coste de IA.

#### 6.4 Checklist del día del hackatón

- [ ] Pedir a Betsson URLs, cuentas de test, lista de "juegos nuevos" y política de modo demo/geo.
- [ ] `python main.py --check` en todas las máquinas.
- [ ] Inspeccionar en DevTools 3 juegos de proveedores distintos y ajustar `SPIN_URL_PATTERNS` y los selectores.
- [ ] `--save-session` con la cuenta de test.
- [ ] Primer `PASS` real lo antes posible, con un solo juego.
- [ ] Grabar un **vídeo de respaldo** de una ejecución `PASS` por si falla la red en la demo.

---

### 7. Convenciones del equipo

- **Rutas:** prohibidas las rutas absolutas en el código. Usad siempre `C.PROJECT_ROOT`, `C.SCREENSHOTS_DIR`, `C.REPORTS_DIR` y `C.rel()`.
- **Secretos:** solo en `.env` (ignorado por git). `.env.example` documenta las variables.
- **Selectores nuevos:** se añaden a las listas de `config.py`, nunca dispersos por el código.
- **Nuevas evidencias:** se añaden como campo en `PlayEvidence` y se incorporan a las reglas de `judge_play()`.
- **Commits:** pequeños y frecuentes. Antes de hacer push, `python main.py --check` y el ensayo con el mock deben pasar.
