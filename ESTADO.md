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
- **Evidencia:** `npm run unit` → 29 tests en verde (12 nuevos de OCR real sobre pantallas sintéticas). Con el código anterior, 3 de esos tests fallaban: rid `663731119` leído como `603731119` y apuesta `0,20 €` leída como `0`. Falta probarlo con capturas reales del juego y en modo simulado (necesita Chromium, en Docker).

## Pitch

- **Estado:** ⬜
- **Quién:**
- **Cómo:** en [pitch/](pitch/)
- **Evidencia:**
