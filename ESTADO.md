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

## Tester TS: escenario 1 en betsson.es

- **Estado:** 🟡
- **Quién:** Alejandro
- **Cómo:** `tester/` (TypeScript + Playwright Test en Docker), siguiendo `SOLUCION.md` del equipo: login sin traza, buscar Bubble Up, Real Play, Espacio + `gameRoundStarted`, eventos + red + cartera, comprobaciones P1, S1.1–S1.5 y R1. Decisiones, opciones y pendientes en [tester/README.md](tester/README.md).
- **Evidencia:**

## Pitch

- **Estado:** ⬜
- **Quién:**
- **Cómo:** en [pitch/](pitch/)
- **Evidencia:**
