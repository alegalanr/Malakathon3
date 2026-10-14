# Reto

## Enunciado

TODO: pegar aquí el enunciado oficial tal cual, con los criterios de evaluación.

Mientras tanto, esto es lo que sabemos:

> Construir un bot/agente capaz de navegar a la web de Betsson, buscar/detectar un nuevo juego en el lobby, iniciarlo, realizar una jugada (interactuar con el canvas/juego), tomar capturas como evidencia y dar un veredicto (Pass/Fail) de forma automatizada.

## Cómo lo entendemos

Es **QA automático de juegos de casino**. Hoy, cuando un proveedor saca un juego nuevo, alguien tiene que probarlo a mano. Nosotros lo hacemos de punta a punta y dejamos las pruebas guardadas.

Para nuestra demo, haberlo conseguido significa:

- Con un solo comando se hace todo, sin tocar nada.
- Sale el veredicto con su motivo y una captura de cada paso.
- Si el juego no carga o no responde, sale FAIL. Si podemos, lo enseñamos con un caso que falle.

## Preguntas para la organización

Cuando tengamos la respuesta, apuntarla al lado de la pregunta.

- [ ] ¿Qué web usamos: betsson.com, .es o un entorno de pruebas?
- [ ] ¿Hace falta login para jugar en modo demo? ¿Nos dan una cuenta de prueba?
- [ ] ¿Hay protección anti-bot? ¿Nos dan alguna forma de evitarla legítimamente?
- [ ] ¿Qué es un "juego nuevo": la etiqueta "New", una categoría o uno que no estaba la última vez?
- [ ] ¿Qué cuenta como PASS: que cargue, que se complete una ronda, que cambie el saldo?
- [ ] ¿Qué se entrega (repo, vídeo, demo en directo) y cuánto dura el pitch?
- [ ] ¿Podemos usar APIs de IA externas? ¿Hay créditos?
