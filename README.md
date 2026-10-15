# Malakathon3: agente de QA para juegos de Betsson

Bot que prueba, como lo haría un jugador, un juego de Pragmatic Play en Real Play en betsson.com y betsson.pe. Lanza un spin y comprueba en pantalla que se completa y que los saldos cuadran; después intenta otro sin saldo y comprueba que se rechaza con el mensaje adecuado. Da **PASS/FAIL** de cada comprobación, con capturas, traza y vídeo como evidencia, y se ejecuta en GitHub Actions. El reto completo está en [docs/reto.md](docs/reto.md).

Proyecto para el reto de Betsson del Malakathon 3.

**¿Primera vez?** Sigue [ARRANQUE.md](ARRANQUE.md): con Git y Docker, un script lo instala y lo prueba todo.

## Pruébalo en 1 minuto: la landing

**<http://localhost:8095>** es la landing de la integración y su centro de control: lanzas una ronda y ves al validador trabajar en directo.

```bash
bash arranque.sh --landing                                          # primera vez (macOS / Linux): instala, prueba y abre la landing
powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Landing    # primera vez (Windows)
docker compose -f tester/compose.yaml up -d control                 # las siguientes veces
```

- **▶ Lanzar demo en directo:** el validador entra en Betsson, busca un juego de Pragmatic Play, gira como un jugador y comprueba cada dato. Ves su navegador, las fases con su tiempo, los eventos, la red, la cartera, los recortes del OCR y cada check pasando a ✅ o ❌.
- **Fallos provocados:** el wallet no abona el premio, moneda equivocada o aviso en inglés. El validador los caza en el check que toca.
- **Juego por nombre y lotes:** escribe cualquier juego de Pragmatic Play o encola varios; se validan uno tras otro.
- **Pestañas:** Demo en directo, Informes (cada informe legible en la página), Métricas (éxito, fallos cazados, tiempo por fase y por juego), Tests (unitarios y simulados desde la página) y Cómo funciona.
- **Destino real:** betsson.es con la cuenta de prueba de `tester/.env`, con confirmación (hoy el anti-bot bloquea el login automático).

La landing usa una maqueta local de Betsson + Pragmatic Play (`tester/mock/`) con el comportamiento verificado en la web real, y el validador corre en **modo real**: el mismo código que contra betsson.es.

## Cómo funciona

El juego es un canvas en un iframe de otro dominio: no hay DOM que inspeccionar. El validador (`tester/`, TypeScript + Playwright en Docker) pulsa como un jugador y cruza cuatro fuentes:

| Fuente | Qué da |
|---|---|
| Eventos del juego (`postMessage` a Betsson) | Empieza y termina la ronda, apuesta, premio y saldo |
| Red del proveedor (`doSpin` / `doCollect`) | Lo que decidió el servidor, con su id de ronda |
| Cartera de Betsson (`/api/v2/wallet/balance`) | Saldo antes y después: después = antes − apuesta + premio |
| Pantalla (OCR dirigido) | El `#rid`, la apuesta mostrada y el aviso, como los ve el jugador |

Recorre las fases F0-F12 (sesión, escucha, juego listo, controles, estado inicial, acción, ronda, testigo visual, cartera final, ensamblado, checks, informe) y deja en `tester/reports/<mercado>-<escenario>/` un `report.html` con esperado, obtenido, fuentes y capturas de cada check. Detalle: [tester/README.md](tester/README.md).

## Ejecutar

Todo en Docker; en el host solo hacen falta Git y Docker. Guía paso a paso: [ARRANQUE.md](ARRANQUE.md).

| Para qué | Comando |
|---|---|
| Instalar y probarlo todo | `bash arranque.sh` (Windows: `.\arranque.ps1`) |
| Landing / centro de control | `docker compose -f tester/compose.yaml up -d control` → <http://localhost:8095> |
| Tests unitarios | `docker compose -f tester/compose.yaml run --rm tester npm run unit` |
| Los dos escenarios en simulado | `docker compose -f tester/compose.yaml run --rm -e RUN_MODE=simulated tester npx playwright test --project=es` |
| Escenario 1 contra betsson.es (cuenta de prueba en `tester/.env`) | `bash arranque.sh --real` |

> El bot en Python de `bot/` es el primer esqueleto, anterior al enunciado oficial; el trabajo actual está en `tester/`.

## Documentación

| Fichero                                    | Contenido                                      |
|--------------------------------------------|------------------------------------------------|
| [ESTADO.md](ESTADO.md)                     | Qué funciona y quién lleva cada parte          |
| [ARRANQUE.md](ARRANQUE.md)                 | Instalar y ejecutar desde cero, landing y problemas habituales |
| [tester/README.md](tester/README.md)       | El validador: fases, decisiones, centro de control, seguridad y pendientes |
| [docs/reto.md](docs/reto.md)               | Enunciado oficial, comprobaciones, evaluación y preguntas para los mentores |
| [docs/web-betsson.md](docs/web-betsson.md) | Lo que sabemos de la web de Betsson            |
| [docs/diseno.md](docs/diseno.md)           | Etapas, módulos, formato de salida, decisiones |
| [docs/arquitectura-esqueleto.md](docs/arquitectura-esqueleto.md) | Cómo está hecho el código y cómo ejecutar cada etapa |
| [pitch/](pitch/)                           | Presentación                                   |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | Cómo trabajamos en el repo                     |
