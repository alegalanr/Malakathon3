# Tester (TypeScript + Playwright Test)

Implementación de `SOLUCION.md` (núcleo, fases F0-F13 y contratos C1-C18) y `DISENO.md` (CI, informe y modo simulado) del equipo, contra **betsson.es**.

## Ejecutar

Todo en Docker (imagen oficial de Playwright); en el host no se instala nada.

1. `tester/.env` (no se sube) con las cuentas de prueba:

   ```
   BETSSON_ES_USER=...
   BETSSON_ES_PASS=...
   BETSSON_ES_EMPTY_USER=...   # escenario 2 (cuando la den los mentores)
   BETSSON_ES_EMPTY_PASS=...
   ```

   Opcionales: `MAX_BET` (EUR, por defecto 5), `GAME_NAME` / `GAME_SEARCH` / `GAME_PATH` (por defecto Bubble Up), `RUN_MODE` (`real` por defecto en local), `SIMULATION` (`pass` | `mixed`).

2. Primera vez: `docker compose -f tester/compose.yaml run --rm tester npm install`

3. Modo UI → <http://localhost:8080>, proyecto **`es`**:

   ```bash
   docker compose -f tester/compose.yaml up
   ```

Otros comandos (`docker compose -f tester/compose.yaml run --rm tester …`):

| Comando | Qué hace |
|---|---|
| `npx playwright test --project=es tests/completed-spin.spec.ts` | Escenario 1 contra la web real |
| `npm run unit` | Tests unitarios: Money, adaptador, reglas con rondas reales, secretos (sin navegador) |
| `npm run smoke` | Lobby público: cookies + buscador (sin sesión ni dinero) |
| `RUN_MODE=simulated npx playwright test --project=es` | Los dos escenarios con datos simulados (añade `SIMULATION=mixed` para ver FAIL) |

Tras cada escenario: **`tester/reports/es-<escenario>/report.html`** (el entregable: checks con esperado, obtenido, fuentes y evidencias), `report.json` (C14), `timeline.jsonl` censurado y `evidence/` (capturas y recortes del OCR). La traza de Playwright queda en `test-results/` y no se publica (D9).

## Cómo funciona

```
global-setup  login de cada cuenta en un navegador sin traza → .auth/es-<escenario>.json
F0  RunConfig (zod) · OCR (tesseract.js, eng+spa)       F7  ronda hasta resultShown (o rechazo) · captura liquidada
F1  sesión en el dominio del mercado + cartera en EUR    F8  testigo visual: rid y apuesta (o aviso y apuesta)
F2  oyentes: postMessage (top) · red · cartera           F9  cartera final B1, posterior a la ronda
F3  buscar → Real Play → DGOJ → iframe → READY · saldo juego = cartera   F10 GameRound + invariantes §14.3
F4  ControlMap: control de girar y zonas de lectura      F11 checks (IDs de DISENO §7.3)
F5  B0, saldo del juego, apuesta ≤ máximo · captura en reposo   F12 report.json + report.html
F6  Espacio → ROUND_STARTED; si no, explorador (Enter → barrido → clic + evento)
```

Si una fase de F1-F9 falla, las siguientes quedan "no ejecutada" con el motivo; F10-F12 se ejecutan siempre y el informe explica dónde se paró.

## Verificado

| Qué | Evidencia |
|---|---|
| Compila (`tsc --noEmit`) | Docker, 15/10 |
| 17 tests unitarios (rondas reales …658268119 y …663731119 → PASS; alteradas → FAIL justo en su check) | `npm run unit` |
| Modo simulado con **OCR real** sobre un juego falso: `pass` 14/14; `mixed` → FAIL solo en `S1-RID-VISIBLE` y `S2-MSG-LANG-VISIBLE` | `RUN_MODE=simulated` |
| `merge-reports` + `scan-secrets` sobre los informes: sin secretos | `site/index.html`, `summary.md` |
| Lobby real: cookies rechazadas y buscador devuelve Bubble Up | `npm run smoke` |
| El escenario contra la web real con sesión | **Sin ejecutar** (necesita tus credenciales) |

