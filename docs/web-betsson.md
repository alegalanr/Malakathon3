# La web de Betsson

Todo lo que sabemos de la web. Junto a cada dato, pon cómo lo sabes (una captura, una URL o una petición de red) y la fecha, porque la web puede cambiar. Lo que no hayas comprobado, márcalo con `(sin comprobar)`.

## Acceso

- URL: https://www.betsson.es (la testbed; desde España betsson.com redirige aquí). Casino en `/casino`. (15/10, navegador)
- Login: página propia `/inicio?returnUrl=%2Fcasino`, ventana «Iniciar sesión» con «Usuario/email», «Contraseña», «Recordar» y botón «Iniciar sesión»; también «Iniciar sesión con Clave de acceso». El tester rellena los campos correctamente. (15/10, `tester/.auth/login-fallido-completed-spin.png`, no se sube)
- Para jugar en Real Play hace falta sesión.
- Cartera de Betsson: la web pide `/api/v2/wallet/balance` y responde `{"balance":{"totalAmount":59.5,"withdrawableAmount":59.5,"currencyCode":"EUR","lockedAmount":0.0,"bonusAmount":0.0},…}`. El importe va **en euros** (el tester lo pasa a céntimos) y la moneda **como código**. Con el juego abierto, los 59,50 € de la cartera coinciden con los `5950` céntimos de `updateBalance`. (15/10, pestaña Network)
- Banner de cookies (OneTrust): «Configuración de cookies» (`#onetrust-pc-btn-handler`) → «Rechazarlas todas» (`.ot-pc-refuse-all-handler`). (15/10, prueba `lobby` en verde)
- **Anti-bot: salta con el Chromium automatizado (headless, Docker) al enviar el login.** Mensaje: «Actualiza la página y vuelve a intentarlo en breve. La resolución puede demorar hasta 10 minutos.» Con el navegador normal no salta (lo vio el equipo). La página carga `eu.id.group-ib.com/id.html` (detección de fraude de Group-IB). No se intenta saltar: hay que pedir a los mentores una vía autorizada (lista blanca de IP, cabecera o cuenta marcada para el hackathon). (15/10, captura anterior)
  - **Vía autorizada por los mentores (15/10): login manual.** Una persona inicia sesión a mano en un navegador normal y el tester reutiliza la sesión (`tester/scripts/save-session.mjs` + `MANUAL_LOGIN=1`). El bot no envía el formulario de login.

## Lobby

- URL del casino: https://www.betsson.es/casino. Web components con shadow DOM (`gaming-*`, `fds-*`); los localizadores de Playwright lo atraviesan. (15/10)
- Buscador: `gaming-discovery-search-button` abre el campo «Búsqueda de juegos y proveedores»; escribiendo «Bubble Up» aparece un enlace a `/casino/tragaperras-slots/bubble-up`. Cada juego tiene ruta propia `/casino/<categoría>/<juego>`; el id de Pragmatic Play en la web es `pragmatic-play`. (15/10, prueba `lobby` en verde)
- ¿Cómo llegan los juegos a la página: vienen en el HTML o los carga una API? Si es una API, apunta la URL: es la forma más fiable de detectar juegos nuevos.
- ¿Cómo se sabe que un juego es nuevo (etiqueta "New", categoría, orden)?
- ¿Cómo se localiza cada juego en la página (atributos estables)?
- ¿Cargan todos de golpe o al hacer scroll?

## Abrir un juego

- Qué pasa al hacer clic: ventana emergente, página nueva o iframe.
- Proveedor y dominio del iframe:
- ¿Hay botón de "Demo" o "Jugar gratis"?
- Cuánto tarda en cargar:

## Dentro del juego

