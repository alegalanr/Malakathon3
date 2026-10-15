#!/usr/bin/env node
/**
 * Centro de control: panel en directo del tester (http://localhost:8095).
 *  - POST /run?scenario=…   lanza el escenario (modo real) contra la maqueta, con LIVE_URL apuntando aquí.
 *  - POST /fault?bug=…&win=… cambia el fallo provocado de la maqueta (y reinicia sus saldos).
 *  - POST /feed             el tester publica lo que observa (fases, eventos, red, cartera, OCR, checks, fotogramas).
 *  - GET  /events           el panel lo recibe en directo (Server-Sent Events).
 *  - GET  /reports/…        informes y recortes del OCR.
 *  - GET  /api/runs         historial de ejecuciones (duración, tiempo por fase, fallo provocado, resultado).
 * Sin dependencias: node control/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8095;
const MOCK = process.env.MOCK_URL ?? 'http://mock:8090';
const SCENARIOS = { 'completed-spin': 'tests/completed-spin.spec.ts', 'insufficient-balance': 'tests/insufficient-balance.spec.ts' };

const clients = new Set();
let history = []; // eventos del run en curso (sin fotogramas), para quien se conecte tarde
let lastFrame = null;
let running = null;
let mode = { bug: 'none', win: 'random' };
let current = null; // ejecución en curso: se guarda en el historial al terminar

const RUNS_FILE = path.join(ROOT, 'reports', 'control-runs.json');
const loadRuns = () => { try { return JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')); } catch { return []; } };
let runs = loadRuns();
const saveRuns = () => { fs.mkdirSync(path.dirname(RUNS_FILE), { recursive: true }); fs.writeFileSync(RUNS_FILE, JSON.stringify(runs.slice(-50), null, 2)); };

/** Duración de cada fase a partir de los eventos running → ok/failed/skipped. */
function track(msg) {
  if (!current) return;
  const sc = current.scenarios[current.scenarios.length - 1];
  if (msg.type === 'start') current.scenarios.push({ scenario: msg.scenario, startedAt: msg.t, phases: {}, open: {} });
  if (msg.type === 'phase' && sc) {
    if (msg.status === 'running') sc.open[msg.phase] = msg.t;
    else sc.phases[msg.phase] = { status: msg.status, ms: sc.open[msg.phase] ? msg.t - sc.open[msg.phase] : 0, reason: msg.reason };
  }
  if (msg.type === 'done' && sc) Object.assign(sc, { run: msg.run, pass: msg.ok, passed: msg.passed, checks: msg.checks, endedAt: msg.t });
}

function broadcast(msg) {
  track(msg);
  if (msg.type === 'frame') lastFrame = msg;
  else history.push(msg);
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)); });
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jsonl': 'text/plain; charset=utf-8' };

function run(list) {
  history = [];
  lastFrame = null;
  current = { id: Date.now(), at: new Date().toISOString(), mode: { ...mode }, requested: list, scenarios: [] };
  broadcast({ type: 'run', t: Date.now(), scenarios: list });
  const queue = [...list];
  const next = () => {
    const sc = queue.shift();
    if (!sc) {
      running = null;
      const rec = { ...current, durationMs: Date.now() - current.id, scenarios: current.scenarios.map(({ open, ...x }) => x) };
      rec.pass = rec.scenarios.length > 0 && rec.scenarios.every((x) => x.pass);
      runs.push(rec);
      saveRuns();
      current = null;
      broadcast({ type: 'idle', t: Date.now(), summary: rec });
      return;
    }
    running = spawn('npx', ['playwright', 'test', '--project=mock', SCENARIOS[sc], '--reporter=line'], {
      cwd: ROOT,
      // Sin el UI de Playwright: un proceso por escenario, sesión reutilizada y login solo de la cuenta necesaria
      env: { ...process.env, MARKET: 'mock', RUN_MODE: 'real', LIVE_URL: `http://localhost:${PORT}`, REUSE_SESSION: '1', LOGIN_SCENARIOS: sc },
    });
    running.stdout.on('data', () => {});
    running.stderr.on('data', () => {});
    running.on('exit', (code) => {
      // Si la sesión reutilizada ya no vale (F1 falló), se borra para que la siguiente ejecución haga login
      const f1 = current?.scenarios.at(-1)?.phases?.F1;
      if (f1?.status === 'failed') fs.rmSync(path.join(ROOT, '.auth', `mock-${sc}.json`), { force: true });
      broadcast({ type: 'exit', t: Date.now(), scenario: sc, code });
      next();
    });
  };
  next();
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(ROOT, 'control', 'index.html')));
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', running: !!running })}\n\n`);
      for (const m of history) res.write(`data: ${JSON.stringify(m)}\n\n`);
      if (lastFrame) res.write(`data: ${JSON.stringify(lastFrame)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/feed' && req.method === 'POST') {
      try {
        broadcast(JSON.parse(await body(req)));
      } catch {
        /* mensaje inválido */
      }
      return res.end('ok');
    }
    if (url.pathname === '/run' && req.method === 'POST') {
      if (running) {
        res.writeHead(409);
        return res.end('ya hay una ejecución en curso');
      }
      const sc = url.searchParams.get('scenario') ?? 'completed-spin';
      run(sc === 'all' ? Object.keys(SCENARIOS) : [sc in SCENARIOS ? sc : 'completed-spin']);
      return res.end('ok');
    }
    if (url.pathname === '/fault' && req.method === 'POST') {
      const q = new URLSearchParams({ bug: url.searchParams.get('bug') ?? 'none', win: url.searchParams.get('win') ?? 'random', reset: '1' });
      try {
        const r = await fetch(`${MOCK}/__mock?${q}`, { method: 'POST' });
        mode = JSON.parse(await r.text());
        broadcast({ type: 'fault', t: Date.now(), mode });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(mode));
      } catch (e) {
        res.writeHead(502);
        return res.end(`la maqueta no responde: ${e.message}`);
      }
    }
    if (url.pathname === '/api/runs') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(runs.slice(-30).reverse()));
    }
    if (url.pathname.startsWith('/reports/')) {
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(path.join(ROOT, 'reports')) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('no encontrado');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404);
    res.end('no encontrado');
  })
  .listen(PORT, () => console.log(`Centro de control en http://localhost:${PORT}`));
