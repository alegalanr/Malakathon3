/**
 * Descubre los controles sin coordenadas fijas (SOLUCION.md §3.4):
 * teclado → barrido con el ratón sin clics → clic y clasificación por el evento que llega.
 *
 * Prudencia (dinero real): solo con el juego en reposo; nunca se confirma una ventana (Escape);
 * como mucho MAX_CLICKS clics de prueba; se para en cuanto empieza una ronda.
 */
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ActionRecord, Control, StandardEvent } from '../contracts/schemas';
import type { Evidence } from '../evidence/Evidence';
import { changedFraction, type GameHandle } from './GameFrame';
import type { GameEventBus } from './GameEventBus';
import { ENTER, perform } from './GameControls';

const COLS = 12;
const ROWS = 8;
const MAX_CLICKS = 6;

interface Candidate {
  rx: number;
  ry: number;
  area: number;
}

export interface ExploreResult {
  spin?: { control: Control; action: ActionRecord; started: StandardEvent };
  betUp?: Control;
  betDown?: Control;
  notes: string[];
}

export class GameExplorer {
  constructor(
    private page: Page,
    private game: GameHandle,
    private bus: GameEventBus,
    private ev: Evidence,
  ) {}

  private async shot(): Promise<Buffer> {
    const b = (await this.game.element.boundingBox()) ?? this.game.box;
    return this.page.screenshot({ clip: b, animations: 'allow' });
  }

  /** Paso 2 bis: Enter (Espacio ya lo ha probado el escenario). */
  async tryEnter(timeoutMs: number): Promise<ExploreResult['spin']> {
    const action = await perform(this.page, this.game, 'spin', ENTER);
    this.ev.log('action', 'spin', 'tecla Enter (explorador)', action, action.t);
    const started = await this.bus.tryWaitFor('ROUND_STARTED', { after: action.t, timeoutMs });
    return started ? { control: ENTER, action, started } : undefined;
  }

  /** Paso 3: barrido sin clics. Donde la imagen cambia al pasar el ratón (descontando el ruido de fondo), hay algo interactivo. */
  async sweep(): Promise<Candidate[]> {
    const box = (await this.game.element.boundingBox()) ?? this.game.box;
    await this.page.mouse.move(2, 2);
    await this.page.waitForTimeout(300);
    const base1 = PNG.sync.read(await this.shot());
    await this.page.waitForTimeout(250);
    const base2 = PNG.sync.read(await this.shot());
    const w = base1.width;
    const h = base1.height;
    const noisy = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) noisy[i] = diff(base1, base2, i) > 40 ? 1 : 0;

    const hits: { c: number; r: number; score: number }[] = [];
    const rad = Math.round(Math.min(w / COLS, h / ROWS) / 2);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const rx = (c + 0.5) / COLS;
        const ry = (r + 0.5) / ROWS;
        await this.page.mouse.move(box.x + rx * box.width, box.y + ry * box.height);
        await this.page.waitForTimeout(120);
        const img = PNG.sync.read(await this.shot());
        const cx = Math.round(rx * w);
        const cy = Math.round(ry * h);
        let changed = 0;
        let total = 0;
        for (let y = Math.max(0, cy - rad); y < Math.min(h, cy + rad); y++) {
          for (let x = Math.max(0, cx - rad); x < Math.min(w, cx + rad); x++) {
            const i = y * w + x;
            if (noisy[i]) continue;
            total++;
            if (diff(base1, img, i) > 40) changed++;
          }
        }
        const score = total ? changed / total : 0;
        if (score > 0.06) hits.push({ c, r, score });
      }
    }
    await this.page.mouse.move(2, 2);
    // Paso 4: agrupar celdas vecinas y ordenar: grandes y en la parte baja primero
    const groups: { c: number; r: number }[][] = [];
    const seen = new Set<string>();
    for (const hcell of hits) {
      const k = `${hcell.c},${hcell.r}`;
      if (seen.has(k)) continue;
      const group: { c: number; r: number }[] = [];
      const stack = [hcell];
      while (stack.length) {
        const cur = stack.pop()!;
        const key = `${cur.c},${cur.r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        group.push(cur);
        for (const n of hits) if (Math.abs(n.c - cur.c) + Math.abs(n.r - cur.r) === 1 && !seen.has(`${n.c},${n.r}`)) stack.push(n);
      }
      groups.push(group);
    }
    const cands = groups.map((g) => ({
      rx: g.reduce((s, x) => s + (x.c + 0.5) / COLS, 0) / g.length,
      ry: g.reduce((s, x) => s + (x.r + 0.5) / ROWS, 0) / g.length,
      area: g.length,
    }));
    cands.sort((a, b) => b.area - a.area || b.ry - a.ry);
    this.ev.log('screen', 'barrido', `${hits.length} celdas reaccionan al ratón → ${cands.length} zonas candidatas`, cands);
    return cands;
  }

  /** Paso 5: clic en cada candidato y clasificación por evento. Se para al descubrir el giro. */
  async classify(cands: Candidate[], timeoutMs: number): Promise<ExploreResult> {
    const res: ExploreResult = { notes: [] };
    for (const cand of cands.slice(0, MAX_CLICKS)) {
      if (this.bus.state.roundInProgress) break;
      const control: Control = { method: 'click', point: { rx: round(cand.rx), ry: round(cand.ry) } };
      const before = await this.shot();
      const prevBet = this.bus.state.currentBet;
      const action = await perform(this.page, this.game, 'spin', control);
      this.ev.log('action', 'clic de prueba', `(${control.point!.rx}, ${control.point!.ry})`, action, action.t);
      const started = await this.bus.tryWaitFor('ROUND_STARTED', { after: action.t, timeoutMs });
      if (started) {
        res.spin = { control: { ...control, validatedAt: started.t }, action, started };
        res.notes.push('girar = clic validado por ROUND_STARTED');
        break;
      }
      const bet = this.bus.between('BET_CHANGED', action.t).at(-1);
      if (bet && prevBet !== undefined && bet.data.bet !== undefined) {
        const kind = bet.data.bet < prevBet ? 'betDown' : 'betUp';
        res[kind] = { ...control, validatedAt: bet.t };
        res.notes.push(`${kind} = clic validado por BET_CHANGED`);
        continue;
      }
      const after = await this.shot();
      if (changedFraction(before, after) > 0.25) {
        await this.page.keyboard.press('Escape'); // menú o ventana: nunca se confirma
        res.notes.push('un clic abrió una ventana: cerrada con Escape');
        await this.page.waitForTimeout(500);
      }
    }
    return res;
  }
}

function diff(a: PNG, b: PNG, i: number) {
  const k = i * 4;
  return Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
}

const round = (v: number) => Math.round(v * 1000) / 1000;
