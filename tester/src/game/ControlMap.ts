/**
 * C8: mapa aprendido por juego (control-maps/<juego>.json), en posiciones relativas al recuadro.
 * Sin datos de usuario. Cada uso se revalida (evento para controles, ancla para zonas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ControlMap } from '../contracts/schemas';

export function controlMapFile(dir: string, game: string) {
  return path.join(dir, `${game.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);
}

export function loadControlMap(dir: string, game: string, viewport: { width: number; height: number }): ControlMap {
  const file = controlMapFile(dir, game);
  if (fs.existsSync(file)) {
    const parsed = ControlMap.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (parsed.success) return { ...parsed.data, game }; // la clave manda (p. ej. mercado + juego), no el nombre guardado
  }
  return { game, viewport, controls: {}, rois: {} };
}

export function saveControlMap(dir: string, map: ControlMap) {
  const ok = ControlMap.parse(map);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(controlMapFile(dir, map.game), JSON.stringify(ok, null, 2) + '\n');
}
