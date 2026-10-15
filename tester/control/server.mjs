#!/usr/bin/env node
/**
 * Centro de control: landing de la integración (http://localhost:8095). Sin el modo UI de Playwright.
 *  - POST /run?games=A,B&scenario=…&target=mock|real[&confirm=SI]  lanza uno o varios juegos (lote), un proceso por ronda.
 *  - POST /fault?bug=…&win=…   fallo provocado en la maqueta (y reinicio de sus saldos).
 *  - POST /tests?suite=unit|simulated   lanza los tests y publica el resultado de cada uno.
 *  - POST /feed                el validador publica lo que observa (ya censurado) → GET /events (SSE) al panel.
 *  - GET  /api/runs · /api/tests · /api/games · /reports/…
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
const SPECS = { 'completed-spin': 'tests/completed-spin.spec.ts', 'insufficient-balance': 'tests/insufficient-balance.spec.ts' };
const REPORTS = path.join(ROOT, 'reports');
const HISTORY = path.join(REPORTS, 'history');

const clients = new Set();
let history = []; // eventos del run en curso (sin fotogramas), para quien se conecte tarde
let lastFrame = null;
let busy = null; // 'run' | 'tests' | null
let mode = { bug: 'none', win: 'random' };
let current = null;
let mockBoot = null;

/** Las sesiones de la maqueta viven en memoria: si se ha reiniciado, las guardadas ya no valen. */
async function forgetStaleMockSessions() {
  try {
    const { boot } = await (await fetch(`${MOCK}/__boot`)).json();
    if (mockBoot !== null && boot !== mockBoot) for (const s of Object.keys(SPECS)) fs.rmSync(path.join(ROOT, '.auth', `mock-${s}.json`), { force: true });
    if (mockBoot === null) {
      // Primer contacto: si las sesiones son anteriores al arranque de la maqueta, tampoco valen
      for (const s of Object.keys(SPECS)) {
        const f = path.join(ROOT, '.auth', `mock-${s}.json`);
        if (fs.existsSync(f) && fs.statSync(f).mtimeMs < boot) fs.rmSync(f, { force: true });
      }
    }
    mockBoot = boot;
  } catch {
    /* la maqueta no responde: el propio escenario lo dirá */
  }
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const RUNS_FILE = path.join(REPORTS, 'control-runs.json');
const TESTS_FILE = path.join(REPORTS, 'control-tests.json');
let runs = readJson(RUNS_FILE, []);
const tests = readJson(TESTS_FILE, {});
const save = (f, v) => { fs.mkdirSync(REPORTS, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

const slugify = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function broadcast(msg) {
  track(msg);
  if (msg.type === 'frame') lastFrame = msg;
  else if (!['tests-start', 'tests-done'].includes(msg.type)) history.push(msg);
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

/** Tiempo de cada fase (running → ok/failed/skipped) y resultado de cada ronda. */
function track(msg) {
  if (!current) return;
  const sc = current.scenarios.at(-1);
  if (msg.type === 'start') current.scenarios.push({ scenario: msg.scenario, game: msg.game, market: msg.market, startedAt: msg.t, phases: {}, open: {} });
  if (msg.type === 'phase' && sc) {
    if (msg.status === 'running') sc.open[msg.phase] = msg.t;
    else sc.phases[msg.phase] = { status: msg.status, ms: sc.open[msg.phase] ? msg.t - sc.open[msg.phase] : 0, reason: msg.reason };
  }
  if (msg.type === 'done' && sc) Object.assign(sc, { run: msg.run, pass: msg.ok, passed: msg.passed, checks: msg.checks, endedAt: msg.t });
}

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)); });
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jsonl': 'text/plain; charset=utf-8' };

