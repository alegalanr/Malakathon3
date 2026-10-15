/**
 * F6: acciones del jugador con Playwright (tecla o clic real) usando el ControlMap (C10).
 */
import type { Page } from '@playwright/test';
import type { ActionRecord, Control } from '../contracts/schemas';
import type { GameHandle } from './GameFrame';

export async function perform(page: Page, game: GameHandle, action: ActionRecord['action'], control: Control): Promise<ActionRecord> {
  const t = Date.now();
  if (control.method === 'key') {
    // El foco tiene que estar en el juego para que la tecla le llegue
    await game.element.focus().catch(() => {});
    await page.keyboard.press(control.key ?? 'Space');
    return { action, method: 'key', key: control.key ?? 'Space', t };
  }
  const p = control.point!;
  const box = (await game.element.boundingBox()) ?? game.box;
  await page.mouse.click(box.x + box.width * p.rx, box.y + box.height * p.ry, { delay: 60 });
  return { action, method: 'click', point: p, t };
}

export const SPACE: Control = { method: 'key', key: 'Space' };
export const ENTER: Control = { method: 'key', key: 'Enter' };
