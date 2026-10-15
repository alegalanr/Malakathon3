<#
  Arranque del tester en Windows: comprueba Docker, instala dependencias y ejecuta las pruebas.
  No instala nada en el ordenador: todo corre dentro de la imagen oficial de Playwright.
  (El login manual de las ejecuciones reales usa además el navegador del ordenador y Node >= 22.)

  Uso, desde la raíz del repo:
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1            # instalar + tests + modo simulado
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Mixed     # además, la demo con fallos provocados
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -DryRun    # además, los dos escenarios contra betsson.es SIN apostar
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Real      # además, escenarios 1 y 2 contra betsson.es (el 1 gasta dinero real)
    powershell -ExecutionPolicy Bypass -File .\arranque.ps1 -Landing   # además, deja abierta la landing / centro de control en http://localhost:8095

  Contra betsson.es el login es SIEMPRE manual (el anti-bot bloquea el automatizado; lo indican los mentores):
  el script abre el navegador, inicias sesión a mano con cada cuenta de prueba y guarda la sesión en
  tester/.auth/ (no se sube). Si ya hay una sesión guardada, la reutiliza.
#>
param(
  [switch]$Mixed,
  [switch]$DryRun,
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

# --- Ejecuciones contra betsson.es ------------------------------------------------------------
# Escenario → cuenta, puerto de depuración y perfil del navegador (uno por cuenta: no se mezclan las sesiones)
$Accounts = @{
  'completed-spin'       = @{ Label = 'la cuenta de prueba CON saldo'; Port = 9222; Profile = 'betsson-tester-con-saldo' }
  'insufficient-balance' = @{ Label = 'la cuenta de prueba SIN saldo'; Port = 9223; Profile = 'betsson-tester-sin-saldo' }
}

function Test-SavedSession($scenario) {
  $file = "tester/.auth/es-$scenario.json"
  if (-not (Test-Path $file)) { return $false }
  try { return ((Get-Content $file -Raw | ConvertFrom-Json).cookies.Count -gt 0) } catch { return $false }
}

function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

# Login manual: abre el navegador (perfil aparte, sin automatizar), la persona inicia sesión y se guarda la sesión.
function Confirm-Session($scenario) {
  $acc = $Accounts[$scenario]
  if (Test-SavedSession $scenario) {
    Write-Host "Sesión guardada para $($acc.Label) (tester/.auth/es-$scenario.json). Si ha caducado, borra ese fichero y vuelve a ejecutar."
    return
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Para guardar la sesión del login manual hace falta Node 22 o superior en este ordenador (https://nodejs.org).'
  }
  $browser = Find-Browser
  if (-not $browser) { Stop-WithError 'No se encuentra Edge ni Chrome para el login manual.' }
  Write-Host "Se abre el navegador: inicia sesión A MANO con $($acc.Label) y espera a ver el casino." -ForegroundColor Yellow
  Write-Host 'No cierres esa ventana hasta que el script lo diga.' -ForegroundColor Yellow
  Start-Process -FilePath $browser -ArgumentList @(
    "--remote-debugging-port=$($acc.Port)",
    "--user-data-dir=$env:TEMP\$($acc.Profile)",
    '--no-first-run',
    'https://www.betsson.es/inicio?returnUrl=%2Fcasino'
  ) | Out-Null
  Read-Host 'Pulsa Enter cuando hayas iniciado sesión' | Out-Null
  $env:CDP_PORT = "$($acc.Port)"
  & node tester/scripts/save-session.mjs es $scenario | Out-Host
  $code = $LASTEXITCODE
  Remove-Item Env:CDP_PORT -ErrorAction SilentlyContinue
  if ($code -ne 0 -or -not (Test-SavedSession $scenario)) { Stop-WithError "No se pudo guardar la sesión de $($acc.Label). ¿Iniciaste sesión en esa ventana?" }
  Write-Host 'Sesión guardada. Ya puedes cerrar esa ventana del navegador.' -ForegroundColor Green
}

# Escenario contra la web real, SIEMPRE con MANUAL_LOGIN=1 (sin él, el tester intentaría el login
# automatizado: saltaría el anti-bot y vaciaría la sesión guardada)
function Invoke-RealScenario($scenario, [switch]$Dry) {
  $vars = @('MANUAL_LOGIN=1')
  if ($Dry) { $vars += 'DRY_RUN=1' }
  return Invoke-Tester -TesterArgs @('npx', 'playwright', 'test', '--project=es', "tests/$scenario.spec.ts", '--reporter=line') -EnvVars $vars -AllowFail
}

# En el ensayo (DRY_RUN) los checks salen FAIL a propósito; lo que importa es que lleguen F1-F5
function Test-DryRunReached($scenario) {
  $file = "tester/reports/es-$scenario/report.json"
  if (-not (Test-Path $file)) { return $false }
  $r = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $failed = @($r.phases | Where-Object { $_.status -eq 'failed' -and $_.phase -in @('F1', 'F2', 'F3', 'F4', 'F5') })
  foreach ($p in $failed) { Write-Host "  $($p.phase) falló: $($p.reason)" -ForegroundColor Red }
  return ($failed.Count -eq 0)
}

function Test-SessionExpired($scenario) {
  $file = "tester/reports/es-$scenario/report.json"
  if (-not (Test-Path $file)) { return $false }
  $r = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  return [bool]@($r.phases | Where-Object { $_.phase -eq 'F1' -and $_.status -eq 'failed' -and $_.reason -match 'sesi.n no iniciada' }).Count
}

function Show-Checks($scenario) {
  $file = "tester/reports/es-$scenario/report.json"
  if (-not (Test-Path $file)) { return }
  $r = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $pass = @($r.checks | Where-Object { $_.result -eq 'PASS' }).Count
  $color = 'Yellow'
  if ($pass -eq $r.checks.Count) { $color = 'Green' }
  Write-Host "  $scenario`: $pass de $($r.checks.Count) checks PASS · informe: tester/reports/es-$scenario/report.html" -ForegroundColor $color
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

Write-Step 'Fichero de configuración'
if (-not (Test-Path 'tester/.env')) {
  Copy-Item 'tester/.env.example' 'tester/.env'
  Write-Host 'Creado tester/.env a partir del ejemplo. Con el login manual no hace falta poner credenciales.'
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

if ($DryRun -or $Real) {
  Write-Step 'Sesiones de las cuentas de prueba (login manual)'
  Confirm-Session 'completed-spin'
  Confirm-Session 'insufficient-balance'

  Write-Step 'Ensayo contra betsson.es SIN apostar (sesión, sesión de juego, carga, intro y apuesta: hasta F5)'
  $dryOk = $true
  foreach ($s in @('completed-spin', 'insufficient-balance')) {
    Invoke-RealScenario $s -Dry | Out-Null
    # Betsson cierra la sesión pasado un tiempo: si ha caducado, se repite el login manual y se ensaya otra vez
    if (-not (Test-DryRunReached $s) -and (Test-SessionExpired $s)) {
      Write-Host "  La sesión de $($Accounts[$s].Label) ha caducado." -ForegroundColor Yellow
      if ((Read-Host '  ¿Iniciar sesión otra vez ahora? (S/n)') -notmatch '^[nN]') {
        Remove-Item "tester/.auth/es-$s.json" -ErrorAction SilentlyContinue
        Confirm-Session $s
        Invoke-RealScenario $s -Dry | Out-Null
      }
    }
    if (Test-DryRunReached $s) { Write-Host "  $s`: ensayo OK, listo para girar" -ForegroundColor Green }
    else { $dryOk = $false; Write-Host "  $s`: el ensayo no llega a F5" -ForegroundColor Red }
  }
  if ($Real -and -not $dryOk) { Stop-WithError 'El ensayo ha fallado: no se lanza nada con dinero real.' }
}

if ($Real) {
  Write-Step 'Escenario 1 real: una tirada completada'
  Write-Host 'ATENCIÓN: hace una tirada con DINERO REAL de la cuenta de prueba (apuesta máxima: MAX_BET, 5 € por defecto).' -ForegroundColor Yellow
  Write-Host 'No lo lances si hay otra ejecución real en marcha (en CI o en otro ordenador) con la misma cuenta.' -ForegroundColor Yellow
  if ((Read-Host 'Escribe SI para continuar') -ne 'SI') { Stop-WithError 'Cancelado.' }
  Invoke-RealScenario 'completed-spin' | Out-Null

  Write-Step 'Escenario 2 real: tirada rechazada por saldo insuficiente (no gasta: si la cuenta tiene saldo para la apuesta, no gira)'
  Invoke-RealScenario 'insufficient-balance' | Out-Null

  Write-Step 'Resultado'
  Show-Checks 'completed-spin'
  Show-Checks 'insufficient-balance'
  Write-Host 'Revisa a mano las capturas de tester/reports/es-*/evidence/ antes de compartir nada.' -ForegroundColor Yellow
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