// ------------------------------------------------------------------------------------------ rondas
function run({ games, scenarios, target }) {
  history = [];
  lastFrame = null;
  busy = 'run';
  current = { id: Date.now(), at: new Date().toISOString(), target, mode: target === 'mock' ? { ...mode } : null, games, scenarios: [], notices: [] };
  const queue = games.flatMap((game) => scenarios.map((scenario) => ({ game, scenario })));
  broadcast({ type: 'run', t: Date.now(), target, jobs: queue });
  const next = () => {
    const job = queue.shift();
    if (!job) {
      busy = null;
      const rec = { ...current, durationMs: Date.now() - current.id, scenarios: current.scenarios.map(({ open, ...x }) => x) };
      rec.pass = rec.scenarios.length > 0 && rec.scenarios.every((x) => x.pass) && rec.notices.length === 0;
      runs.push(rec);
      runs = runs.slice(-100);
      save(RUNS_FILE, runs);
      current = null;
      broadcast({ type: 'idle', t: Date.now(), summary: rec });
      return;
    }
    const market = target === 'real' ? 'es' : 'mock';
    const startedBefore = current.scenarios.length;
    broadcast({ type: 'job', t: Date.now(), ...job, left: queue.length });
    let out = '';
    const child = spawn('npx', ['playwright', 'test', `--project=${market}`, SPECS[job.scenario], '--reporter=line'], {
      cwd: ROOT,
      env: {
        ...process.env,
        MARKET: market,
        RUN_MODE: 'real',
        LIVE_URL: `http://localhost:${PORT}`,
        REUSE_SESSION: '1',
        LOGIN_SCENARIOS: job.scenario,
        GAME_NAME: job.game,
        GAME_SEARCH: job.game,
        GAME_PATH: `/casino/tragaperras-slots/${slugify(job.game)}`,
      },
    });
    const collect = (d) => { out = (out + d.toString()).slice(-4000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', (code) => {
      const sc = current.scenarios.length > startedBefore ? current.scenarios.at(-1) : null;
      // Copia del informe: el siguiente juego del lote sobrescribe reports/<mercado>-<escenario>/
      if (sc?.run && fs.existsSync(path.join(REPORTS, sc.run))) {
        const dst = path.join(HISTORY, `${current.id}-${current.scenarios.length}-${sc.run}`);
        fs.mkdirSync(HISTORY, { recursive: true });
        fs.cpSync(path.join(REPORTS, sc.run), dst, { recursive: true });
        sc.report = path.relative(REPORTS, dst).split(path.sep).join('/');
      }
      if (sc?.phases?.F1?.status === 'failed') fs.rmSync(path.join(ROOT, '.auth', `${market}-${job.scenario}.json`), { force: true });
      if (!sc) {
        // No llegó a empezar: sin credenciales (skipped), login fallido o error del proceso
        const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
        const why = (clean.match(/(Faltan [^\n]+|Login [^\n]*fallido[^\n]*|✘ [^\n]+|Error: [^\n]+)/) ?? [])[0] ?? (/skipped/.test(clean) ? 'el escenario se ha saltado' : `el proceso terminó con código ${code}`);
        const notice = { game: job.game, scenario: job.scenario, text: why.trim().slice(0, 300) };
        current.notices.push(notice);
        broadcast({ type: 'notice', t: Date.now(), ...notice });
      }
      broadcast({ type: 'exit', t: Date.now(), scenario: job.scenario, game: job.game, code });
      next();
    });
  };
  next();
}

// ------------------------------------------------------------------------------------------ tests
function flattenSuites(suites, file = '') {
  const out = [];
  for (const s of suites ?? []) {
    const f = s.file ?? file;
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const r = t.results?.at(-1) ?? {};
        out.push({
          file: f,
          title: spec.title,
          status: t.status === 'expected' ? 'passed' : t.status === 'skipped' ? 'skipped' : 'failed',
          ms: r.duration ?? 0,
          error: (r.error?.message ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n')[0].slice(0, 200),
        });
      }
    }
    out.push(...flattenSuites(s.suites, f));
  }
  return out;
}

