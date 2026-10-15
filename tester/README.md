# Tester (TypeScript + Playwright Test)

Escenario 1 del reto (tirada completada en Real Play) contra **betsson.es**, la testbed que nos han dado.
El diseño completo es el de `SOLUCION.md` del equipo; esto es su versión básica de punta a punta.

## Puesta en marcha

Todo en Docker (imagen oficial de Playwright); en el host no se instala nada.

1. Crea `tester/.env` (no se sube) con:

   ```
   BETSSON_ES_USER=tu-usuario-de-prueba
   BETSSON_ES_PASS=tu-contraseña-de-prueba
   ```

   Opciones (todas tienen valor por defecto, ver [Opciones](#opciones)): `MAX_BET`, `GAME_SEARCH`, `GAME_PATH`, `OPEN_MODE`, `SPIN_MODE`, `SPIN_CLICK_X`, `SPIN_CLICK_Y`, `UNKNOWN_BET`, `WALLET_WAIT_S`.

2. Instala las dependencias (la primera vez):

   ```bash
   docker compose -f tester/compose.yaml run --rm tester npm install
   ```

3. Abre el modo UI y míralo funcionar:

   ```bash
   docker compose -f tester/compose.yaml up
   ```

   Abre <http://localhost:8080>, pulsa ▶ en el proyecto `lobby` (público, no gasta nada) o en `es` (escenario 1 completo). Cada paso sale con su captura; al terminar tienes la traza con red, consola y DOM.

Sin UI y con el informe HTML:

```bash
docker compose -f tester/compose.yaml run --rm tester npx playwright test --project=es
docker compose -f tester/compose.yaml run --rm --service-ports tester npm run report   # http://localhost:9323
```

Tras cada ejecución del escenario, `tester/evidence/ultima/` tiene `checks.json`, `timeline.jsonl` (censurado) y las capturas.

## Qué hace

```
global-setup  login sin traza ni vídeo → .auth/state.json (no se sube)
1  casino con la sesión iniciada · rechazar cookies no esenciales
2  saldo de Betsson antes (B0): respuesta de /api/v2/wallet/balance que pide la propia web
3  buscar «Bubble Up» en el lobby (o ir a su página si el buscador no lo devuelve)
4  abrir en Real Play · sesión de juego DGOJ si aparece · esperar gameLoadingEnded
5  antes de girar: apuesta y saldos; no se gira si la apuesta conocida supera MAX_BET
6  girar con Espacio y confirmarlo con gameRoundStarted
7  esperar spinEnded y resultShown · captura del resultado
8  saldo de Betsson después (B1): siguiente refresco de la cartera o recarga de la página
9  comprobaciones P1, S1.1–S1.5 y R1, cada una con esperado, obtenido y fuentes
```

| Id | Comprobación | Fuentes |
|---|---|---|
| P1 | Real Play: saldo del juego = cartera de Betsson antes de girar | evento + API cartera |
| S1.1 | La tirada empezó (tras nuestra acción) y terminó | eventos (+ `doSpin` en la red) |
| S1.2 | La apuesta mostrada es la usada | `gameRoundStarted` = `c×l` de `doSpin` (= `betChanged`) |
| S1.3 | La moneda es la del mercado (EUR) | API cartera + `updateBalance` |
| S1.4 | El saldo del juego cuadra: antes − apuesta + premio | eventos + `doSpin`/`doCollect` |
| S1.5 | El saldo de Betsson cuadra: B1 = B0 − apuesta + premio | API cartera |
| R1 | La ronda tiene `rid` del servidor | `doSpin` (+ captura) |

## Estructura

```
config/settings.ts        mercado, juego, opciones y tiempos (única fuente de ajustes)
global-setup.ts           login fuera de las pruebas
src/site/betsson.ts       cookies, login, sesión DGOJ, buscador, Real Play, iframe del juego
src/site/wallet.ts        cartera de Betsson (lectura pasiva de la red)
src/game/events.ts        listener de postMessage + adaptador de Pragmatic → eventos estándar
src/game/server-tap.ts    doSpin / doCollect de la red
src/validation/checks.ts  comprobaciones
src/evidence/             cronología y censura de secretos
tests/lobby.spec.ts       parte pública (sin sesión)
tests/completed-spin.spec.ts  escenario 1
```

## Decisiones

| Decisión | Cómo | Por qué | Alternativa descartada |
|---|---|---|---|
| Carpeta `tester/` aparte | TS con su propio `compose.yaml` | No se toca ni se borra el bot en Python; la limpieza se decide luego | Sustituir el Python ya |
| Login en `globalSetup` | Navegador sin traza ni vídeo; guarda la sesión | La traza de Playwright guarda el texto de cada `fill`: así la contraseña no llega al informe | Login dentro de la prueba con `mask` (el `mask` no protege la traza) |
| Eventos por `postMessage` | Script inyectado antes de cargar + `exposeBinding`, con la hora de llegada | Es lo que el juego ya cuenta a Betsson; no se toca el juego | Leer variables del juego (va contra el reto) |
| Adaptador tolerante | Busca el nombre del evento y sus valores en cualquier nivel del mensaje | El formato exacto del sobre aún no está fijado; los mensajes no reconocidos se guardan en bruto en la cronología | Asumir un formato y romperse |
| Cartera pasiva | Se escucha `/api/v2/wallet/balance`; si no refresca, se recarga la página | Somos una herramienta externa: solo datos que ya ve la página | Llamar a la API directamente |
| Captura en `resultShown` | Momento "liquidado" | En `spinEnded` el premio aún está contándose (lo vio el equipo) | Captura en `spinEnded` |
| Un worker y sin reintentos | `workers: 1`, `retries: 0` | Una cuenta = un saldo; con dinero real no se repite a ciegas | Paralelo |
| Imagen Docker fija | `mcr.microsoft.com/playwright:v1.56.0-noble` y `@playwright/test@1.56.0` | La versión del navegador y la de la librería tienen que coincidir | Instalar Node en el host |

## Opciones

Se eligen en `tester/.env`. En negrita, el valor por defecto.

| Variable | Valores | Qué cambia |
|---|---|---|
| `OPEN_MODE` | **`search`** · `url` | `search` busca en el lobby como un jugador (si no lo encuentra, va a la página del juego); `url` va directo |
| `SPIN_MODE` | **`space`** · `click` | `space` gira sin coordenadas; `click` hace clic en `SPIN_CLICK_X/Y` (0–1, relativos al juego) si Espacio no funciona |
| `UNKNOWN_BET` | **`spin`** · `abort` | Si no se conoce la apuesta antes del primer giro: `spin` gira y lo marca después si supera `MAX_BET`; `abort` no gira. Por defecto `spin` porque sin el explorador de controles aún no hay forma de leer la apuesta antes del primer giro |
| `MAX_BET` | **`5`** | Apuesta máxima en EUR. Ojo: Pragmatic recuerda la última apuesta del jugador (el equipo jugó con 2,80–4 €) |
| `GAME_SEARCH` / `GAME_PATH` | **`Bubble Up`** / **`/casino/tragaperras-slots/bubble-up`** | Otro juego de Pragmatic |
| `WALLET_WAIT_S` | **`40`** | Espera al refresco de la cartera antes de recargar la página |

## Pendiente de definir (para repartir)

Marcado también con ⚠️ en el código.

| # | Qué falta | Dónde | Qué hace falta saber |
|---|---|---|---|
| 1 | **Login** | `src/site/betsson.ts` `login()` | ¿Ventana emergente o página? Selectores de usuario, contraseña y envío. ¿Segundo factor? |
| 2 | **Sesión de juego DGOJ** | `handleGameSession()` | Qué pide (tiempo, importe), si tiene valores por defecto y qué botón la confirma. Ahora solo se detecta e intenta confirmar |
| 3 | **Abrir en Real Play** | `launchRealPlay()` | ¿Hay botón «Jugar» o basta `?gameAction=play`? ¿Puede abrir en demo? |
| 4 | **Formato de los eventos** | `src/game/events.ts` | Sobre exacto del mensaje (campo del nombre, `params`, `sender`) y a qué ventana llega. Con la primera ejecución, `timeline.jsonl` lo enseña |
| 5 | **Apuesta antes de girar** | paso 5 | ¿Llega `betChanged` al cargar? Si no, hace falta el explorador (`betDown`) para fijar la apuesta mínima |
| 6 | **Espacio gira en Pragmatic** | paso 6 | Sin comprobar; alternativa `SPIN_MODE=click` |
| 7 | **Premios grandes** | paso 7 | Si una animación de premio pide clic, `resultShown` puede no llegar |
| 8 | **Refresco de la cartera** | `wallet.ts`, paso 8 | ¿Basta esperar ~30 s o mejor `refreshBalance`? ¿Abrir el desplegable «Saldo» para la captura? |
| 9 | **Verificación visual** | R1 y recortes | Comprobar en pantalla el `#rid`, CRÉDITO y APUESTA (OCR dirigido sobre recortes) |
| 10 | **Resultados del buscador** | `searchGame()` | Cómo se distingue la ficha correcta y si enseña el proveedor |
| 11 | **Escenario 2** | — | Cuenta sin saldo y contrato del rechazo |
