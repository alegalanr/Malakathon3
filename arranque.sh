#!/usr/bin/env bash
# Arranque del tester en macOS o Linux: comprueba Docker, instala dependencias y ejecuta las pruebas.
# No instala nada en el ordenador: todo corre dentro de la imagen oficial de Playwright.
# (El login manual de las ejecuciones reales usa además el navegador del ordenador y Node >= 22.)
#
# Uso, desde la raíz del repo:
#   bash arranque.sh            # instalar + tests + modo simulado
#   bash arranque.sh --mixed    # además, la demo con fallos provocados
#   bash arranque.sh --dry-run  # además, los dos escenarios contra betsson.es SIN apostar
#   bash arranque.sh --real     # además, escenarios 1 y 2 contra betsson.es (el 1 gasta dinero real)
#   bash arranque.sh --landing  # además, deja abierta la landing / centro de control en http://localhost:8095
#
# Contra betsson.es el login es SIEMPRE manual (el anti-bot bloquea el automatizado; lo indican los mentores):
# el script abre el navegador, inicias sesión a mano con cada cuenta de prueba y guarda la sesión en
# tester/.auth/ (no se sube). Si ya hay una sesión guardada, la reutiliza.
set -euo pipefail
cd "$(dirname "$0")"

MIXED=0
DRY=0
REAL=0
LANDING=0
for a in "$@"; do
  case "$a" in
    --mixed) MIXED=1 ;;
    --dry-run) DRY=1 ;;
    --real) REAL=1 ;;
    --landing) LANDING=1 ;;
    *) echo "Opción desconocida: $a (usa --mixed, --dry-run, --real o --landing)"; exit 2 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$1"; exit 1; }
tester() { docker compose -f tester/compose.yaml run --rm "$@"; }

# --- Ejecuciones contra betsson.es ------------------------------------------------------------
# Escenario → cuenta, puerto de depuración y perfil del navegador (uno por cuenta: no se mezclan las sesiones)
label_of() { [ "$1" = completed-spin ] && echo 'la cuenta de prueba CON saldo' || echo 'la cuenta de prueba SIN saldo'; }
port_of() { [ "$1" = completed-spin ] && echo 9222 || echo 9223; }

has_session() {
  local f="tester/.auth/es-$1.json"
  [ -f "$f" ] && node -e "process.exit(JSON.parse(require('fs').readFileSync('$f','utf8')).cookies?.length>0?0:1)" 2>/dev/null
}

find_browser() {
  for b in "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$b" ] || command -v "$b" >/dev/null 2>&1; then echo "$b"; return; fi
  done
}

# Login manual: abre el navegador (perfil aparte, sin automatizar), la persona inicia sesión y se guarda la sesión.
confirm_session() {
  local s="$1" label port browser
  label="$(label_of "$s")"; port="$(port_of "$s")"
  command -v node >/dev/null 2>&1 || fail 'Para el login manual hace falta Node 22 o superior en este ordenador (https://nodejs.org).'
  if has_session "$s"; then
    echo "Sesión guardada para $label (tester/.auth/es-$s.json). Si ha caducado, borra ese fichero y vuelve a ejecutar."
    return
  fi
  browser="$(find_browser)"
  [ -n "$browser" ] || fail 'No se encuentra Edge, Chrome ni Chromium para el login manual.'
  printf '\033[33mSe abre el navegador: inicia sesión A MANO con %s y espera a ver el casino.\nNo cierres esa ventana hasta que el script lo diga.\033[0m\n' "$label"
  "$browser" --remote-debugging-port="$port" --user-data-dir="${TMPDIR:-/tmp}/betsson-tester-$s" --no-first-run \
    'https://www.betsson.es/inicio?returnUrl=%2Fcasino' >/dev/null 2>&1 &
  read -r -p 'Pulsa Enter cuando hayas iniciado sesión ' _
  CDP_PORT="$port" node tester/scripts/save-session.mjs es "$s" || true
  has_session "$s" || fail "No se pudo guardar la sesión de $label. ¿Iniciaste sesión en esa ventana?"
  echo 'Sesión guardada. Ya puedes cerrar esa ventana del navegador.'
}

