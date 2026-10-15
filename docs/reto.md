# Reto

Fuente: [enunciado oficial (PDF)](2026-10-15_malackathon-student-challenge.pdf), *Malackathon 2026 — Intelligent Game Validation*, de Betsson. Si algo de aquí no cuadra con el PDF, manda el PDF.

## En una frase

> ¿Podéis probar un juego de casino de un tercero como lo haría un jugador, sin acceso al DOM del juego?

Hay que construir una prueba de concepto que entre en el casino de Betsson, abra un juego de **Pragmatic Play** en **Real Play** con una cuenta de prueba y valide dos recorridos **leyendo lo que se ve en pantalla**. Hacer clic en Spin no demuestra nada: hay que demostrar que el juego reaccionó y que los saldos cuadran.

## Contexto

Betsson integra en su lobby, su cuenta y su monedero (wallet) juegos de estudios externos. Esos juegos se pintan dentro de un iframe o un canvas, así que sus botones, saldos y mensajes no se pueden inspeccionar con la automatización habitual basada en el DOM.

Tecnología y arquitectura son libres. Visión por computador, OCR, reconocimiento de imagen o interacción con IA son opciones, ninguna obligatoria. Lo obligatorio es verificar el resultado que ve el jugador, sin limitarse a clics fijos.

## Alcance y salvaguardas

- Vale cualquier juego de Pragmatic Play disponible en el mercado. No hay un título fijo.
- Betsson da por separado cuentas de prueba ya creadas y con saldo.
- **Ni credenciales ni secretos** en el repo, el informe, las capturas, las grabaciones ni la presentación.
- Cada prueba usa el idioma, la moneda y la configuración de su mercado.

## Mercados

Los dos escenarios se ejecutan en los dos mercados:

| Web               | Idioma  | Moneda            |
|-------------------|---------|-------------------|
| betsson.com       | inglés  | EUR               |
| betsson.pe (Perú) | español | PEN (soles, `S/`) |

## Escenario 1: spin completado en Real Play

1. Abrir el lobby del casino del mercado.
2. Iniciar sesión con la cuenta de prueba con saldo.
3. Abrir un juego de Pragmatic Play del mercado y entrar en Real Play.
4. Leer el saldo de Betsson antes del spin. Identificar la apuesta (wager) que se muestra y la moneda.
5. Localizar los controles dentro del juego y lanzar un spin.
6. Verificar en pantalla que el juego reaccionó y que el spin terminó.
7. Leer el resultado y los saldos después del spin.

Comprobaciones (cada una lleva su PASS/FAIL en el informe; los ids son nuestros):

| Id   | Comprobación                                                                               |
|------|--------------------------------------------------------------------------------------------|
| S1.1 | El spin empezó y terminó de verdad. Haber hecho clic no es un PASS.                         |
| S1.2 | La apuesta que se muestra es la que se usó en el spin.                                      |
| S1.3 | La moneda que se muestra es la del mercado.                                                 |
| S1.4 | El saldo dentro del juego es coherente con el spin completado.                              |
| S1.5 | El saldo de Betsson antes y después cuadra con la apuesta y el premio observado.            |

**Regla del saldo:** `saldo después = saldo antes − apuesta + premio`. El premio (payout) es lo que abona el spin según el resultado que se ve en pantalla. No hace falta ganar para que sea PASS.

## Escenario 2: saldo insuficiente

Se usa una cuenta de prueba sin saldo suficiente para el spin. Ese estado se prepara con los mentores.

1. Abrir el lobby del casino del mercado.
2. Iniciar sesión con la cuenta de prueba.
3. Abrir un juego de Pragmatic Play del mercado y entrar en Real Play.
4. Leer el saldo antes de intentar el spin.
5. Intentar un spin.
6. Verificar el mensaje de saldo insuficiente y leer el saldo después.

