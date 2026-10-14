---
description: Actualiza PITCH.md con lo que se ha hecho y comprobado
---

Actualiza `PITCH.md` para que refleje el estado real del proyecto.

Fuentes:

1. `ESTADO.md`: qué funciona ahora y el mejor run.
2. PRs fusionados: `gh pr list --state merged --limit 100 --json number,title,body,mergedAt`. Usa sus secciones "Para el pitch" y "Cómo se ha probado".
3. Los `run.json` de `evidencias/`, para las métricas.
4. "Decisiones tomadas" en `docs/diseno.md`.

Reglas:

- En español, para un jurado no técnico: primero el valor y después la tecnología.
- Ninguna cifra ni afirmación sin fuente. Si falta evidencia, se queda el `TODO`.
- Mantén las secciones de `PITCH.md`.
- Al acabar, dile a la persona qué secciones has cambiado, qué `TODO` quedan y las 3 afirmaciones más fuertes con su evidencia. No hagas commit salvo que te lo pida.
