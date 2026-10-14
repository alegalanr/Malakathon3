# Malakathon3: agente de QA para juegos nuevos de Betsson

Un bot que, sin intervención humana:

1. entra en la web de Betsson,
2. detecta un **juego nuevo** en el lobby,
3. lo abre,
4. juega una ronda,
5. hace capturas,
6. da un veredicto **PASS/FAIL** con su motivo.

👉 **¿Qué funciona ahora mismo y quién lleva qué?** → [ESTADO.md](ESTADO.md)

## Cómo trabajamos

Tres reglas, nada más:

1. **Una rama por tarea y un PR a `main`.** Nunca push directo a `main`.
2. **La descripción del PR es el informe.** La plantilla sale sola al abrir el PR: qué se ha hecho, cómo se ha probado, qué falta y una frase para el pitch. Con Claude Code, `/reportar` lo rellena por ti.
3. **Al cerrar una tarea, actualiza tu fila en [ESTADO.md](ESTADO.md).** `/reportar` también lo hace.

Si trabajas con un agente (Claude Code, Cursor, Codex…), él ya conoce estas reglas porque lee [AGENTS.md](AGENTS.md). No tienes que explicárselas.

Y tres cosas que no se hacen nunca:

- Jugar con dinero real: solo modo demo.
- Meter credenciales en el repo.
- Saltarse CAPTCHAs o protecciones anti-bot.

## Dónde está cada cosa

| Fichero | Para qué |
|---|---|
| [ESTADO.md](ESTADO.md) | Qué funciona, quién lleva qué, bloqueos |
| [PITCH.md](PITCH.md) | Pitch y guion de la demo. Se monta con `/pitch` |
| [docs/reto.md](docs/reto.md) | Enunciado y preguntas pendientes para la organización |
| [docs/web-betsson.md](docs/web-betsson.md) | Lo que sabemos de la web: lobby, modo demo, anti-bot, canvas |
| [docs/diseno.md](docs/diseno.md) | Cómo funciona el bot, formato de salida y decisiones tomadas |
| `evidencias/` | Los mejores runs, para la demo (se crea con el primero) |

## Cómo se ejecuta

TODO: un único comando con Docker, en cuanto esté el stack.

## Idioma

Todo lo que lee una persona (docs, PRs, commits, comentarios, mensajes del bot) va en **español**. Solo el código (nombres de variables, funciones y ficheros de código) va en inglés.
