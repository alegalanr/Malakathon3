# Arranque desde cero

Para ejecutar el tester en un ordenador que nunca ha tenido el proyecto. **No se instala nada más que Git y Docker**: Node, los navegadores, el OCR y sus datos van dentro de la imagen oficial de Playwright y de `npm ci`. Solo las ejecuciones contra betsson.es (`-DryRun` / `-Real`) usan además **Edge o Chrome y Node 22 o superior** del ordenador, para el login manual.

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
| `-DryRun` | `--dry-run` | Los dos escenarios contra betsson.es **sin apostar**: sesión, sesión de juego DGOJ, carga, intro y apuesta (hasta F5). Para comprobar que todo está listo |
| `-Real` | `--real` | Ensayo sin apostar y, si sale bien, **escenario 1 real** (una tirada con dinero real; pide confirmación) y **escenario 2 real** con la cuenta sin saldo (no gasta: si hay saldo para la apuesta, no gira) |
| `-Landing` | `--landing` | Deja abierta la **landing / centro de control** en <http://localhost:8095>: el validador en directo contra la maqueta local, con fallos provocados (ver abajo) |

## 4. Landing y centro de control (la demo)

Para enseñar el validador funcionando: **<http://localhost:8095>**. Si ya ejecutaste el script una vez, basta con:

```bash
docker compose -f tester/compose.yaml up -d control
```

1. Pulsa **▶ Lanzar demo en directo**: el validador entra en la maqueta de Betsson, busca Bubble Up, gira como un jugador y verás en directo su navegador, las fases con su tiempo, los eventos, la red, la cartera, los recortes del OCR y cada check pasando a ✅ o ❌.
2. Para demostrar que caza errores, elige un **fallo provocado** (el wallet no abona el premio, moneda equivocada o aviso en inglés) y vuelve a lanzar: falla justo el check que toca.
3. Abajo están el **tiempo por fase** y el **historial** con el informe de cada ejecución.

Va contra la maqueta local (`tester/mock/`) en **modo real**: mismo código que contra betsson.es, sin el modo UI de Playwright. Para pararlo: `docker compose -f tester/compose.yaml stop control mock`.

## 5. Resultado

- Informes: `tester/reports/es-completed-spin/report.html` y `tester/reports/es-insufficient-balance/report.html`. Se abren con doble clic.
- Para verlos servidos (con el informe de Playwright):

  ```bash
  docker compose -f tester/compose.yaml run --rm --service-ports tester npm run report
  ```

  y abre <http://localhost:9323>.

## 6. Ejecución real (solo con las cuentas de prueba de Betsson)

El login contra betsson.es es **siempre manual**: el anti-bot de Group-IB bloquea el login automatizado y los mentores indican que se haga a mano. No hace falta poner credenciales en `tester/.env`.

1. Ejecuta el script con `-Real` / `--real`, o con `-DryRun` / `--dry-run` para ensayar sin apostar.
2. Para cada cuenta de prueba sin sesión guardada, el script abre el navegador con un perfil aparte. **Inicia sesión a mano**: primero con la cuenta **con saldo** y después con la cuenta **sin saldo**. Cuando veas el casino, pulsa Enter en el script, que guarda la sesión en `tester/.auth/` (no se sube). Las siguientes veces la reutiliza. Si caduca, borra el fichero y vuelve a ejecutar. **Nunca una cuenta personal.**
3. El script hace primero un **ensayo sin apostar** de los dos escenarios. Si no llega a F5, se para sin gastar nada.
4. Escenario 1: pide escribir `SI` antes de la tirada con dinero real. Escenario 2: no gasta.
5. **No lances dos ejecuciones reales a la vez** con la misma cuenta (en CI y en local, o en dos ordenadores): los saldos no cuadrarían y se gastaría dinero de más.
6. Antes de compartir nada, **revisa a mano las capturas** de `tester/reports/es-*/evidence/`.

Sin el script, lo mismo a mano: [tester/README.md](tester/README.md). Los comandos contra la web real llevan **siempre** `-e MANUAL_LOGIN=1`. Sin él, el tester intenta el login automatizado: salta el anti-bot y vacía la sesión guardada.

## 7. Problemas habituales

| Mensaje o síntoma | Solución |
|---|---|
| `No está instalado Docker` | Instala Docker Desktop y ábrelo |
| `Docker está instalado pero no arrancado` | Abre Docker Desktop y espera a "Engine running" |
| `Docker Compose ... es antiguo` | Actualiza Docker Desktop |
| `... no se puede cargar porque la ejecución de scripts está deshabilitada` (Windows) | Usa exactamente `powershell -ExecutionPolicy Bypass -File .\arranque.ps1`: no cambia la configuración del sistema |
| `npm ci` falla con `EACCES` (Linux) | El contenedor trabaja como el usuario 1000: `sudo chown -R 1000:1000 tester` |
| `port is already allocated` (8080 o 9323) | Cierra lo que use ese puerto. Solo afecta al modo UI y al informe servido |
| `port is already allocated` (8090, 8091 u 8095) | Lo usa otra cosa o una landing anterior: `docker compose -f tester/compose.yaml stop control mock` y vuelve a lanzar |
| La landing dice «Sin conexión» | El centro de control no está arrancado: `docker compose -f tester/compose.yaml up -d control` |
| La descarga de la imagen se queda parada | Comprueba la conexión, o un proxy o VPN. Vuelve a ejecutar: retoma la descarga |
| Avisos `npm notice New major version of npm` o `npm audit` | Se pueden ignorar. **No ejecutes `npm audit fix --force`**: cambia versiones y puede romper el tester |
| Los tests del OCR tardan la primera vez | Es normal: carga los datos de idioma |
| `Para guardar la sesión del login manual hace falta Node 22` | Instala Node 22 o superior: solo se usa para guardar la sesión del navegador |
| El ensayo dice «sesión no iniciada» en F1 | La sesión ha caducado: borra `tester/.auth/es-<escenario>.json` y vuelve a ejecutar para iniciarla a mano |
| Al iniciar sesión sale «Actualiza la página y vuelve a intentarlo en breve» | Es el anti-bot: inicia sesión en la ventana que abre el script (un navegador normal), no en el del tester |

## Comandos sueltos (lo mismo que hace el script)

```bash
docker compose -f tester/compose.yaml pull
docker compose -f tester/compose.yaml run --rm tester npm ci
docker compose -f tester/compose.yaml run --rm tester npm run typecheck
docker compose -f tester/compose.yaml run --rm tester npm run unit
docker compose -f tester/compose.yaml run --rm -e RUN_MODE=simulated tester npx playwright test --project=es
docker compose -f tester/compose.yaml run --rm -e RUN_MODE=simulated -e SIMULATION=mixed tester npx playwright test --project=es
docker compose -f tester/compose.yaml up -d control   # landing / centro de control → http://localhost:8095
docker compose -f tester/compose.yaml up        # modo UI de Playwright → http://localhost:8080
# contra betsson.es (tras guardar las sesiones con el login manual):
docker compose -f tester/compose.yaml run --rm -e MANUAL_LOGIN=1 -e DRY_RUN=1 tester npx playwright test --project=es   # ensayo sin apostar
docker compose -f tester/compose.yaml run --rm -e MANUAL_LOGIN=1 tester npx playwright test --project=es tests/completed-spin.spec.ts
docker compose -f tester/compose.yaml run --rm -e MANUAL_LOGIN=1 tester npx playwright test --project=es tests/insufficient-balance.spec.ts
```

Más detalle del tester en [tester/README.md](tester/README.md).
