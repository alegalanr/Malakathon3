# Arranque desde cero

Para ejecutar el tester en un ordenador que nunca ha tenido el proyecto. **No se instala nada más que Git y Docker**: Node, los navegadores, el OCR y sus datos van dentro de la imagen oficial de Playwright y de `npm ci`.

## 1. Requisitos

| Qué | Cómo comprobarlo |
|---|---|
| **Git** | `git --version` |
| **Docker Desktop** (Windows o macOS) o Docker Engine con el plugin compose (Linux), **abierto** | `docker info` no da error |
| **Docker Compose 2.24 o superior** (viene con Docker Desktop actualizado) | `docker compose version` |
| Unos **5 GB libres** y conexión a internet (la imagen de Playwright pesa ~2 GB) | — |

En Windows, Docker Desktop tiene que usar WSL 2 (lo propone al instalarlo).

## 2. Clonar

```bash
git clone https://github.com/alegalanr/Malakathon3.git
cd Malakathon3
```

## 3. Ejecutar el script de arranque

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File .\arranque.ps1
```

**macOS o Linux:**

```bash
bash arranque.sh
```

El script, en orden:

1. Comprueba que Docker está instalado, arrancado y con Compose 2.24 o superior.
2. Crea `tester/.env` vacío a partir de `tester/.env.example`, si no existe (no se sube al repo).
3. Descarga la imagen de Playwright. **La primera vez tarda varios minutos.**
4. Instala las dependencias con `npm ci`, con las versiones exactas de `package-lock.json`. Deja también los datos del OCR en `tester/.cache/tessdata`.
5. Comprueba que el código compila.
6. Pasa los **tests unitarios**: sin navegador ni credenciales.
7. Ejecuta los dos escenarios en **modo simulado**: datos falsos, navegador y OCR reales. Todo debe salir PASS.

Si un paso falla, el script se para y dice cuál y por qué.

Opciones:

| Windows | macOS / Linux | Qué añade |
|---|---|---|
| `-Mixed` | `--mixed` | Demo con fallos provocados: **debe fallar**, solo en `S1-RID-VISIBLE` y `S2-MSG-LANG-VISIBLE`. El script comprueba que falla |
| `-Real` | `--real` | Escenario 1 contra betsson.es con la cuenta de prueba. **Mueve dinero real** de la cuenta de prueba y pide confirmación |

## 4. Resultado

- Informes: `tester/reports/es-completed-spin/report.html` y `tester/reports/es-insufficient-balance/report.html`. Se abren con doble clic.
- Para verlos servidos (con el informe de Playwright):

  ```bash
  docker compose -f tester/compose.yaml run --rm --service-ports tester npm run report
  ```

  y abre <http://localhost:9323>.

## 5. Ejecución real (solo con las cuentas de prueba de Betsson)

1. Rellena `tester/.env` con las cuentas de prueba (`BETSSON_ES_USER`, `BETSSON_ES_PASS` y, para el escenario 2, `BETSSON_ES_EMPTY_USER`, `BETSSON_ES_EMPTY_PASS`). **Nunca una cuenta personal.**
2. Ejecuta el script con `-Real` / `--real`.
3. **No lances dos ejecuciones reales a la vez** con la misma cuenta (en CI y en local, o en dos ordenadores): los saldos no cuadrarían y se gastaría dinero de más.
4. Antes de compartir nada, **revisa a mano las capturas** de `tester/reports/es-*/evidence/`. Hay máscaras y una revisión automática, pero los selectores de la web no se han podido comprobar todavía con sesión.

## 6. Problemas habituales

| Mensaje o síntoma | Solución |
|---|---|
| `No está instalado Docker` | Instala Docker Desktop y ábrelo |
| `Docker está instalado pero no arrancado` | Abre Docker Desktop y espera a "Engine running" |
| `Docker Compose ... es antiguo` | Actualiza Docker Desktop |
| `... no se puede cargar porque la ejecución de scripts está deshabilitada` (Windows) | Usa exactamente `powershell -ExecutionPolicy Bypass -File .\arranque.ps1`: no cambia la configuración del sistema |
| `npm ci` falla con `EACCES` (Linux) | El contenedor trabaja como el usuario 1000: `sudo chown -R 1000:1000 tester` |
| `port is already allocated` (8080 o 9323) | Cierra lo que use ese puerto. Solo afecta al modo UI y al informe servido |
| La descarga de la imagen se queda parada | Comprueba la conexión, o un proxy o VPN. Vuelve a ejecutar: retoma la descarga |
| Avisos `npm notice New major version of npm` o `npm audit` | Se pueden ignorar. **No ejecutes `npm audit fix --force`**: cambia versiones y puede romper el tester |
| Los tests del OCR tardan la primera vez | Es normal: carga los datos de idioma |

## Comandos sueltos (lo mismo que hace el script)

```bash
docker compose -f tester/compose.yaml pull
docker compose -f tester/compose.yaml run --rm tester npm ci
docker compose -f tester/compose.yaml run --rm tester npm run typecheck
docker compose -f tester/compose.yaml run --rm tester npm run unit
docker compose -f tester/compose.yaml run --rm -e RUN_MODE=simulated tester npx playwright test --project=es
docker compose -f tester/compose.yaml run --rm -e RUN_MODE=simulated -e SIMULATION=mixed tester npx playwright test --project=es
docker compose -f tester/compose.yaml up        # modo UI de Playwright → http://localhost:8080
```

Más detalle del tester en [tester/README.md](tester/README.md).
