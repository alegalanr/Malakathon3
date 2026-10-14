# La web de Betsson

Todo lo que sabemos de la web. Junto a cada dato, pon cómo lo sabes (una captura, una URL o una petición de red) y la fecha, porque la web puede cambiar. Lo que no hayas comprobado, márcalo con `(sin comprobar)`.

## Acceso

- URL:
- ¿Hace falta login para ver el lobby? ¿Y para jugar en demo?
- Banner de cookies (cómo se cierra):
- Anti-bot (Cloudflare, CAPTCHA…). ¿Salta con el navegador en headless?

## Lobby

- URL del casino:
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
