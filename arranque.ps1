<#
  Arranque del tester en Windows: comprueba Docker, instala dependencias y ejecuta las pruebas.
  No instala nada en el ordenador: todo corre dentro de la imagen oficial de Playwright.

  Uso, desde la raíz del repo:
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1            # instalar + tests + modo simulado
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Mixed     # además, la demo con fallos provocados
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Real      # además, el escenario 1 contra betsson.es (dinero real)
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Landing   # además, deja abierta la landing / centro de control en http://localhost:8095
#>
param(
  [switch]$Mixed,
  [switch]$Real,
  [switch]$Landing
)

# 'Continue': en Windows PowerShell 5.1, con 'Stop' cualquier aviso de docker por stderr cortaría el script.
# Los errores se comprueban a mano con $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Compose = @('compose', '-f', 'tester/compose.yaml')

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Stop-WithError($msg) { Write-Host "`n✘ $msg" -ForegroundColor Red; exit 1 }

function Invoke-Tester {
  param([string[]]$TesterArgs, [string[]]$EnvVars = @(), [switch]$AllowFail)
  $envArgs = @()
  foreach ($e in $EnvVars) { $envArgs += @('-e', $e) }
  # La salida de docker va a la pantalla, no al valor que devuelve la función
  & docker @Compose run --rm @envArgs tester @TesterArgs | Out-Host
  if ($LASTEXITCODE -ne 0 -and -not $AllowFail) { Stop-WithError "Falló: $($TesterArgs -join ' ')" }
  return $LASTEXITCODE
}

# ---------------------------------------------------------------------------------------------
Write-Step 'Comprobando Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-WithError 'No está instalado Docker. Instala Docker Desktop (https://www.docker.com/products/docker-desktop/), ábrelo y vuelve a ejecutar este script.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker está instalado pero no arrancado. Abre Docker Desktop, espera a que diga "Engine running" y vuelve a ejecutar.' }
$composeVersion = (docker compose version --short 2>$null)
if (-not $composeVersion) { Stop-WithError 'Falta Docker Compose v2. Actualiza Docker Desktop.' }
$v = [version]($composeVersion.TrimStart('v') -replace '[^0-9.].*$', '')
if ($v -lt [version]'2.24') { Stop-WithError "Docker Compose $composeVersion es antiguo: hace falta 2.24 o superior. Actualiza Docker Desktop." }
Write-Host "Docker Compose $composeVersion"

if (-not (Test-Path 'tester/compose.yaml')) { Stop-WithError 'Ejecuta el script desde la raíz del repo (donde están ESTADO.md y la carpeta tester).' }

Write-Step 'Fichero de credenciales'
if (-not (Test-Path 'tester/.env')) {
  Copy-Item 'tester/.env.example' 'tester/.env'
  Write-Host 'Creado tester/.env vacío. Solo hace falta rellenarlo para las ejecuciones reales (-Real).'
} else {
  Write-Host 'tester/.env ya existe (no se toca).'
}

Write-Step 'Descargando la imagen de Playwright (la primera vez tarda varios minutos)'
& docker @Compose pull | Out-Host
if ($LASTEXITCODE -ne 0) { Stop-WithError 'No se pudo descargar la imagen. Comprueba la conexión a internet.' }

Write-Step 'Instalando dependencias (npm ci, versiones exactas del package-lock)'
Invoke-Tester -TesterArgs @('npm', 'ci') | Out-Null

Write-Step 'Comprobando que compila'
Invoke-Tester -TesterArgs @('npm', 'run', 'typecheck') | Out-Null

Write-Step 'Tests unitarios (sin navegador ni credenciales)'
Invoke-Tester -TesterArgs @('npm', 'run', 'unit') | Out-Null

Write-Step 'Modo simulado: los dos escenarios con datos falsos y OCR real (todo debe salir PASS)'
Invoke-Tester -TesterArgs @('npx', 'playwright', 'test', '--project=es') -EnvVars @('RUN_MODE=simulated') | Out-Null

if ($Mixed) {
  Write-Step 'Demo con fallos provocados (DEBE fallar, solo en S1-RID-VISIBLE y S2-MSG-LANG-VISIBLE)'
  $code = Invoke-Tester -TesterArgs @('npx', 'playwright', 'test', '--project=es') -EnvVars @('RUN_MODE=simulated', 'SIMULATION=mixed') -AllowFail
  if ($code -eq 0) { Stop-WithError 'La demo con fallos provocados no ha fallado: el tester no detecta los errores.' }
  Write-Host 'Ha fallado como se esperaba: el tester detecta los errores provocados.' -ForegroundColor Green
}

if ($Real) {
  Write-Step 'Escenario 1 real contra betsson.es'
  $envText = Get-Content 'tester/.env' -Raw
  if ($envText -notmatch '(?m)^BETSSON_ES_USER=\S+' -or $envText -notmatch '(?m)^BETSSON_ES_PASS=\S+') {
    Stop-WithError 'Rellena BETSSON_ES_USER y BETSSON_ES_PASS en tester/.env con la cuenta de prueba de Betsson.'
  }
  Write-Host 'ATENCIÓN: hace una tirada con DINERO REAL de la cuenta de prueba (apuesta máxima: MAX_BET, 5 € por defecto).' -ForegroundColor Yellow
  Write-Host 'No lo lances si hay otra ejecución real en marcha (en CI o en otro ordenador) con la misma cuenta.' -ForegroundColor Yellow
  if ((Read-Host 'Escribe SI para continuar') -ne 'SI') { Stop-WithError 'Cancelado.' }
  Invoke-Tester -TesterArgs @('npx', 'playwright', 'test', 'tests/completed-spin.spec.ts', '--project=es') -AllowFail | Out-Null
  Write-Host 'Revisa a mano las capturas de tester/reports/es-completed-spin/evidence/ antes de compartir nada.' -ForegroundColor Yellow
}

if ($Landing) {
  Write-Step 'Centro de control (landing): validación en directo contra la maqueta local'
  & docker @Compose up -d control | Out-Host
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'No se pudo arrancar el centro de control (¿puertos 8090, 8091 u 8095 ocupados?)' }
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8095/' -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
  Write-Host 'Abierto en http://localhost:8095  (para pararlo: docker compose -f tester/compose.yaml stop control mock)'
  Start-Process 'http://localhost:8095'
}

Write-Host "`n✔ Listo." -ForegroundColor Green
Write-Host 'Informes: tester/reports/es-completed-spin/report.html y tester/reports/es-insufficient-balance/report.html'
Write-Host 'Para verlos en el navegador: docker compose -f tester/compose.yaml run --rm --service-ports tester npm run report  →  http://localhost:9323'
