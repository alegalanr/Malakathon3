# Instrucciones para agentes

## Proyecto

Hackathon (reto de Betsson). Construimos un bot que entra en la web de Betsson, detecta un juego nuevo en el lobby, lo abre, juega una ronda en el canvas, hace capturas y da un veredicto PASS/FAIL con su motivo. Somos varias personas trabajando en paralelo, cada una con su agente.

- [ESTADO.md](ESTADO.md): qué funciona y quién está con cada parte.
- [docs/diseno.md](docs/diseno.md): etapas, módulos, formato de `run.json` y decisiones tomadas.
- [docs/web-betsson.md](docs/web-betsson.md): lo que sabemos de la web.
- [docs/reto.md](docs/reto.md): el enunciado.
- `pitch/`: material de la presentación. No lo toques salvo que la tarea sea el pitch.

## Flujo de trabajo

**Al empezar una tarea:**

1. `git switch main && git pull`.
2. Comprueba en `ESTADO.md` y con `gh pr list` que nadie está ya con esa parte. Si alguien lo está, díselo a la persona y no sigas.
3. Crea una rama `<persona>/<parte>-<tarea>`, por ejemplo `marta/launch-iframe`.
4. En tu sección de `ESTADO.md` pon 🟡 y tu nombre. Haz commit, push y `gh pr create --draft` con el título `<parte>: <tarea>`.

**Mientras trabajas:**

- Commits pequeños y push a menudo.
- Toca solo los ficheros de tu parte. Si necesitas cambiar algo compartido (formato de `run.json`, orquestador, dependencias, Docker), hazlo en un PR pequeño aparte y fusiónalo cuanto antes.

**Al terminar:**

1. Actualiza tu sección de `ESTADO.md`: estado, cómo se ha hecho y evidencia. ✅ solo si lo has ejecutado y hay evidencia (captura, `run.json`, salida de un comando).
2. Si has aprendido algo de la web, añádelo a `docs/web-betsson.md`. Si has elegido entre alternativas, añade una fila a la tabla de decisiones de `docs/diseno.md`.
3. Actualiza la rama con `git merge origin/main` (no rebase: evita forzar el push). Resuelve los conflictos y comprueba que sigue funcionando.
4. Rellena la descripción del PR siguiendo la plantilla y ejecuta `gh pr ready`.
5. Confirma con la persona y fusiona: `gh pr merge --squash --delete-branch`.

## Idioma

- En español: todo lo que lee una persona (docs, PRs, commits, comentarios en el código, mensajes y logs del bot).
- En inglés: solo el código en sí (nombres de variables, funciones, módulos y ficheros de código).
- Sin `Co-Authored-By` ni firmas de agente en commits ni PRs.

## Nunca

- **Jugar con dinero real.** Solo modo demo o el entorno que dé la organización. Si un juego exige apostar dinero real, para y avisa.
- **Poner credenciales** en código, prompts, logs o capturas. Las de prueba van en `.env`, que no se sube.
- **Saltarte CAPTCHAs o protecciones anti-bot.** Si aparece una, apúntala en `docs/web-betsson.md` y avisa.
- **Decir que algo funciona sin haberlo ejecutado.**

## Técnico

- Todo se ejecuta en Docker; no se instala nada en el host.
- Un módulo por etapa (ver `docs/diseno.md`). Cada etapa tiene que poder ejecutarse sola con una entrada fija, para que nadie dependa de que funcionen las anteriores.
- Antes que IA, código determinista (selectores, API del lobby, tráfico de red). La IA con visión solo se usa donde no hay más remedio.
- Cada ejecución escribe `runs/<run_id>/` con el formato de `docs/diseno.md`; esa carpeta no se sube.
- No subas ficheros de más de 2 MB.
