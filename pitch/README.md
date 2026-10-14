# Pitch

Carpeta de quien prepara la presentación: borrador, guion, diapositivas, imágenes y `evidencias/`.

## De dónde sacar el material

| Qué                                     | Dónde                                                                                  |
|-----------------------------------------|----------------------------------------------------------------------------------------|
| Qué funciona                            | [ESTADO.md](../ESTADO.md)                                                              |
| Cómo funciona y por qué se decidió así  | [docs/diseno.md](../docs/diseno.md)                                                    |
| Cómo ha ido el día y qué problemas hubo | [PRs fusionados](https://github.com/alegalanr/Malakathon3/pulls?q=is%3Apr+is%3Amerged) |
| Capturas, trazas y números              | `runs/` de cualquier ejecución y `evidencias/`                                         |

Con Claude Code, `/pitch` lo lee todo y deja un resumen en `pitch/material.md`.

## Estructura sugerida

1. **Problema:** cada juego nuevo se prueba a mano; es lento, no escala y no deja rastro.
2. **Solución:** una frase.
3. **Demo.**
4. **Cómo funciona:** las 5 etapas y por qué el veredicto es fiable.
5. **Resultados:** tiempo y coste por juego, juegos probados, fallos detectados.
6. **Próximos pasos.**

## Demo

- Grabar el vídeo del plan B **en cuanto haya un run bueno**, no al final.
- Antes de salir: imagen Docker ya construida, internet de la sala probado y un run de calentamiento.
- Si se puede, enseñar también un FAIL provocado (ver [docs/diseno.md](../docs/diseno.md)).
- Tapar cualquier dato personal en las capturas que se copien a `evidencias/`.
