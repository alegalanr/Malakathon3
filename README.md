# Malakathon3: agente de QA para juegos de Betsson

Bot que prueba, como lo haría un jugador, un juego de Pragmatic Play en Real Play en betsson.com y betsson.pe. Lanza un spin y comprueba en pantalla que se completa y que los saldos cuadran; después intenta otro sin saldo y comprueba que se rechaza con el mensaje adecuado. Da **PASS/FAIL** de cada comprobación, con capturas, traza y vídeo como evidencia, y se ejecuta en GitHub Actions. El reto completo está en [docs/reto.md](docs/reto.md).

Proyecto para el reto de Betsson del Malakathon 3.

## Cómo funciona

> Describe el esqueleto actual, que es anterior al enunciado oficial. Lo que cambia está en [docs/reto.md](docs/reto.md#impacto-en-lo-que-ya-tenemos).

1. **Entrar:** abre la web y cierra el banner de cookies.
2. **Detectar juego nuevo:** a partir de la señal del lobby (etiqueta "New" o categoría de novedades).
3. **Abrir el juego:** espera a que el canvas esté listo.
4. **Jugar una ronda:** lanza un spin en modo demo.
5. **Veredicto:** comprueba en el tráfico de red que el juego carga, que la jugada llega al servidor y que la ronda se resuelve.

Cada ejecución deja en `runs/<run_id>/` un `run.json` con el resultado, las capturas y una traza de Playwright. Detalle en [docs/diseno.md](docs/diseno.md).

## Estado

[ESTADO.md](ESTADO.md)

## Ejecutar

Con Docker Desktop abierto, desde la carpeta del repo:

```bash
docker compose build
docker compose run --rm bot --check                     # comprueba el entorno
docker compose run --rm bot                             # flujo completo contra el casino simulado
docker compose run --rm bot --block "**/provider.html"  # FAIL provocado: el juego no carga
docker compose run --rm bot --url https://...           # contra otra web
```

El resultado queda en `runs/<run_id>/` (`run.json`, capturas, traza y `report.html`). Más opciones y cómo ejecutar cada etapa por separado: [docs/arquitectura-esqueleto.md](docs/arquitectura-esqueleto.md).

## Documentación

| Fichero                                    | Contenido                                      |
|--------------------------------------------|------------------------------------------------|
| [ESTADO.md](ESTADO.md)                     | Qué funciona y quién lleva cada parte          |
| [docs/reto.md](docs/reto.md)               | Enunciado oficial, comprobaciones, evaluación y preguntas para los mentores |
| [docs/web-betsson.md](docs/web-betsson.md) | Lo que sabemos de la web de Betsson            |
| [docs/diseno.md](docs/diseno.md)           | Etapas, módulos, formato de salida, decisiones |
| [docs/arquitectura-esqueleto.md](docs/arquitectura-esqueleto.md) | Cómo está hecho el código y cómo ejecutar cada etapa |
| [pitch/](pitch/)                           | Presentación                                   |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | Cómo trabajamos en el repo                     |