| Id   | Comprobación                                                                     |
|------|----------------------------------------------------------------------------------|
| S2.1 | El spin se rechaza en vez de completarse como un spin pagado.                     |
| S2.2 | El jugador ve un mensaje de saldo insuficiente adecuado y en el idioma esperado.  |
| S2.3 | La moneda que se muestra es la del mercado.                                       |
| S2.4 | El saldo de Betsson no cambia.                                                    |
| S2.5 | El saldo dentro del juego no cambia.                                              |

El mensaje puede salir dentro del juego del proveedor: se valida lo que ve el jugador.

En total son 4 ejecuciones (2 escenarios × 2 mercados) y 20 comprobaciones.

## Entregables

| Entregable                       | Qué tiene que tener                                                                                                                       |
|----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Código en GitHub                 | El checker bien organizado, con configuración para cada mercado y sin credenciales ni secretos. Specs, page objects o fixtures son ejemplos, no una arquitectura obligatoria. |
| Workflow de GitHub Actions       | Ejecuta los dos escenarios una vez por mercado y publica el informe.                                                                      |
| Informe y evidencias             | PASS/FAIL de cada comprobación, identificada por escenario y mercado, incluidas las de saldo de Betsson. Con capturas, traza o vídeo.      |
| Presentación (solo finalistas)   | 7 minutos el 16 de octubre: una ejecución que funcione y el porqué de las decisiones técnicas.                                            |

Lo que vaya más allá puede dar puntos extra, pero no es obligatorio.

## Evaluación

Cada criterio se puntúa de 1 a 5 y da `(nota ÷ 5) × peso` puntos. La base son 100 puntos; con el bonus, 110.

| Criterio                    | Peso | Qué demuestra un buen resultado                                                                                            |
|-----------------------------|-----:|----------------------------------------------------------------------------------------------------------------------------|
| Los escenarios funcionan    |   30 | Los dos escenarios en los dos mercados, incluidas las comprobaciones del saldo de Betsson.                                 |
| Ve como un jugador          |   20 | Lee la pantalla y verifica la respuesta del juego, en vez de dar por buenos unos clics fijos. OCR, visión e IA son ejemplos. |
| Código y arquitectura       |   15 | Organización clara y mantenible para el enfoque elegido, configuración por mercado y ningún secreto en el repo.             |
| Informe y evidencias        |   15 | PASS/FAIL claro por comprobación, respaldado con capturas, traza o vídeo.                                                  |
| Workflow de GitHub          |   10 | Se ejecuta en GitHub Actions para cada mercado y publica el informe.                                                       |
| Demo                        |   10 | Una demostración clara que funcione y la explicación de las decisiones del equipo.                                          |
| Bonus                       | 0–10 | Trabajo sobresaliente que no cubren los criterios anteriores. Cada punto extra necesita una justificación escrita.          |

La evidencia tiene que estar centrada en el jugador: no basta con que la automatización hiciera clic, hay que enseñar que el juego reaccionó bien, que salió el mensaje esperado cuando tocaba y que el saldo se comportó como debía.

## Calendario

| Cuándo              | Qué                                                                 |
|---------------------|---------------------------------------------------------------------|
| 15/10, 09:45        | Presentación del reto. El aula se publica en el Campus Virtual.     |
| 15/10, 10:15–20:00  | Ventana de desarrollo, con mentores.                                |
| 15/10, 21:45        | Se anuncian los finalistas en el Campus Virtual.                    |
| 16/10, 09:30        | Check-in de finalistas en el Salón de Actos.                        |
| 16/10, desde 10:00  | Presentaciones de finalistas, 7 minutos por equipo.                 |

## Cómo lo entendemos

1. **Se valida una integración, no se buscan juegos nuevos.** El juego da igual mientras sea de Pragmatic Play. Lo que se prueba es que la cuenta y el wallet de Betsson y el juego del proveedor se entienden: la apuesta sale del saldo de Betsson y el premio vuelve a él.
2. **Real Play con login, nada de modo demo.** Sin sesión no hay saldo de Betsson que comparar. Las cuentas son de prueba y las da Betsson; nunca se usa una cuenta personal ni se deposita.
3. **La prueba es lo que se ve.** Hay tres fuentes y cada una tiene su papel:
   - **Canvas del juego:** saldo, apuesta, premio y mensajes, leídos con OCR o visión. Es lo que puntúa en "Ve como un jugador".
   - **Cabecera de Betsson:** es DOM de Betsson, no del juego, así que el saldo se puede leer como texto y además queda en la captura.
   - **Tráfico de red del proveedor:** sirve para contrastar lo leído en pantalla y detectar una mala lectura del OCR, pero no puede ser la única prueba.
