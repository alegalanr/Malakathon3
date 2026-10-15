# Estado

Qué funciona y quién está con cada parte. Cada agente actualiza **solo su sección**.

⬜ sin empezar · 🟡 en curso · ✅ funciona (con evidencia) · ❌ bloqueado

<!-- Va en secciones y no en una tabla a propósito: si dos PRs cambian filas contiguas de una tabla, git da conflicto; si cambian secciones distintas, no. -->

## Explorar la web

- **Estado:** 🟡
- **Quién:**
- **Cómo:** a mano; los hallazgos van en [docs/web-betsson.md](docs/web-betsson.md)
- **Evidencia:**

## 1. Entrar en Betsson

- **Estado:** ⬜
- **Quién:**
- **Cómo:**
- **Evidencia:**

## 2. Detectar juego nuevo

- **Estado:** ⬜
- **Quién:**
- **Cómo:**
- **Evidencia:**

## 3. Abrir el juego

- **Estado:** ⬜
- **Quién:**
- **Cómo:**
- **Evidencia:**

## 4. Jugar una ronda

- **Estado:** ⬜
- **Quién:**
- **Cómo:**
- **Evidencia:**

## 5. Veredicto PASS/FAIL

- **Estado:** ⬜
- **Quién:**
- **Cómo:**
- **Evidencia:**

## Orquestador (todo junto) y Docker

- **Estado:** 🟡
- **Quién:** Julia
- **Cómo:** `bot/run.py` encadena las etapas con una sesión de Playwright compartida (`bot/browser.py`) y escribe `runs/<run_id>/` con el formato de [docs/diseno.md](docs/diseno.md) (`bot/evidence.py`). Docker con la imagen oficial de Playwright y un casino simulado (`mock_casino/`) para ensayar. Las 5 etapas tienen una primera versión funcional en `bot/stages/` para que cada responsable la tome y la mejore. Detalle en [docs/arquitectura-esqueleto.md](docs/arquitectura-esqueleto.md).
- **Evidencia:** contra el casino simulado (fuera de Docker): flujo completo PASS; FAIL provocado bloqueando el proveedor (falla en `launch`) y bloqueando la petición de jugada (falla en `play`); cada etapa ejecutada sola. Pendiente: repetirlo en Docker con esta estructura, probar con la web real y con la IA real.

## Tester TS (SOLUCION.md + DISENO.md) en betsson.es

- **Estado:** 🟡
- **Quién:** Alejandro
- **Cómo:** `tester/`: fases F0-F12 con `RunContext` y `PhaseStatus`, contratos zod, eventos + red + cartera, testigo visual (OCR dirigido), informe `report.json`/`report.html`, modo simulado, `merge-reports`, `scan-secrets` y `.github/workflows/validate.yml`. Huecos tapados y pendientes en [tester/README.md](tester/README.md).
- **Evidencia:** 17 tests unitarios en verde; modo simulado con OCR real (pass 14/14; mixed falla justo en S1-RID-VISIBLE y S2-MSG-LANG-VISIBLE); escáner de secretos limpio; lobby real en verde. Falta la ejecución real con sesión.

## Testigo visual (OCR) del tester TS

