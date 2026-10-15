/**
 * Segunda fuente: lo que el juego le pide a su servidor y lo que este responde.
 * Pragmatic: POST …/gameService con action=doSpin / doCollect y respuesta "clave=valor&…".
 * Solo se lee el tráfico que ya hace la página; no se envía nada.
 */
import type { BrowserContext, Response } from '@playwright/test';
import { toNumber } from '../money';
import type { Timeline } from '../evidence/timeline';

export interface ServerCall {
  t: number;
  action: string;
  bet?: number; // c × l
  balance?: number;
  win?: number; // tw
  rid?: string;
  next?: string; // na: c = falta collect, s = listo
  status: number;
}

const parse = (s: string | null) => new URLSearchParams(s ?? '');

export class GameServerTap {
  readonly calls: ServerCall[] = [];

  constructor(private timeline: Timeline) {}

  attach(context: BrowserContext) {
    context.on('response', (r) => void this.onResponse(r));
  }

  private async onResponse(r: Response) {
    if (!/gameService/i.test(r.url())) return;
    const t = Date.now();
    const req = parse(r.request().postData());
    const action = req.get('action') ?? '?';
    if (!/^do(Spin|Collect|Init)$/i.test(action)) return;
    let body = '';
    try {
      body = await r.text();
    } catch {
      /* la respuesta puede no estar disponible si la página se ha cerrado */
    }
    const res = parse(body);
    const c = toNumber(req.get('c'));
    const l = toNumber(req.get('l'));
    const call: ServerCall = {
      t,
      action,
      bet: c !== undefined && l !== undefined ? +(c * l).toFixed(2) : undefined,
      balance: toNumber(res.get('balance')),
      win: toNumber(res.get('tw')),
      rid: res.get('rid') ?? undefined,
      next: res.get('na') ?? undefined,
      status: r.status(),
    };
    this.calls.push(call);
    this.timeline.add('network', { ...call, url: r.url() }, t);
    console.log(`  ⇠ red ${action}${call.bet !== undefined ? ` apuesta=${call.bet}` : ''}${call.balance !== undefined ? ` saldo=${call.balance}` : ''}${call.win !== undefined ? ` premio=${call.win}` : ''}`);
  }

  first(action: string, after: number): ServerCall | undefined {
    return this.calls.find((c) => c.action === action && c.t >= after);
  }
}