4. **La unidad del informe es la comprobación**, no un veredicto único: cada una de las 20 lleva escenario, mercado, PASS/FAIL, valor esperado, valor leído y su captura.
5. **Un mercado es configuración, no código:** URL, idioma, moneda (símbolo y formato de número), locale y zona horaria, textos esperados del mensaje de saldo insuficiente y qué cuenta usar.
6. **Los secretos también se filtran por las evidencias.** La traza de Playwright guarda el texto de cada `fill`, y el vídeo y las capturas pueden enseñar el usuario o el nombre de la cuenta. GitHub enmascara los secrets en los logs, pero no en los artefactos. El login tiene que hacerse fuera de la traza y del vídeo, o enmascarado.
7. **Una cuenta no puede jugar en dos ejecuciones a la vez:** si dos jobs mueven el mismo saldo en paralelo, la regla del saldo deja de cuadrar.
8. **Riesgos sin comprobar:**
   - La cabecera de Betsson puede no actualizar el saldo mientras el juego está abierto.
   - Los casinos suelen bloquear por país y por IP de centro de datos. Estamos en España, betsson.pe es para Perú y los runners de GitHub salen desde centros de datos de Azure.
   - El saldo del juego y el de Betsson pueden no coincidir de partida (bonos, saldo retenido).

## Nuestras anotaciones frente al enunciado

| Anotación                                            | Dónde puntúa                              | Prioridad                     | Cómo lo vemos |
|------------------------------------------------------|-------------------------------------------|-------------------------------|---------------|
| Análisis del frontend con imágenes y capturas        | Ve como un jugador (20)                   | Imprescindible                | Leer saldo, apuesta, premio y mensajes del canvas con OCR o visión. Es el núcleo de las comprobaciones. |
| Inferencia del backend                               | Ve como un jugador (apoyo), informe       | Alta, como contraste          | El tráfico del proveedor hace de oráculo para validar lo leído en pantalla. Pragmatic Play suele usar una petición `gameService` con `action=doSpin` cuya respuesta trae saldo, apuesta y premio (sin comprobar). |
| Generación automática de informes con evidencias     | Informe (15), workflow (10)               | Imprescindible                | Informe por mercado × escenario × comprobación, publicado desde GitHub Actions. |
| Manager de cuentas                                   | Escenarios (30), código (15)              | Necesario, en versión simple  | Elegir la cuenta por mercado y escenario a partir de los secrets, comprobar antes de jugar que el saldo cumple la precondición del escenario y no usar la misma cuenta en dos jobs a la vez. |
| Aprendizaje por juego y por proveedor                | Bonus, código                             | Después de lo imprescindible  | Los juegos de Pragmatic Play comparten interfaz: barra inferior con saldo, apuesta y premio, botón de spin y los mismos diálogos (sin comprobar en Betsson). Encaja un perfil de proveedor que la visión calibra la primera vez y que se guarda por juego. Entrenar un modelo no cabe en el tiempo; guardar lo aprendido, sí. |
| El proveedor puede cambiar mañana: flexible y agnóstico | Ve como un jugador, código, bonus      | Principio de diseño           | Sin coordenadas fijas: localizar cada elemento por su texto o su aspecto (OCR de "CREDIT"/"BET") y usar la IA con visión como respaldo cuando falle. Es también lo que pide el criterio: nada de clics fijos. |
| Desarrollo automático de testbed QA                  | Bonus                                     | Después                       | Interpretación nuestra, a confirmar: ante un juego nuevo, generar solo su perfil (dónde está cada cosa y qué textos esperar) para poder probarlo sin escribir código. |