function runTests(suite) {
  busy = 'tests';
  const outFile = path.join(REPORTS, `tests-${suite}.json`);
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.rmSync(outFile, { force: true });
  const t0 = Date.now();
  broadcast({ type: 'tests-start', t: t0, suite });
  const child = spawn('npx', ['playwright', 'test', `--project=${suite === 'unit' ? 'unit' : 'es'}`, '--reporter=json'], {
    cwd: ROOT,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile, SKIP_LOGIN: '1', ...(suite === 'simulated' ? { RUN_MODE: 'simulated', MARKET: 'es' } : {}) },
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.on('exit', (code) => {
    const report = readJson(outFile, null);
    const list = report ? flattenSuites(report.suites) : [];
    const result = {
      suite,
      at: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      code,
      passed: list.filter((x) => x.status === 'passed').length,
      failed: list.filter((x) => x.status === 'failed').length,
      skipped: list.filter((x) => x.status === 'skipped').length,
      tests: list,
    };
    tests[suite] = result;
    save(TESTS_FILE, tests);
    busy = null;
    broadcast({ type: 'tests-done', t: Date.now(), result });
  });
}

// ------------------------------------------------------------------------------------------ HTTP
const json = (res, v, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(v));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(ROOT, 'control', 'index.html')));
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', busy, mode })}\n\n`);
      for (const m of history) res.write(`data: ${JSON.stringify(m)}\n\n`);
      if (lastFrame) res.write(`data: ${JSON.stringify(lastFrame)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/feed' && req.method === 'POST') {
      try { broadcast(JSON.parse(await body(req))); } catch { /* mensaje inválido */ }
      return res.end('ok');
    }
    if (url.pathname === '/run' && req.method === 'POST') {
      if (busy) return json(res, { error: busy === 'run' ? 'ya hay una ejecución en curso' : 'se están ejecutando los tests' }, 409);
      const target = q.get('target') === 'real' ? 'real' : 'mock';
      if (target === 'real' && q.get('confirm') !== 'SI') return json(res, { error: 'el destino real necesita confirmación' }, 400);
      const games = (q.get('games') ?? 'Bubble Up').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 10);
      const sc = q.get('scenario') ?? 'completed-spin';
      const scenarios = sc === 'all' ? Object.keys(SPECS) : [sc in SPECS ? sc : 'completed-spin'];
      if (target === 'mock') await forgetStaleMockSessions();
      run({ games: games.length ? games : ['Bubble Up'], scenarios, target });
      return json(res, { ok: true });
    }
    if (url.pathname === '/fault' && req.method === 'POST') {
      const p = new URLSearchParams({ bug: q.get('bug') ?? 'none', win: q.get('win') ?? 'random', reset: '1' });
      try {
        const r = await fetch(`${MOCK}/__mock?${p}`, { method: 'POST' });
        mode = JSON.parse(await r.text());
        broadcast({ type: 'fault', t: Date.now(), mode });
        return json(res, mode);
      } catch (e) {
        return json(res, { error: `la maqueta no responde: ${e.message}` }, 502);
      }
    }
    if (url.pathname === '/tests' && req.method === 'POST') {
      if (busy) return json(res, { error: 'hay otra ejecución en curso' }, 409);
      runTests(q.get('suite') === 'simulated' ? 'simulated' : 'unit');
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/runs' && req.method === 'DELETE') {
      if (busy) return json(res, { error: 'hay una ejecución en curso' }, 409);
      runs = [];
      save(RUNS_FILE, runs);
      fs.rmSync(HISTORY, { recursive: true, force: true });
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/runs') return json(res, runs.slice().reverse());
    if (url.pathname === '/api/tests') return json(res, tests);
    if (url.pathname === '/api/games') {
      try { return json(res, await (await fetch(`${MOCK}/__games`)).json()); } catch { return json(res, []); }
    }
    if (url.pathname.startsWith('/reports/')) {
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(REPORTS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
