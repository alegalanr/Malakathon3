#!/usr/bin/env node
/**
 * Maqueta local de Betsson + Pragmatic Play para demostrar el tester de punta a punta en modo REAL
 * (mismo código que contra betsson.es). Reproduce lo verificado por el equipo (SOLUCION.md §2):
 *
 *   :8090  Betsson: banner OneTrust, login (/inicio), lobby con buscador, página del juego con «Jugar»,
 *          sesión de juego DGOJ y /api/v2/wallet/balance (la página la consulta cada 5 s).
 *   :8091  Proveedor: juego en canvas dentro de un iframe de OTRO origen, eventos postMessage al padre
 *          (con las trampas reales: valores arrastrados en el inicio y updateBalance en céntimos) y
 *          POST /gs2c/ge/v5/gameService (doSpin / doCollect) contra el mismo wallet.
 *
 * Sin dependencias: node mock/server.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';

const SITE_PORT = 8090;
const GAME_PORT = 8091;
const SENDER = 'vs20bblup_cv116';
const BET = { c: 0.05, l: 20 }; // 1,00 €

const accounts = {
  [process.env.MOCK_USER ?? 'qa-demo']: { pass: process.env.MOCK_PASS ?? 'mock-1234', balance: 10000 },
  [process.env.MOCK_EMPTY_USER ?? 'qa-empty']: { pass: process.env.MOCK_EMPTY_PASS ?? 'mock-1234', balance: 50 },
};
const INITIAL = Object.fromEntries(Object.entries(accounts).map(([u, a]) => [u, a.balance]));
const sessions = new Map(); // cookie → usuario
const tokens = new Map(); // token del juego (mgckey) → usuario
const pending = new Map(); // usuario → premio pendiente de doCollect (céntimos)
let ridSeq = 658268119;
// Modo demo, ajustable en caliente: POST /__mock?win=always|never|random&bug=none|no-credit|currency|lang
const mode = { win: 'random', bug: 'none' };

const eur = (c) => (c / 100).toFixed(2);
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((p) => p.split('=')));
const userOf = (req) => sessions.get(cookies(req).session);
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)); });
const send = (res, status, type, data, headers = {}) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(data); };
const host = (req) => (req.headers.host ?? `localhost:${SITE_PORT}`).split(':')[0];

// ------------------------------------------------------------------------------------------- Betsson
const GAMES = [
  ['Bubble Up', 'bubble-up', 'Pragmatic Play'],
  ['Sweet Bonanza', 'sweet-bonanza', 'Pragmatic Play'],
  ['Big Bass Splash', 'big-bass-splash', 'Pragmatic Play'],
  ['Starburst', 'starburst', 'NetEnt'],
  ['Book of Dead', 'book-of-dead', "Play'n GO"],
];

function layout(req, content, title) {
  const user = userOf(req);
  const consent = cookies(req).OptanonAlertBoxClosed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title} | Betsson (maqueta)</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#12151c;color:#eee}header{display:flex;gap:12px;align-items:center;padding:10px 20px;background:#1b1f29}
.logo{color:#ff6a00;font-weight:800;font-size:22px;margin-right:auto}fds-button,button,.btn{display:inline-block;cursor:pointer;border:1px solid #ff6a00;border-radius:6px;padding:6px 14px;background:transparent;color:#fff;font:inherit}
.primary{background:#ff6a00}gaming-discovery-search-button{cursor:pointer;border:1px solid #555;border-radius:6px;padding:6px 14px}main{padding:20px}
.grid{display:grid;grid-template-columns:repeat(5,180px);gap:14px}.tile{display:block;background:#222836;border-radius:10px;padding:14px;color:#eee;text-decoration:none}
.tile small{color:#999}#search{margin:12px 0}#search input{width:420px;padding:8px;font-size:16px}#results a{display:block;padding:6px;color:#ffb380}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}.card{background:#fff;color:#222;border-radius:12px;padding:24px;width:420px}
.card label{display:block;margin-top:12px;font-size:13px}.card input{width:100%;padding:8px;font-size:16px;box-sizing:border-box}.error{background:#fde0e0;color:#a00;padding:8px;border-radius:6px;margin-top:12px}
#onetrust-banner-sdk{position:fixed;bottom:0;left:0;right:0;background:#2b2f3a;padding:14px;display:flex;gap:10px;align-items:center}
#onetrust-pc-sdk{position:fixed;bottom:70px;right:20px;background:#fff;color:#222;padding:16px;border-radius:8px}
#game{width:1100px;height:620px;border:0;display:block}
</style></head><body>
<header><span class="logo">betsson <small style="font-size:12px;color:#888">maqueta</small></span>
<gaming-discovery-search-button>🔍 Buscar juegos</gaming-discovery-search-button>
${user ? `<span>Saldo: <strong id="balance">…</strong></span><span>${user}</span>` : '<fds-button id="login">Iniciar sesión</fds-button><fds-button class="primary">Crear cuenta</fds-button>'}
</header>
<div id="search" hidden><input placeholder="Búsqueda de juegos y proveedores" autocomplete="off"><div id="results"></div></div>
<main>${content}</main>
${consent ? '' : `<div id="onetrust-banner-sdk">Usamos cookies. <button id="onetrust-pc-btn-handler">Configuración de cookies</button><button id="onetrust-accept-btn-handler">Aceptar todas las cookies</button>
<div id="onetrust-pc-sdk" hidden><button class="ot-pc-refuse-all-handler">Rechazarlas todas</button></div></div>`}
<script>
const GAMES=${JSON.stringify(GAMES)};
const q=(s)=>document.querySelector(s);
q('#login')?.addEventListener('click',()=>location.href='/inicio?returnUrl='+encodeURIComponent(location.pathname));
q('gaming-discovery-search-button').addEventListener('click',()=>{q('#search').hidden=false;q('#search input').focus()});
q('#search input').addEventListener('input',(e)=>{const t=e.target.value.toLowerCase();q('#results').innerHTML=t?GAMES.filter(g=>g[0].toLowerCase().includes(t)||g[2].toLowerCase().includes(t)).map(g=>'<a href="/casino/tragaperras-slots/'+g[1]+'">'+g[0]+' · '+g[2]+'</a>').join(''):''});
q('#onetrust-pc-btn-handler')?.addEventListener('click',()=>q('#onetrust-pc-sdk').hidden=false);
const close=()=>{document.cookie='OptanonAlertBoxClosed=1;path=/';q('#onetrust-banner-sdk').remove()};
q('.ot-pc-refuse-all-handler')?.addEventListener('click',close);q('#onetrust-accept-btn-handler')?.addEventListener('click',close);
async function wallet(){try{const r=await fetch('/api/v2/wallet/balance');if(r.ok){const j=await r.json();q('#balance').textContent=j.balance.totalAmount.toFixed(2).replace('.',',')+' €'}}catch{}}
if(q('#balance')){wallet();setInterval(wallet,5000)}
</script>${req.extraScript ?? ''}</body></html>`;
}

function lobby(req) {
  return layout(req, `<h2>Casino</h2><div class="grid">${GAMES.map((g) => `<a class="tile" href="/casino/tragaperras-slots/${g[1]}">${g[0]}<br><small>${g[2]}</small></a>`).join('')}</div>`, 'Casino');
}

function loginPage(req, url, error = '') {
  const ret = url.searchParams.get('returnUrl') ?? '/casino';
  return layout(req, `<div class="modal"><form class="card" method="post" action="/login?returnUrl=${encodeURIComponent(ret)}">
<h3>Inicia sesión con tu cuenta</h3>
<label>Usuario/email<input type="text" name="username" autocomplete="username"></label>
<label>Contraseña<input type="password" name="password" autocomplete="current-password"></label>
${error ? `<div class="error">${error}</div>` : ''}
<p><button type="submit" class="btn primary">Entrar</button></p></form></div>`, 'Inicio de sesión');
}

function gamePage(req, url, slug) {
  const user = userOf(req);
  const game = GAMES.find((g) => g[1] === slug) ?? GAMES[0];
  const token = user ? crypto.randomBytes(8).toString('hex') : '';
  if (user) tokens.set(token, user);
  const src = `http://${host(req)}:${GAME_PORT}/game?symbol=${SENDER}&mgckey=AUTHTOKEN@${token}&lang=es&cur=EUR`;
  req.extraScript = `<script>
function openGame(){document.getElementById('slot').innerHTML='<iframe id="game" src="${src}"></iframe>'}
function dgoj(){document.body.insertAdjacentHTML('beforeend','<div class="modal" id="dgoj" role="dialog"><div class="card"><h3>Sesión de juego</h3><p>Límite de tiempo: 60 min · Límite de gasto: 50 €</p><fds-button class="primary" id="start">Empezar</fds-button></div></div>');
document.getElementById('start').onclick=()=>{document.getElementById('dgoj').remove();openGame()}}
document.getElementById('play')?.addEventListener('click',dgoj);
if(new URLSearchParams(location.search).get('gameAction')==='play'&&${!!user})dgoj();
</script>`;
  return layout(req, `<h2>${game[0]} <small style="color:#999">${game[2]}</small></h2>
${user ? '<p><fds-button class="primary" id="play">Jugar</fds-button> <fds-button id="demo">Jugar demo</fds-button></p>' : '<p>Inicia sesión para jugar con dinero real.</p>'}
<div id="slot"></div>`, game[0]);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__mock' && req.method === 'POST') {
      for (const k of ['win', 'bug']) if (url.searchParams.has(k)) mode[k] = url.searchParams.get(k);
      if (url.searchParams.has('reset')) for (const [u, b] of Object.entries(INITIAL)) accounts[u].balance = b;
      return send(res, 200, 'application/json', JSON.stringify(mode));
    }
    if (url.pathname === '/' || url.pathname === '/casino') return send(res, 200, 'text/html; charset=utf-8', lobby(req));
    if (url.pathname === '/inicio') return send(res, 200, 'text/html; charset=utf-8', loginPage(req, url));
    if (url.pathname === '/login' && req.method === 'POST') {
      const p = new URLSearchParams(await body(req));
      const user = p.get('username');
      if (!accounts[user] || accounts[user].pass !== p.get('password')) return send(res, 200, 'text/html; charset=utf-8', loginPage(req, url, 'Usuario o contraseña incorrectos'));
      const sid = crypto.randomBytes(12).toString('hex');
      sessions.set(sid, user);
      return send(res, 302, 'text/plain', '', { location: url.searchParams.get('returnUrl') ?? '/casino', 'set-cookie': `session=${sid}; Path=/; HttpOnly` });
    }
    if (url.pathname === '/api/v2/wallet/balance') {
      const user = userOf(req);
      if (!user) return send(res, 401, 'application/json', '{"error":"unauthorized"}');
      return send(res, 200, 'application/json', JSON.stringify({ balance: { totalAmount: accounts[user].balance / 100, currencyCode: 'EUR' } }));
    }
    const m = url.pathname.match(/^\/casino\/[^/]+\/([^/]+)$/);
    if (m) return send(res, 200, 'text/html; charset=utf-8', gamePage(req, url, m[1]));
    send(res, 404, 'text/plain', 'no encontrado');
  })
  .listen(SITE_PORT, () => console.log(`Betsson (maqueta) en :${SITE_PORT}`));

// ------------------------------------------------------------------------------------------- Proveedor
function gameHtml(user) {
  const bal = accounts[user]?.balance ?? 0;
  return `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden"><canvas id="c" width="1100" height="620"></canvas><script>
const c=document.getElementById('c'),x=c.getContext('2d');
const P=(event,params={})=>parent.postMessage({event,sender:'${SENDER}',params},'*');
const BET=${BET.c * BET.l};let bal=${bal}/100,state='loading',reels=[0,1,2,3,4],rid='',win=0,shownWin=0,lastWin=0,lastAfter=bal,msg=null;
// El juego real manda el símbolo (€) en updateBalance; aquí el código hasta que entre el PR #13 (currencyCode)
const CUR=${JSON.stringify(mode.bug === 'currency' ? { sym: '$', code: 'USD' } : { sym: '€', code: 'EUR' })};
const fmt=(v)=>v.toFixed(2).replace('.',',')+' '+CUR.sym;
function draw(){const g=x.createLinearGradient(0,0,0,620);g.addColorStop(0,'#2a0b45');g.addColorStop(1,'#0b2a45');x.fillStyle=g;x.fillRect(0,0,1100,620);
 if(state==='loading'){x.fillStyle='#fff';x.font='28px sans-serif';x.fillText('Cargando…',480,300);return}
 reels.forEach((r,i)=>{x.fillStyle=['#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6'][r%5];x.fillRect(150+i*165,70,145,400)});
 x.fillStyle='#0d0d14';x.fillRect(0,540,1100,80);x.fillStyle='#fff';x.font='bold 28px DejaVu Sans, Arial, sans-serif';
 x.fillText('CRÉDITO '+fmt(bal),250,592);x.fillText('APUESTA '+fmt(BET),640,592);
 if(shownWin>0){x.fillStyle='#ffd34d';x.fillText('GANANCIA '+fmt(shownWin),420,520)}
 if(rid){x.font='18px DejaVu Sans, Arial, sans-serif';x.fillStyle='#d0d0d0';x.fillText('#'+rid,14,612)}
 x.fillStyle=state==='spinning'?'#555':'#ff6a00';x.beginPath();x.arc(1010,580,32,0,7);x.fill();
 if(msg){x.fillStyle='rgba(0,0,0,.6)';x.fillRect(0,0,1100,540);x.fillStyle='#fff';x.fillRect(300,180,500,180);x.fillStyle='#111';x.font='bold 32px DejaVu Sans, Arial, sans-serif';x.fillText(msg[0],330,250);x.font='22px DejaVu Sans, Arial, sans-serif';x.fillText(msg[1],330,300)}}
async function gs(action,extra){const r=await fetch('/gs2c/ge/v5/gameService',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,symbol:'${SENDER}',mgckey:new URLSearchParams(location.search).get('mgckey'),...extra})});return new URLSearchParams(await r.text())}
async function spin(){if(state!=='ready')return;
 if(bal<BET){msg=${JSON.stringify(mode.bug === 'lang' ? ['Insufficient funds', 'You do not have enough funds for this bet.'] : ['Saldo insuficiente', 'No tienes suficiente saldo para esta apuesta.'])};draw();return}
 state='spinning';shownWin=0;P('gameRoundStarted',{betAmount:BET,balanceBefore:bal,winAmount:lastWin,balanceAfter:lastAfter});
 const res=await gs('doSpin',{c:${BET.c},l:${BET.l},index:1,counter:1});
 if(!res.has('balance')){state='ready';msg=['Error','No se pudo completar la jugada.'];draw();return}
 bal=Number(res.get('balance'));win=Number(res.get('tw'));rid=res.get('rid');P('updateBalance',{total:{amount:Math.round(bal*100),currency:CUR.sym}});P('spinStarted',{betAmount:BET,balanceBefore:bal+BET});
 let n=0;await new Promise(done=>{const t=setInterval(()=>{reels=reels.map(()=>Math.floor(Math.random()*5));draw();if(++n>14){clearInterval(t);done()}},100)});
 if(res.get('na')==='c'){const col=await gs('doCollect',{});bal=Number(col.get('balance'))}
 P('balanceChanged',{balanceAfter:bal});P('spinEnded',{winAmount:win,balanceAfter:bal,roundTripMs:300});P('gameRoundEnded',{winAmount:win,balanceAfter:bal});
 const steps=10;for(let i=1;i<=steps;i++){shownWin=win*i/steps;draw();await new Promise(r=>setTimeout(r,60))}
 lastWin=win;lastAfter=bal;state='ready';draw();P('visualBalanceUpdate',{newAmount:bal,win,currency:CUR.code});P('resultShown',{winAmount:win,balanceAfter:bal})}
window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();spin()}});
c.addEventListener('click',e=>{const r=c.getBoundingClientRect();if(Math.hypot(e.clientX-r.left-1010,e.clientY-r.top-580)<34)spin();else if(msg){msg=null;draw()}});
P('gameLoadingStarted');draw();
setTimeout(()=>{state='ready';draw();P('gameLoadingEnded');P('updateBalance',{total:{amount:Math.round(bal*100),currency:CUR.sym}});P('betInfo',{betsPerLine:[0.01,0.02,0.05,0.1]});P('betMultiplier',{betMultiplier:${BET.l}});P('betChanged',{bet:BET})},1200);
</script></body></html>`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/game') {
      const token = (url.searchParams.get('mgckey') ?? '').replace('AUTHTOKEN@', '');
      const user = tokens.get(token);
      if (!user) return send(res, 403, 'text/plain', 'sesión de juego no válida');
      return send(res, 200, 'text/html; charset=utf-8', gameHtml(user));
    }
    if (url.pathname === '/gs2c/ge/v5/gameService' && req.method === 'POST') {
      const p = new URLSearchParams(await body(req));
      const user = tokens.get((p.get('mgckey') ?? '').replace('AUTHTOKEN@', ''));
      if (!user) return send(res, 200, 'text/plain', 'SystemError=5');
      const acc = accounts[user];
      if (p.get('action') === 'doSpin') {
        const bet = Math.round(Number(p.get('c')) * Number(p.get('l')) * 100);
        if (acc.balance < bet) return send(res, 200, 'text/plain', 'SystemError=7&nomoney=1');
        acc.balance -= bet; // el proveedor cobra la apuesta al wallet de Betsson
        const win = mode.win === 'always' || (mode.win === 'random' && Math.random() < 0.4) ? bet * 2 : 0;
        const rid = String(++ridSeq);
        if (win) pending.set(user, win);
        return send(res, 200, 'text/plain', `tw=${eur(win)}&balance=${eur(acc.balance)}&rid=${rid}&na=${win ? 'c' : 's'}&c=${p.get('c')}&l=${p.get('l')}`);
      }
      if (p.get('action') === 'doCollect') {
        const win = pending.get(user) ?? 0;
        pending.delete(user);
        // Fallo de integración provocado: el juego enseña el premio, pero el wallet de Betsson no lo abona
        if (mode.bug === 'no-credit') return send(res, 200, 'text/plain', `balance=${eur(acc.balance + win)}&na=s`);
        acc.balance += win; // y abona el premio
        return send(res, 200, 'text/plain', `balance=${eur(acc.balance)}&na=s`);
      }
    }
    send(res, 404, 'text/plain', 'no encontrado');
  })
  .listen(GAME_PORT, () => console.log(`Proveedor (maqueta) en :${GAME_PORT}`));
