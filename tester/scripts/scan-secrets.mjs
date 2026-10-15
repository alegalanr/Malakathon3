#!/usr/bin/env node
/**
 * P6 (DISENO.md §4, §9): bloquea la publicación si algún fichero de texto contiene patrones de secretos
 * o el valor exacto de alguna variable BETSSON_*. Muestra fichero y patrón, nunca el valor.
 * Uso: node scripts/scan-secrets.mjs <carpeta>   → código 1 si encuentra algo.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'site';
const PATTERNS = [/AUTHTOKEN@/i, /mgckey/i, /SESSION@/i, /ssid=/i, /gameSessionId/i, /Authorization:/i, /Cookie:/i, /Set-Cookie:/i];
const values = Object.entries(process.env)
  .filter(([k, v]) => /^BETSSON_/.test(k) && v && v.length >= 3)
  .map(([k, v]) => [k, v]);
const TEXT = /\.(json|jsonl|html|md|txt|csv|js|css|svg|xml)$/i;

function walk(d) {
  return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [];
}

const hits = [];
for (const file of walk(dir)) {
  if (!TEXT.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const re of PATTERNS) if (re.test(text)) hits.push(`${file}: patrón ${re.source}`);
  for (const [k, v] of values) if (text.includes(v)) hits.push(`${file}: valor de ${k}`);
}
if (hits.length) {
  console.error(`✘ Posibles secretos (no se publica):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`✔ Sin secretos en ${dir}`);
