---
description: Cierra la tarea actual: actualiza ESTADO.md y prepara el commit y el PR
argument-hint: [resumen opcional]
---

Cierra la tarea de esta sesión siguiendo el apartado "Al terminar una tarea" de `AGENTS.md`.

Contexto extra de la persona: $ARGUMENTS

1. Averigua qué se ha hecho a partir de esta conversación, `git status` y `git diff main...HEAD`. Pregunta solo lo que no puedas deducir.
2. Actualiza la fila correspondiente en `ESTADO.md`. Solo pon ✅ si hay evidencia real.
3. Si se ha aprendido algo de la web, añádelo a `docs/web-betsson.md`. Si se ha elegido entre alternativas, añade una fila a "Decisiones tomadas" en `docs/diseno.md`.
4. Redacta la descripción del PR con `.github/pull_request_template.md`, separando lo comprobado de lo supuesto. En español y breve.
5. Enseña a la persona el mensaje del commit y la descripción del PR. **Espera su confirmación** y entonces haz commit, push de la rama y `gh pr create` (o `gh pr edit` si el PR ya existe).
