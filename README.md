# Malakathon3: agente de QA para juegos nuevos de Betsson

Un bot que, sin intervención humana:

1. entra en la web de Betsson,
2. detecta un **juego nuevo** en el lobby,
3. lo abre,
4. juega una ronda,
5. hace capturas,
6. da un veredicto **PASS/FAIL** con su motivo.

👉 **Qué funciona y quién está con qué:** [ESTADO.md](ESTADO.md)

## Empezar

1. Clona el repo: `git clone https://github.com/alegalanr/Malakathon3.git`
2. Si no lo tienes ya, inicia sesión en GitHub desde la terminal: `gh auth login`
3. Abre tu agente (Claude Code, Cursor…) en la carpeta, mira [ESTADO.md](ESTADO.md) y dile qué parte vas a hacer. Por ejemplo: *"voy a hacer la etapa 3, abrir el juego"*.

El agente se encarga de crear la rama, abrir el PR y mantener [ESTADO.md](ESTADO.md) al día. Las reglas que sigue están en [AGENTS.md](AGENTS.md): no hace falta que te las aprendas.

## Cómo trabajamos

- **Cada parte del bot es un módulo separado y la lleva una persona.** Así no nos pisamos ni hay conflictos de merge.
- **Cada tarea va en su rama, con un PR abierto desde el principio.** Así la [lista de PRs](https://github.com/alegalanr/Malakathon3/pulls) dice quién está con qué parte.
- **Cualquiera puede fusionar su PR en `main`** cuando lo ha probado.

Y lo que no se hace nunca:

- jugar con dinero real (solo modo demo),
- subir credenciales al repo,
- saltarse CAPTCHAs o protecciones anti-bot.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Qué funciona y quién lo lleva | [ESTADO.md](ESTADO.md) |
| Enunciado y preguntas para la organización | [docs/reto.md](docs/reto.md) |
| Lo que sabemos de la web de Betsson | [docs/web-betsson.md](docs/web-betsson.md) |
| Cómo funciona el bot, módulos y decisiones | [docs/diseno.md](docs/diseno.md) |
| Presentación y pitch | [pitch/](pitch/) |

## Ejecutar

TODO: un único comando con Docker, en cuanto esté el stack.

## Idioma

Todo lo que lee una persona (docs, PRs, commits, comentarios, mensajes del bot) va en español. Solo el código en sí va en inglés.