## Cómo se han tapado los huecos de los documentos

| Hueco | Solución | Por qué |
|---|---|---|
| El login (F1) dejaba la contraseña en la traza (el modo UI traza siempre) | Login en `global-setup.ts`, en un navegador aparte sin traza; F1 verifica la sesión, el dominio y que la cartera responde en EUR | "Sin dejar credenciales en ningún sitio" (F1) también en el modo UI |
| Tras una navegación interna de la web (SPA) el script de inicio no se ejecuta | F2 instala además el listener en la página ya cargada (con guarda para no duplicarlo) | Si no, se pierden `gameLoadingEnded` y los eventos de la ronda |
| F5 exige `currentBet` ≤ `maxBet`, pero puede no llegar `betChanged` al cargar | Si no hay evento, la apuesta se lee en pantalla (testigo visual sobre la captura en reposo); si tampoco, no se gira | Prudencia con dinero real sin bloquear el escenario |
| "Un único reintento" en F6 y el explorador de §3.4 | El reintento es el explorador: Enter → barrido sin clics → clic clasificado por evento (máx. 6, Escape en ventanas) | Une F6 con §3.4 sin hacer más de una tirada |
| El `#` del rid se lee como `4` (comprobado con OCR real) | El ancla del rid también acepta "6+ dígitos en la esquina inferior izquierda"; la comparación ya tolera el carácter extra | Sin esto el check visual del rid fallaba siempre |
| `ssid=***` hacía saltar el escáner aunque estaba censurado (encontrado por un test) | La censura renombra también la clave | Si no, `scan-secrets` bloquearía siempre la publicación |
| `markets.json` no tenía `es` (la testbed) | Añadido con `loginPath`, `locale`, `timezone` y formato de número | Las cuentas son de betsson.es |
| Vídeo | Desactivado | El vídeo graba el usuario en pantalla y no se puede enmascarar (DISENO lo deja opcional) |

## Pendiente de definir (para pasar el trabajo)

| # | Qué | Dónde | Qué hace falta |
|---|---|---|---|
| 1 | ⚠️ **Formulario de login** sin ver (en el navegador de pruebas `/inicio` no lo pinta) | `BetssonSite.login()` | Primera ejecución: si falla, `tester/.auth/login-fallido-*.png` (campos tapados) |
| 2 | ⚠️ **Sesión de juego DGOJ**: solo se detecta e intenta confirmar | `handleGameSession()` | Qué pide y cómo se confirma |
| 3 | ⚠️ **Botón de Real Play** o `?gameAction=play` | `launchRealPlay()` | Confirmarlo con sesión |
| 4 | ⚠️ **Sobre de los mensajes postMessage** (dónde va el nombre): el adaptador lo busca en cualquier campo | `PragmaticAdapter` | Un mensaje real; los no reconocidos quedan en `timeline.jsonl` como `raw` |
| 5 | ⚠️ **F3 exige `updateBalance`** para comprobar Real Play (saldo del juego = cartera) | `runScenario` F3 | Confirmar que llega al cargar |
| 6 | ⚠️ **Zonas del OCR en el juego real** (fuente de Pragmatic, posición de APUESTA y `#rid`) | `RoiLocator`, `control-maps/` | Primera ejecución: recortes en `evidence/crop-*.png` |
| 7 | **Escenario 2**: contrato del rechazo (`REJECTED` por descubrir) | adaptador + F7 | Cuenta sin saldo |
| 8 | **GitHub**: secrets `BETSSON_ES_*`, activar Pages (repo privado: depende del plan) y `RUNNER=self-hosted` si los runners no llegan a betsson.es | `.github/workflows/validate.yml` | Configurarlo en el repo |
