# Instrucciones para agentes

Válidas para cualquier agente (Claude Code, Cursor, Codex, Copilot…). El contexto del proyecto y el mapa de ficheros están en [README.md](README.md): léelo primero.

## Antes de empezar

- Lee [ESTADO.md](ESTADO.md) para no duplicar trabajo y saber quién lleva qué.
- Haz `git pull` de `main` y crea una rama `<persona>/<tarea-corta>`.
- Para algo de la web de Betsson, mira primero [docs/web-betsson.md](docs/web-betsson.md). Para el diseño del bot, [docs/diseno.md](docs/diseno.md).

## Al terminar una tarea (obligatorio)

Una tarea no está terminada hasta que está reportada:

1. Actualiza la fila correspondiente en `ESTADO.md`: estado, responsable, enfoque y evidencia. ✅ solo si hay evidencia (captura, `run.json` o comando ejecutado).
2. Si has aprendido algo de la web, añádelo a `docs/web-betsson.md`.
3. Si has elegido entre alternativas, añade una fila a la tabla de decisiones de `docs/diseno.md`.
4. Abre el PR a `main` siguiendo `.github/pull_request_template.md`. Esa descripción **es el informe**, y de ahí sale el pitch.
5. Pide confirmación a la persona antes de hacer push o crear el PR.

Al reportar:

- Separa lo **comprobado** (lo has ejecutado) de lo **supuesto**. Nunca digas que algo funciona sin haberlo ejecutado.
- Sé breve. Una persona tiene que leerlo en 20 segundos.

## Idioma

- En español: todo lo que lee una persona (docs, PRs, commits, comentarios en el código, mensajes y logs del bot).
- En inglés: solo el código en sí (nombres de variables, funciones, módulos y ficheros de código).
- Commits cortos: `lobby: detectar juegos nuevos con la API`.
- Sin `Co-Authored-By` ni firmas de agente ("Generated with…") en commits ni PRs.

## Reglas que no se rompen

- **Nada de dinero real.** Solo modo demo o el entorno que dé la organización. Si un juego exige apostar dinero real, para y repórtalo como bloqueo.
- **Nada de credenciales** en código, prompts, logs ni capturas. Las de prueba van en `.env`, que no se sube. No leas ni imprimas su contenido.
- **No te saltes CAPTCHAs ni protecciones anti-bot.** Si aparece una, apúntala en `docs/web-betsson.md` y avisa al equipo.
- No machaques la web: esperas razonables y nada de peticiones en paralelo masivas.
- Tapa los datos personales de las capturas antes de copiarlas a `evidencias/`.

## Convenciones técnicas

- Todo se ejecuta en **Docker**: no se instala nada en el host. El comando para ejecutarlo va en el README.
- Antes que un LLM, código determinista (selectores, API del lobby). El modelo con visión solo se usa dentro del canvas y para el veredicto.
- Cada ejecución del bot escribe `runs/<run_id>/` (no se sube) con el formato de `docs/diseno.md`. Ese formato lo comparten todas las etapas: si lo cambias, avisa en el PR.
- No subas ficheros de más de 2 MB.
