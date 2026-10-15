# La web de Betsson

Todo lo que sabemos de la web. Junto a cada dato, pon cómo lo sabes (una captura, una URL o una petición de red) y la fecha, porque la web puede cambiar. Lo que no hayas comprobado, márcalo con `(sin comprobar)`.

## Acceso

- URL: https://www.betsson.es (la testbed; desde España betsson.com redirige aquí). Casino en `/casino`. (15/10, navegador)
- Login: página propia `/inicio?returnUrl=%2Fcasino`, ventana «Iniciar sesión» con «Usuario/email», «Contraseña», «Recordar» y botón «Iniciar sesión»; también «Iniciar sesión con Clave de acceso». El tester rellena los campos correctamente. (15/10, `tester/.auth/login-fallido-completed-spin.png`, no se sube)
- Para jugar en Real Play hace falta sesión.
- Banner de cookies (OneTrust): «Configuración de cookies» (`#onetrust-pc-btn-handler`) → «Rechazarlas todas» (`.ot-pc-refuse-all-handler`). (15/10, prueba `lobby` en verde)
- **Anti-bot: salta con el Chromium automatizado (headless, Docker) al enviar el login.** Mensaje: «Actualiza la página y vuelve a intentarlo en breve. La resolución puede demorar hasta 10 minutos.» Con el navegador normal no salta (lo vio el equipo). La página carga `eu.id.group-ib.com/id.html` (detección de fraude de Group-IB). No se intenta saltar: hay que pedir a los mentores una vía autorizada (lista blanca de IP, cabecera o cuenta marcada para el hackathon). (15/10, captura anterior)

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
- ¿Expone algo fuera del canvas (DOM, `window`, mensajes)?
- Dónde está el botón de jugar:
- Cómo se ve que una ronda ha terminado:
- Errores que hemos visto:

## Juegos probados

| Juego | Proveedor | ¿Demo sin login? | ¿Carga? | Notas |
|-------|-----------|------------------|---------|-------|
|       |           |                  |         |       |