# Escenario contra la web real, SIEMPRE con MANUAL_LOGIN=1 (sin él, el tester intentaría el login
# automatizado: saltaría el anti-bot y vaciaría la sesión guardada)
real_scenario() {
  local s="$1"; shift
  tester -e MANUAL_LOGIN=1 "$@" tester npx playwright test --project=es "tests/$s.spec.ts" --reporter=line || true
}

# En el ensayo (DRY_RUN) los checks salen FAIL a propósito; lo que importa es que lleguen F1-F5
dry_reached() {
  node -e "
    const r = JSON.parse(require('fs').readFileSync('tester/reports/es-$1/report.json', 'utf8'));
    const bad = r.phases.filter((p) => p.status === 'failed' && ['F1','F2','F3','F4','F5'].includes(p.phase));
    for (const p of bad) console.log('  ' + p.phase + ' falló: ' + p.reason);
    process.exit(bad.length ? 1 : 0);" 2>/dev/null
}

session_expired() {
  local f="tester/reports/es-$1/report.json"
  [ -f "$f" ] && tr -d '\n\r' < "$f" | grep -Eq '"phase": *"F1"[^}]*"status": *"failed"[^}]*no iniciada'
}

show_checks() {
  node -e "
    const r = JSON.parse(require('fs').readFileSync('tester/reports/es-$1/report.json', 'utf8'));
    const pass = r.checks.filter((c) => c.result === 'PASS').length;
    console.log('  $1: ' + pass + ' de ' + r.checks.length + ' checks PASS · informe: tester/reports/es-$1/report.html');" 2>/dev/null || true
}

