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
| `npm run unit` | Tests unitarios: Money, adaptador, reglas con rondas reales, secretos, escenario 2 y casos raros (sin navegador) |
| `npm run smoke` | Lobby público: cookies + buscador (sin sesión ni dinero) |
| `RUN_MODE=simulated npx playwright test --project=es` | Los dos escenarios con datos simulados (añade `SIMULATION=mixed` para ver FAIL) |
| `node scripts/compare-games.mjs reports/juegos/*` | Compara el escenario 1 en varios juegos de Pragmatic (ver [Escenario 2 y casos raros](#escenario-2-y-casos-raros)) |

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

## Seguridad de las evidencias

Las capturas, el timeline y los informes de una ejecución real pueden enseñar datos de la cuenta de prueba. Medidas:

| Riesgo | Medida |
|---|---|
| Usuario o perfil en las capturas de página completa (casino, sesión DGOJ, cartera tras la ronda) | Se tapan con `privacy.maskSelectors` de `config/markets.json` (cabecera y zonas de cuenta o perfil) |
| Un selector que no tapa algo | `src/evidence/PrivacyScan.ts`: antes del informe, el OCR lee cada captura y, si aparece el usuario o la contraseña (`BETSSON_*_USER` / `_PASS`), la difumina. Sin OCR, difumina por precaución las capturas de página completa |
| Tokens en la consola (acaba en los logs de CI) | La consola se censura igual que `timeline.jsonl` |
| Informes públicos | Las ejecuciones `real` no se publican en GitHub Pages (que puede ser público aunque el repo sea privado): quedan en el artefacto `site`, visible solo con acceso al repo. Para publicarlas hay que poner a propósito la variable `PUBLISH_REAL_TO_PAGES=true` |
| Dos ejecuciones a la vez sobre la misma cuenta (dinero gastado de más, saldos que no cuadran) | `concurrency` en el workflow: las ejecuciones se ponen en cola. **En local no hay cola**: no lances una ejecución real mientras corre otra, en CI o en otro ordenador |
| Datos del OCR descargados de un CDN | Vienen de los paquetes `@tesseract.js-data/eng` y `spa` (integridad por `package-lock.json`); `npm install` los deja en `.cache/tessdata` |
| Una Action de GitHub alterada | Las Actions van fijadas por commit (SHA), con la versión en un comentario |

El bot antiguo en Python (`bot/`) manda capturas a APIs de IA externas (`bot/vision.py`): **no se usa con sesión real**, porque las capturas con datos de la cuenta saldrían a un tercero. El tester (`tester/`) no usa IA externa.

Tras la primera ejecución real, revisa a mano las capturas de `reports/es-*/evidence/` antes de compartir nada: las máscaras dependen de selectores de la web que no se han podido comprobar sin sesión.

## Escenario 2 y casos raros

### Rechazo por saldo insuficiente (F7)

Tras el intento, `detectRejection()` (`src/scenario2/RejectionDetector.ts`) junta **tres señales independientes**:

- **Evento:** un `REJECTED` del adaptador.
- **Red:** un `doSpin` con error.
- **Pantalla:** la imagen del juego cambia (el aviso).

Con ellas da un veredicto:

| Veredicto | Cuándo |
|---|---|
| `charged` | Hubo `doSpin` sin error o `ROUND_STARTED` con apuesta: la tirada se cobró |
| `rejected` | Sin cobro y con al menos una señal (confianza alta con dos o más) |
| `rejected-unconfirmed` | Sin cobro y solo eventos no reconocidos |
| `no-reaction` | Nada: F7 falla («ninguna reacción tras el intento») |

`S2-REJECTED` sigue siendo PASS o FAIL por la misma regla ("ningún `ROUND_STARTED` con cobro ni `doSpin` cobrado"); además, ahora el campo "obtenido" muestra el veredicto y las señales.

Al terminar, `reports/es-insufficient-balance/rejection-contract.json` recoge el **borrador del contrato de rechazo**:

- qué evento llegó, con una muestra censurada;
- los eventos no reconocidos;
- las llamadas a `gameService`;
- cuándo cambió la pantalla y el texto leído del aviso;
- los saldos antes y después.

Con la primera ejecución real se confirma o corrige `config/rejection-hypotheses.json`: los nombres y contenidos que el adaptador traduce a `REJECTED`, y las claves de error de la red. Mientras su `status` sea `hypothesis`, el evento es una señal más, no la prueba.

### Casos raros

| Caso | Qué hace el tester | Dónde |
|---|---|---|
| Cuenta "sin saldo" **con** saldo para la apuesta | **No gira** (F5 falla con el motivo): se gastaría dinero real. Si el juego y la cartera discrepan, manda el mayor | `scenarioPrecondition()` en F5 |
| Escenario 1 sin saldo para la apuesta | No gira: la tirada se rechazaría | `scenarioPrecondition()` en F5 |
| Ronda pendiente al cargar | Espera a que termine (`ROUND_ENDED`, máx. 45 s) antes de leer el estado inicial | F5 |
| Free spins o bonus (ronda extendida) | Se detecta por varios `doSpin`, un `na` distinto de `s`/`c`, acciones de bonus en la red o varios `spinStarted`. **No pulsa nada**: espera a que el juego termine solo (máx. 180 s, 15 s sin actividad), hace una captura y F7 falla con el motivo, porque el tester valida rondas de una sola tirada | `extendedRoundSignals()` en F7 |
| Aviso en otro idioma | `S2-MSG-LANG-VISIBLE` da FAIL. El idioma se detecta por **frases completas**: antes, "Deposita" contenía "deposit" y un aviso en español salía como inglés | `detectLanguage()` |
| Premio = apuesta | Ya cubierto: F9 espera una lectura **posterior** de la cartera, no un cambio de saldo | F9 |
| Apuesta por encima de `maxBet` | Ya cubierto: F5 no gira, y si aun así empieza una ronda, `S1-BET-USED` da FAIL | F5 y reglas |
| Ronda duplicada o autoplay, falta de `doCollect`, otro mercado | Ya cubiertos | F7 y `BetssonSite.session()` |

### Probar varios juegos

El flujo no depende del juego: se cambia con `GAME_NAME`, `GAME_SEARCH` y `GAME_PATH`.

```bash
GAME_NAME="<juego>" GAME_SEARCH="<juego>" GAME_PATH="/casino/…/<slug>" npx playwright test --project=es tests/completed-spin.spec.ts
cp -r reports/es-completed-spin reports/juegos/<juego>   # tras cada juego
node scripts/compare-games.mjs reports/juegos/*            # → reports/juegos/comparison.md
```

`comparison.md` compara, juego a juego:

- el `sender`;
- las fases y los checks;
- el orden `ROUND_STARTED → SPIN_ENDED → ROUND_ENDED`;
- si hay `doSpin` en la red;
- el control con el que se giró;
- los eventos no traducidos.

Al final dice si el flujo es genérico.

## Pendiente de definir (para pasar el trabajo)

| # | Qué | Dónde | Qué hace falta |
|---|---|---|---|
| 1 | ⚠️ **Formulario de login** sin ver (en el navegador de pruebas `/inicio` no lo pinta) | `BetssonSite.login()` | Primera ejecución: si falla, `tester/.auth/login-fallido-*.png` (campos tapados) |
| 2 | ⚠️ **Sesión de juego DGOJ**: solo se detecta e intenta confirmar | `handleGameSession()` | Qué pide y cómo se confirma |
| 3 | ⚠️ **Botón de Real Play** o `?gameAction=play` | `launchRealPlay()` | Confirmarlo con sesión |
| 4 | ✔ **Sobre de los mensajes postMessage**: visto en real el 15/10. El nombre llega en `name` o en `event`, y la moneda como símbolo (`€`, que se convierte a `EUR`) | `PragmaticAdapter` | Hecho: `tests/unit/real-messages.spec.ts` y `docs/web-betsson.md` |
| 5 | ✔ **F3 exige `updateBalance`**: llega al cargar el juego, con el saldo en céntimos (15/10) | `runScenario` F3 | Falta comprobar que coincide con la cartera en una ejecución completa |
| 6 | ⚠️ **Zonas del OCR en el juego real** (fuente de Pragmatic, posición de APUESTA y `#rid`) | `RoiLocator`, `control-maps/` | Primera ejecución: recortes en `evidence/crop-*.png` |
| 7 | **Escenario 2**: confirmar el contrato del rechazo. El detector y las hipótesis ya están; falta verlo en real | `config/rejection-hypotheses.json` y `rejection-contract.json` | Cuenta sin saldo: una ejecución real del escenario 2 |
| 8 | **GitHub**: secrets `BETSSON_ES_*`, activar Pages (repo privado: depende del plan) y `RUNNER=self-hosted` si los runners no llegan a betsson.es | `.github/workflows/validate.yml` | Configurarlo en el repo |
