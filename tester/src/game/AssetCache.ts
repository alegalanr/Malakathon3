/**
 * Caché en disco de los recursos estáticos del juego (lo que hace la caché de un navegador normal).
 * ✔ (15/10) Bubble Up pide ~53 ficheros main_resources*.json (~30 MB) a la vez; con el navegador del tester
 * vacío en cada ejecución tardaban 60-130 s y la carga se quedaba en el 50 %. Las URLs llevan versión
 * (?key=…), así que el contenido de una URL no cambia: se guarda la primera vez y luego se sirve de disco.
 * Solo GET de rutas estáticas de Pragmatic; nunca peticiones con sesión (gameService, playGame…).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';

const STATIC = /\/gs2c\/common\/(v3\/games-html5|js)\/|\/apps\/shell\/static\//;
const KEEP_HEADERS = ['content-type', 'cache-control', 'access-control-allow-origin', 'timing-allow-origin'];

interface Meta {
  status: number;
  headers: Record<string, string>;
}

export class AssetCache {
  readonly stats = { hits: 0, misses: 0, bytesFromDisk: 0 };

  constructor(private dir: string) {}

  async attach(context: BrowserContext) {
    fs.mkdirSync(this.dir, { recursive: true });
    await context.route(STATIC, (route) => this.handle(route));
  }

  private file(url: string) {
    return path.join(this.dir, crypto.createHash('sha1').update(url).digest('hex'));
  }

  private async handle(route: Route) {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    const url = req.url();
    const f = this.file(url);
    const origin = req.headers()['origin'];
    try {
      if (fs.existsSync(f) && fs.existsSync(f + '.json')) {
        const meta: Meta = JSON.parse(fs.readFileSync(f + '.json', 'utf8'));
        const body = fs.readFileSync(f);
        const headers = { ...meta.headers };
        // CORS: se responde al origen que pregunta (el del juego), como haría el servidor
        if (headers['access-control-allow-origin'] && origin) headers['access-control-allow-origin'] = origin;
        this.stats.hits++;
        this.stats.bytesFromDisk += body.length;
        return route.fulfill({ status: meta.status, headers, body });
      }
    } catch {
      /* caché corrupta: se descarga otra vez */
    }
    const res = await route.fetch().catch(() => null);
    if (!res) return route.fallback();
    this.stats.misses++;
    if (res.status() === 200) {
      const body = await res.body();
      const all = res.headers();
      const headers: Record<string, string> = {};
      for (const k of KEEP_HEADERS) if (all[k]) headers[k] = all[k];
      try {
        fs.writeFileSync(f, body);
        fs.writeFileSync(f + '.json', JSON.stringify({ status: 200, headers } satisfies Meta));
      } catch {
        /* sin disco: se sirve igual */
      }
    }
    return route.fulfill({ response: res });
  }
}