Orden de trabajo que proponemos: los dos escenarios en un mercado → el segundo mercado por configuración → workflow con informe → bonus.

## Impacto en lo que ya tenemos

El diseño de [diseno.md](diseno.md) y el esqueleto de `bot/` se hicieron antes de tener el enunciado y suponen cosas que ya no valen:

| Suponíamos                                                | El reto pide                                               | Qué cambia |
|-----------------------------------------------------------|------------------------------------------------------------|------------|
| Detectar un juego **nuevo** en el lobby                   | Cualquier juego de **Pragmatic Play**                      | La etapa 2 pasa a elegir un juego de Pragmatic Play (filtro por proveedor o búsqueda). La lógica de "New" sobra. |
| Modo demo, sin login                                      | **Real Play** con cuenta de prueba                         | La etapa 1 añade el login, sin que las credenciales acaben en la traza, el vídeo ni las capturas. |
| Un solo mercado                                           | **betsson.com (EN/EUR) y betsson.pe (ES/PEN)**             | Configuración por mercado en lugar de `LOBBY_URL`, `LOCALE`, `TIMEZONE` y geolocalización fijos en `.env`. |
| Un solo recorrido                                         | **Dos escenarios**                                         | La etapa 4 lee saldos, apuesta, moneda y resultado; en el escenario 2 se espera un rechazo. |
| Veredicto único por tráfico de red; capturas solo de adorno | **PASS/FAIL por comprobación**, verificado **en pantalla** | Hay que revisar la decisión del 14/10: la pantalla pasa a ser la prueba principal y la red, el contraste. Cambia el formato de `run.json`. |
| IA con visión solo como plan B para pulsar el botón       | Leer el canvas es el núcleo                                | OCR o visión pasan a ser pieza principal de las etapas 4 y 5. |
| Ejecución local con Docker                                | **GitHub Actions** por mercado, publicando el informe      | Workflow nuevo, con secrets y con el riesgo de geobloqueo de los runners. |

Sigue valiendo: Playwright en Docker, la sesión compartida que registra red, consola y WebSocket (`bot/browser.py`), `runs/<run_id>/` con traza, vídeo y `report.html`, el casino simulado (le falta simular saldo y saldo insuficiente) y que cada etapa se pueda ejecutar sola.

## Preguntas para los mentores

Ya resueltas por el enunciado: qué web usar, si hace falta login, qué cuenta como PASS y qué se entrega. Lo de "juego nuevo" ya no aplica.

Cuentas:

- [ ] ¿Cómo nos llegan las cuentas? ¿Una por mercado y escenario (4) o compartidas? ¿Una cuenta de betsson.com sirve en betsson.pe?
- [ ] Escenario 2: ¿nos dejáis una cuenta a 0 o vale con poner una apuesta mayor que el saldo?
- [ ] ¿Cuánto saldo tienen y cuántos spins podemos hacer? ¿Se recargan?
- [ ] ¿Pueden saltar límites de juego responsable o verificaciones (KYC) en las cuentas?

Acceso:

- [ ] ¿Desde dónde se puede entrar? betsson.com y betsson.pe pueden bloquear España. ¿Hay lista blanca, VPN o proxy?
- [ ] Los runners de GitHub salen desde centros de datos. ¿Hay IPs permitidas, un proxy o hay que usar un runner propio (self-hosted)?
- [ ] ¿Hay protección anti-bot (Cloudflare, CAPTCHA)? ¿Hay una forma legítima de evitarla?

Saldos:

- [ ] ¿El saldo de la cabecera de Betsson se actualiza con el juego abierto o solo al cerrarlo o recargar?
- [ ] ¿El saldo de Betsson y el del juego deberían coincidir (mismo wallet) o puede haber bonos que los separen?

Entrega:

- [ ] ¿Qué cuenta como "publicar el informe": artefacto del workflow, GitHub Pages o resumen del job?
- [ ] El repo es privado: ¿hay que hacerlo público o basta con dar acceso al jurado?
- [ ] ¿Podemos usar APIs de IA externas? ¿Hay créditos?
