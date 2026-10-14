# Malakathon3: agente de QA para juegos nuevos de Betsson

Bot que entra en la web de Betsson, detecta un juego nuevo en el lobby, lo abre, juega una ronda y da un veredicto **PASS/FAIL** con su motivo y capturas como evidencia, sin intervención humana.

Proyecto para el reto de Betsson del Malakathon 3.

## Cómo funciona

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
| [docs/reto.md](docs/reto.md)               | Enunciado y preguntas para la organización     |
| [docs/web-betsson.md](docs/web-betsson.md) | Lo que sabemos de la web de Betsson            |
| [docs/diseno.md](docs/diseno.md)           | Etapas, módulos, formato de salida, decisiones |
| [docs/arquitectura-esqueleto.md](docs/arquitectura-esqueleto.md) | Cómo está hecho el código y cómo ejecutar cada etapa |
| [pitch/](pitch/)                           | Presentación                                   |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | Cómo trabajamos en el repo                     |