- **Estado:** 🟡
- **Quién:** Julieta
- **Cómo:** `tester/src/vision/` con las mismas interfaces que usan `runScenario` y `simulateScenario`. Consenso en rid y apuesta (dos lecturas con preprocesados distintos tienen que coincidir; si no, `null` con motivo), confianza por carácter (con lista de caracteres permitidos tesseract.js daba 0 a la palabra), localización de la apuesta por el importe leído y no solo por geometría, idioma del aviso con comparación difusa, recorte por campo y momento (F5 ya no pisa el de F8) y parseo estricto de importes en pantalla (`alwaysDecimals` en `markets.json` de `es`). `TESSDATA_DIR` para usar el OCR sin red.
- **Evidencia:** `npm run unit` → 32 tests en verde (15 nuevos de OCR real sobre pantallas sintéticas, 3 sobre una réplica del juego del modo simulado). En el modo simulado (Docker) la apuesta salía "10,20 €" en vez de "0,20 €": la zona del importe se comía la última A de APUESTA; corregido. Con el código anterior, 3 de esos tests fallaban: rid `663731119` leído como `603731119` y apuesta `0,20 €` leída como `0`. En Docker: modo simulado `pass` todo ✔ y `mixed` con FAIL solo en `S1-RID-VISIBLE` y `S2-MSG-LANG-VISIBLE`. Integrado con el escenario 2 de Julia: el idioma del aviso combina su regla de frase completa con la comparación difusa. Falta probarlo con capturas reales del juego.
- **Seguridad de las evidencias:** máscaras en las capturas de página completa, revisión con OCR de las capturas buscando las credenciales (`src/evidence/PrivacyScan.ts`), consola censurada, sin Pages para ejecuciones reales, `concurrency` en el workflow, Actions fijadas por SHA y datos del OCR desde npm. Detalle en [tester/README.md](tester/README.md#seguridad-de-las-evidencias). 56 tests unitarios en verde.

## Tester: escenario 2, configuración y casos raros

- **Estado:** 🟡
- **Quién:** Julia
- **Cómo:** sobre `tester/` y sin cambiar sus contratos salvo un campo opcional (`SpinRecord.nextAction`).
  - Detector del rechazo en F7 (`src/scenario2/RejectionDetector.ts`): señales de evento, red y pantalla, con el borrador del contrato en `reports/es-insufficient-balance/rejection-contract.json`.
  - Hipótesis del rechazo en `config/rejection-hypotheses.json` (`REJECTED` en el adaptador y claves de error en la red).
  - Casos raros en `src/edge-cases/EdgeCases.ts`: precondición de saldo antes de girar (no gastar dinero en el escenario 2), ronda pendiente al cargar y free spins o bonus.
  - Arreglo del idioma del aviso, que ahora compara frases completas.
  - `scripts/compare-games.mjs` para probar varios juegos.
  - Detalle en [tester/README.md](tester/README.md#escenario-2-y-casos-raros).
- **Evidencia:**
  - `tsc --noEmit` limpio.
  - 35 tests unitarios en verde (los 17 que había y 18 nuevos).
  - Modo simulado: `pass` 14/14 y `mixed` con FAIL solo en `S1-RID-VISIBLE` y `S2-MSG-LANG-VISIBLE`, como antes.
  - Falta la ejecución real con la cuenta sin saldo para confirmar el contrato del rechazo.

## Tester contra betsson.es real (login manual, sesión DGOJ, carga del juego)

- **Estado:** 🟡
- **Quién:** Paola
- **Cómo:** login manual (el anti-bot de Group-IB bloquea el login automatizado; lo indican los mentores): `tester/scripts/save-session.mjs` + `MANUAL_LOGIN=1`. Sesión de juego DGOJ («Atención» → formulario 5 Horas / 100 % → «Iniciar sesión»). Carga del juego de 75-133 s a ~21 s (caché de recursos en `.cache/assets`, traza desde READY, sin recarga con `?gameAction=play`). Intro de Pragmatic cerrada por OCR, apuesta inicial de `doInit`, Espacio al iframe interno, `DRY_RUN=1` para ensayar sin apostar.
- **Evidencia:** prueba real del escenario 1 en Bubble Up (15/10, 4,00 €): 6 de 8 checks PASS (ronda empezada y terminada, apuesta evento = red, moneda, saldo del juego 59,50 → 55,50 € = red, saldo de Betsson 55,50 €). Fallaban las dos lecturas de pantalla (apuesta y rid): con las variantes invertidas ×8/×5 del preprocesado leen «4,00 €» y el rid en las capturas reales, pero falta repetirlo en real tras fusionar con el testigo de consenso de main.

## Pitch

- **Estado:** ⬜
- **Quién:**
- **Cómo:** en [pitch/](pitch/)
- **Evidencia:**
