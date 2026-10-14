---
name: pitch
description: Reúne el material del repo para preparar la presentación del pitch
disable-model-invocation: true
---

Prepara material para quien está haciendo la presentación. No cambies nada fuera de `pitch/`.

Lee:

1. `ESTADO.md`: qué funciona y qué no.
2. `docs/diseno.md`: cómo funciona el bot y la tabla de decisiones.
3. Los PRs fusionados (`gh pr list --state merged --limit 100 --json number,title,body,mergedAt`): qué se ha hecho, en qué orden y qué problemas hubo.
4. Los `run.json` de `runs/` y de `pitch/evidencias/`: tiempos, coste de IA, PASS/FAIL.

Escribe o actualiza `pitch/material.md` en español, con estas secciones:

- **Qué funciona.**
- **Cómo funciona**, en lenguaje no técnico.
- **Decisiones clave y por qué.**
- **Problemas superados.**
- **Números**, cada uno con su fuente.
- **Mejores runs para la demo.**

No inventes nada. Si algo no tiene fuente, déjalo como pendiente. Al terminar, dile a la persona qué hay de nuevo desde la última versión.