# ---------------------------------------------------------------------------------------------
step 'Comprobando Docker'
command -v docker >/dev/null 2>&1 || fail 'No está instalado Docker. Instala Docker Desktop (o Docker Engine con el plugin compose) y vuelve a ejecutar.'
docker info >/dev/null 2>&1 || fail 'Docker está instalado pero no arrancado (o tu usuario no tiene permiso). Arráncalo y vuelve a ejecutar.'
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || true)"
[ -n "$COMPOSE_VERSION" ] || fail 'Falta Docker Compose v2 (docker compose).'
MIN='2.24'
if [ "$(printf '%s\n%s\n' "$MIN" "${COMPOSE_VERSION#v}" | sort -V | head -1)" != "$MIN" ]; then
  fail "Docker Compose $COMPOSE_VERSION es antiguo: hace falta $MIN o superior."
fi
echo "Docker Compose $COMPOSE_VERSION"
[ -f tester/compose.yaml ] || fail 'Ejecuta el script desde la raíz del repo (donde están ESTADO.md y la carpeta tester).'

# El contenedor trabaja como el usuario 1000: en Linux, si tu usuario es otro, no podrá escribir en tester/
if [ "$(uname)" = "Linux" ] && [ "$(id -u)" != "1000" ]; then
  echo "Aviso: tu usuario es $(id -u) y el contenedor usa el 1000. Si npm ci falla por permisos, ejecuta: sudo chown -R 1000:1000 tester"
fi

step 'Fichero de configuración'
if [ ! -f tester/.env ]; then
  cp tester/.env.example tester/.env
  echo 'Creado tester/.env a partir del ejemplo. Con el login manual no hace falta poner credenciales.'
else
  echo 'tester/.env ya existe (no se toca).'
fi

step 'Descargando la imagen de Playwright (la primera vez tarda varios minutos)'
docker compose -f tester/compose.yaml pull || fail 'No se pudo descargar la imagen. Comprueba la conexión a internet.'

step 'Instalando dependencias (npm ci, versiones exactas del package-lock)'
tester tester npm ci || fail 'Falló npm ci'

step 'Comprobando que compila'
tester tester npm run typecheck || fail 'No compila'

step 'Tests unitarios (sin navegador ni credenciales)'
tester tester npm run unit || fail 'Fallan los tests unitarios'

step 'Modo simulado: los dos escenarios con datos falsos y OCR real (todo debe salir PASS)'
tester -e RUN_MODE=simulated tester npx playwright test --project=es || fail 'Falla el modo simulado'

if [ "$MIXED" = 1 ]; then
  step 'Demo con fallos provocados (DEBE fallar, solo en S1-RID-VISIBLE y S2-MSG-LANG-VISIBLE)'
  if tester -e RUN_MODE=simulated -e SIMULATION=mixed tester npx playwright test --project=es; then
    fail 'La demo con fallos provocados no ha fallado: el tester no detecta los errores.'
  fi
  echo 'Ha fallado como se esperaba: el tester detecta los errores provocados.'
fi

if [ "$DRY" = 1 ] || [ "$REAL" = 1 ]; then
  step 'Sesiones de las cuentas de prueba (login manual)'
  confirm_session completed-spin
  confirm_session insufficient-balance

  step 'Ensayo contra betsson.es SIN apostar (sesión, sesión de juego, carga, intro y apuesta: hasta F5)'
  DRY_OK=1
  for s in completed-spin insufficient-balance; do
    real_scenario "$s" -e DRY_RUN=1
    # Betsson cierra la sesión pasado un tiempo: si ha caducado, se repite el login manual y se ensaya otra vez
    if ! dry_reached "$s" && session_expired "$s"; then
      echo "  La sesión de $(label_of "$s") ha caducado."
      read -r -p '  ¿Iniciar sesión otra vez ahora? (S/n) ' again
      if [[ ! "$again" =~ ^[nN] ]]; then
        rm -f "tester/.auth/es-$s.json"
        ensure_session "$s"
        real_scenario "$s" -e DRY_RUN=1
      fi
    fi
    if dry_reached "$s"; then echo "  $s: ensayo OK, listo para girar"
    else DRY_OK=0; echo "  $s: el ensayo no llega a F5"; fi
  done
  if [ "$REAL" = 1 ] && [ "$DRY_OK" = 0 ]; then fail 'El ensayo ha fallado: no se lanza nada con dinero real.'; fi
fi

if [ "$REAL" = 1 ]; then
  step 'Escenario 1 real: una tirada completada'
  echo 'ATENCIÓN: hace una tirada con DINERO REAL de la cuenta de prueba (apuesta máxima: MAX_BET, 5 € por defecto).'
  echo 'No lo lances si hay otra ejecución real en marcha (en CI o en otro ordenador) con la misma cuenta.'
  read -r -p 'Escribe SI para continuar: ' ok
  [ "$ok" = "SI" ] || fail 'Cancelado.'
  real_scenario completed-spin

  step 'Escenario 2 real: tirada rechazada por saldo insuficiente (no gasta: si la cuenta tiene saldo para la apuesta, no gira)'
  real_scenario insufficient-balance

  step 'Resultado'
  show_checks completed-spin
  show_checks insufficient-balance
  echo 'Revisa a mano las capturas de tester/reports/es-*/evidence/ antes de compartir nada.'
fi

if [ "$LANDING" = 1 ]; then
  step 'Centro de control (landing): validación en directo contra la maqueta local'
  docker compose -f tester/compose.yaml up -d control || fail 'No se pudo arrancar el centro de control (¿puertos 8090, 8091 u 8095 ocupados?)'
  for _ in $(seq 1 30); do
    if command -v curl >/dev/null 2>&1; then curl -fs -o /dev/null http://localhost:8095/ && break; else sleep 3; break; fi
    sleep 1
  done
  echo 'Abierto en http://localhost:8095  (para pararlo: docker compose -f tester/compose.yaml stop control mock)'
  if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8095 >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open http://localhost:8095 || true; fi
fi

printf '\n\033[32m✔ Listo.\033[0m\n'
echo 'Informes: tester/reports/es-completed-spin/report.html y tester/reports/es-insufficient-balance/report.html'
echo 'Para verlos en el navegador: docker compose -f tester/compose.yaml run --rm --service-ports tester npm run report  →  http://localhost:9323'
