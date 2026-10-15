/**
 * Privacidad de las capturas (PrivacyScan) y censura de la consola. OCR real sobre imágenes sintéticas.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { scrubScreenshots, secretNeedles, textRevealsSecret } from '../../src/evidence/PrivacyScan';
import { Evidence } from '../../src/evidence/Evidence';
import { OcrEngine } from '../../src/vision/OcrEngine';

test.describe.configure({ mode: 'serial' });

const USER = 'qa.tester07@betsson-pruebas.es';
let ocr: OcrEngine;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ocr = new OcrEngine();
  await ocr.init(['eng', 'spa']);
  expect(ocr.ready, `OCR no disponible: ${ocr.error}`).toBe(true);
});
test.afterAll(async () => {
  await ocr?.terminate();
});

/** Página sintética de Betsson con (o sin) el usuario en la cabecera. */
async function page(header: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1366" height="768">
    <rect width="1366" height="768" fill="#f4f4f4"/><rect width="1366" height="70" fill="#1b1b2f"/>
    <text x="30" y="45" font-family="DejaVu Sans" font-weight="bold" font-size="26" fill="#ff7a00">betsson</text>
    <text x="900" y="45" font-family="DejaVu Sans" font-size="20" fill="#ffffff">${header}</text>
    <text x="60" y="200" font-family="DejaVu Sans" font-size="28" fill="#222">Casino · Tragaperras</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function runDir(files: Record<string, Buffer>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-'));
  fs.mkdirSync(path.join(dir, 'evidence'));
  for (const [rel, png] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), png);
  return dir;
}

test('variantes del secreto: el email completo y la parte del usuario', () => {
  expect(secretNeedles([USER, 'abc'])).toEqual([USER, 'qa.tester07']);
});

test('detecta el usuario aunque el OCR lo lea con errores', () => {
  const needles = secretNeedles([USER]);
  expect(textRevealsSecret('Hola, qa.tester07 · Saldo', needles)).toBe(true);
  expect(textRevealsSecret('Hola, qa.testerO7', needles)).toBe(true);
  expect(textRevealsSecret('Casino · Tragaperras · Saldo 58,50 €', needles)).toBe(false);
});

test('una captura que enseña el usuario se difumina; una limpia se queda igual', async () => {
  const leaky = await page(`Hola, qa.tester07`);
  const clean = await page('Saldo');
  const dir = runDir({ 'evidence/casino.png': leaky, 'evidence/wallet-after.png': clean });
  const r = await scrubScreenshots({ dir, files: ['evidence/casino.png', 'evidence/wallet-after.png'], ocr, secrets: [USER, 'contraseña-falsa'], pageShots: ['evidence/casino.png', 'evidence/wallet-after.png'] });
  expect(r.checked).toBe(2);
  expect(r.blurred.map((b) => b.path)).toEqual(['evidence/casino.png']);
  expect(fs.readFileSync(path.join(dir, 'evidence/casino.png')).equals(leaky)).toBe(false); // ya no es la original
  expect(fs.readFileSync(path.join(dir, 'evidence/wallet-after.png')).equals(clean)).toBe(true);
  // Tras difuminarla, el OCR ya no puede leer el usuario
  const again = await scrubScreenshots({ dir, files: ['evidence/casino.png'], ocr, secrets: [USER], pageShots: [] });
  expect(again.blurred).toEqual([]);
});

test('sin OCR: las capturas de página completa se difuminan por precaución, las del juego no', async () => {
  const png = await page('Saldo');
  const dir = runDir({ 'evidence/casino.png': png, 'evidence/settled.png': png });
  const r = await scrubScreenshots({ dir, files: ['evidence/casino.png', 'evidence/settled.png'], ocr: new OcrEngine(), secrets: [USER], pageShots: ['evidence/casino.png'] });
  expect(r.blurred.map((b) => b.path)).toEqual(['evidence/casino.png']);
  expect(fs.readFileSync(path.join(dir, 'evidence/settled.png')).equals(png)).toBe(true);
});

test('la consola se censura igual que el timeline', () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (m: string) => lines.push(m);
  try {
    const ev = new Evidence(fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')), 'x');
    ev.log('network', 'doSpin', 'https://x/gameService?mgckey=AUTHTOKEN@abc123~x&action=doSpin');
  } finally {
    console.log = orig;
  }
  expect(lines.join('\n')).not.toContain('abc123');
});
