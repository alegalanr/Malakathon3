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

## Pitch

- **Estado:** ⬜
- **Quién:**
- **Cómo:** en [pitch/](pitch/)
- **Evidencia:**
