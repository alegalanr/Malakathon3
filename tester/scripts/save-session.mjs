/**
 * Login manual: guarda la sesión de un navegador normal (no automatizado) en el que una persona ha
 * iniciado sesión a mano, para que el tester la reutilice con MANUAL_LOGIN=1.
 *
 * Se ejecuta en el host con Node ≥ 22 y sin dependencias (fetch y WebSocket nativos), porque el
 * navegador con la sesión está en el host:
 *
 *   1. Abrir Edge/Chrome con un perfil aparte y el puerto de depuración:
 *        msedge.exe --remote-debugging-port=9222 --user-data-dir=<carpeta temporal> https://www.betsson.es/inicio
 *   2. Iniciar sesión a mano con la cuenta de prueba (la persona; el script no ve las credenciales).
 *   3. node tester/scripts/save-session.mjs [mercado] [escenario]     (por defecto: es completed-spin)
 *
 * Escribe tester/.auth/<mercado>-<escenario>.json (formato storageState de Playwright; no se sube).
 * No imprime cookies ni valores: solo cuántas ha guardado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [market = 'es', scenario = 'completed-spin'] = process.argv.slice(2);
const port = process.env.CDP_PORT ?? '9222';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const markets = JSON.parse(fs.readFileSync(path.join(root, 'config', 'markets.json'), 'utf8'));
if (!markets[market]) throw new Error(`mercado desconocido: ${market}`);
const baseUrl = markets[market].baseUrl;
const host = new URL(baseUrl).hostname.replace(/^www\./, '');

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`no se puede conectar a ${wsUrl}`)), { once: true });
  });
  return {
    async send(method, params = {}) {
      await open;
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json(), () => {
  throw new Error(`no hay navegador con depuración en el puerto ${port} (¿lo has abierto con --remote-debugging-port=${port}?)`);
});

// Cookies de todo el navegador, filtradas al dominio del mercado
const browser = cdp(version.webSocketDebuggerUrl);
const { cookies: all } = await browser.send('Storage.getCookies');
browser.close();
const sameSite = { Strict: 'Strict', Lax: 'Lax', None: 'None' };
const cookies = all
  .filter((c) => c.domain.replace(/^\./, '').endsWith(host))
  .map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.session ? -1 : c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: sameSite[c.sameSite] ?? 'Lax',
  }));
if (!cookies.length) throw new Error(`no hay cookies de ${host}: ¿has iniciado sesión en esa ventana?`);

// localStorage de la pestaña abierta en el mercado
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const tab = targets.find((t) => t.type === 'page' && t.url.includes(host));
const origins = [];
if (tab) {
  const page = cdp(tab.webSocketDebuggerUrl);
  const { result } = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ origin: location.origin, items: Object.entries(localStorage) })',
    returnByValue: true,
  });
  page.close();
  const { origin, items } = JSON.parse(result.value);
  origins.push({ origin, localStorage: items.map(([name, value]) => ({ name, value })) });
}

const dir = path.join(root, '.auth');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${market}-${scenario}.json`);
fs.writeFileSync(file, JSON.stringify({ cookies, origins }, null, 2));
console.log(`Sesión guardada en tester/.auth/${market}-${scenario}.json: ${cookies.length} cookies de ${host}, localStorage de ${origins.length} origen(es).`);
console.log('Ahora: MANUAL_LOGIN=1 en el escenario (docker compose ... run --rm -e MANUAL_LOGIN=1 tester ...).');
