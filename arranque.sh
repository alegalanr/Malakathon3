#!/usr/bin/env bash
# Arranque del tester en macOS o Linux: comprueba Docker, instala dependencias y ejecuta las pruebas.
# No instala nada en el ordenador: todo corre dentro de la imagen oficial de Playwright.
#
# Uso, desde la raíz del repo:
#   bash arranque.sh            # instalar + tests + modo simulado
#   bash arranque.sh --mixed    # además, la demo con fallos provocados
#   bash arranque.sh --real     # además, el escenario 1 contra betsson.es (dinero real)
#   bash arranque.sh --landing  # además, deja abierta la landing / centro de control en http://localhost:8095
set -euo pipefail
cd "$(dirname "$0")"

MIXED=0
REAL=0
LANDING=0
for a in "$@"; do
  case "$a" in
    --mixed) MIXED=1 ;;
    --real) REAL=1 ;;
    --landing) LANDING=1 ;;
    *) echo "Opción desconocida: $a (usa --mixed, --real o --landing)"; exit 2 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$1"; exit 1; }
tester() { docker compose -f tester/compose.yaml run --rm "$@"; }

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

step 'Fichero de credenciales'
if [ ! -f tester/.env ]; then
  cp tester/.env.example tester/.env
  echo 'Creado tester/.env vacío. Solo hace falta rellenarlo para las ejecuciones reales (--real).'
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

if [ "$REAL" = 1 ]; then
  step 'Escenario 1 real contra betsson.es'
  grep -Eq '^BETSSON_ES_USER=\S+' tester/.env && grep -Eq '^BETSSON_ES_PASS=\S+' tester/.env \
    || fail 'Rellena BETSSON_ES_USER y BETSSON_ES_PASS en tester/.env con la cuenta de prueba de Betsson.'
  echo 'ATENCIÓN: hace una tirada con DINERO REAL de la cuenta de prueba (apuesta máxima: MAX_BET, 5 € por defecto).'
  echo 'No lo lances si hay otra ejecución real en marcha (en CI o en otro ordenador) con la misma cuenta.'
  read -r -p 'Escribe SI para continuar: ' ok
  [ "$ok" = "SI" ] || fail 'Cancelado.'
  tester tester npx playwright test tests/completed-spin.spec.ts --project=es || true
  echo 'Revisa a mano las capturas de tester/reports/es-completed-spin/evidence/ antes de compartir nada.'
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