- ¿Con qué está hecho (canvas, WebGL…)? Se ve en DevTools.
- ¿Expone algo fuera del canvas (DOM, `window`, mensajes)? **Sí: `postMessage` a la página de Betsson.** Con Bubble Up, cuenta con saldo y sin girar (15/10, consola del navegador):
  - El juego se sirve desde `https://cajdsoitek.jmxyelekig.net` (dominio de Pragmatic Play) y se identifica con `"sender":"vs20bblup_cv116"` y `"lang":"ES"`.
  - El nombre del evento llega en `"name"` (`gameLoadingEnded`) o en `"event"` (`loadingProgress`, `soundOn`). Algún mensaje trae los dos: `{"name":"post_updateBalance","event":"updateBalance",…}`.
  - Al cargar llega `updateBalance` con el saldo **en céntimos** y la moneda como **símbolo**: `"params":{"total":{"currency":"€","amount":5950}}`. La cartera de Betsson usa el código (`EUR`), así que el tester convierte `€` → `EUR` antes de comparar.
  - La petición `gameService` de la carga del juego responde 200. Sin girar no hay `doSpin`.
  - El anti-bot (`https://eu.id.group-ib.com`, `"action":"gcfids"`) también manda `postMessage` cada pocos segundos; el tester lo ignora porque no es del juego.
- Dónde está el botón de jugar:
- Cómo se ve que una ronda ha terminado:
- Errores que hemos visto:

## Juegos probados

| Juego | Proveedor | ¿Demo sin login? | ¿Carga? | Notas |
|-------|-----------|------------------|---------|-------|
|       |           |                  |         |       |
- **Sesión de juego obligatoria (DGOJ).** Con la sesión de Betsson iniciada, al abrir un juego en Real Play (`?gameAction=play`) el recuadro muestra «El juego no se inicia · Se requiere una sesión de juego activa para jugar» con «Iniciar una nueva sesión». Unos 5 s después sale encima la ventana «Atención» («Hace menos de 60 mins. que finalizaste tu sesión de juego…») con «Iniciar sesión» y «Volver a Casino». Después sale el formulario «Se ha sobrepasado el límite de tiempo de sesión»: «Tiempo de juego» con botones (15 Min, 30 Min, 1 Hora, 2 Horas, 3 Horas, 5 Horas; obligatorio), «Límite de pérdidas» en EUR con campo y botones 25/50/75/100 % del saldo, y «Iniciar sesión». En «Más opciones» está el «Tiempo de exclusión (opcional)», que autoexcluye la cuenta y no se puede deshacer: el tester no lo toca nunca. El banner de cookies vuelve a salir en la página del juego y tapa la parte de abajo del juego. (15/10, traza del tester y captura del equipo)
- **Juego (Bubble Up, Pragmatic) en Real Play.** Va en un iframe dentro de otro iframe. Tarda de 40 s a más de 100 s en cargar en Docker (`loadingProgress` hasta `gameLoadingEnded`). Al cargar sale una intro en carrusel («VOLATILIDAD ALTA», casilla «NO VOLVER A MOSTRAR» y botón redondo de continuar encima de la volatilidad) que tapa la barra inferior; un clic en el centro solo cambia de diapositiva. No hay `betChanged` al cargar: la apuesta inicial viene en la respuesta de `doInit` (`c=0.20`, `l=20` → 4,00 €; mínimo 0,20 €, `sc` = monedas posibles). `updateBalance` trae la moneda como «€». (15/10, traza del tester)
- **Carga del juego en el tester (15/10).** Con sesión, la página del juego ya lo lanza en Real Play (`/api/v1/Gamelauncher/?…&forReal=true`), así que no hace falta `?gameAction=play`, que además recargaba y reiniciaba la carga. Lo lento eran tres cosas: descargar ~30 MB con el navegador vacío, grabar la traza durante la carga y la doble carga. Con caché en disco, la traza desde READY y sin recarga, el juego está listo en ~21 s (antes 75-133 s).
- **Rechazo por saldo insuficiente (escenario 2, 15/10).** Con saldo 0,30 € y apuesta 3,20 €, al pulsar Espacio Bubble Up manda `autoplayEnded` y `balanceTooLow` (con `betAmount`, `balanceBefore` y `balanceAfter`) a los ~850 ms, no llama a `gameService` (ni `doSpin` ni error de red) y a los ~2,8 s muestra la ventana «MENSAJE · Fondos insuficientes para realizar esta apuesta. Haga un depósito en su cuenta o reduzca el nivel de la apuesta.» con «ACEPTAR». La cartera no cambia. (15/10, `tester/reports/es-insufficient-balance/rejection-contract.json`)
