/**
 * Testigo visual con OCR real sobre pantallas sintéticas (sin navegador).
 * Comprueba el contrato C12, el consenso, la recolocación de zonas y el idioma del aviso.
 * Necesita los datos de idioma del OCR: en CI se descargan solos; sin red, TESSDATA_DIR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadRunConfig } from '../../src/config/RunConfig';
import { VisualReading, type RunConfig, type VisualField } from '../../src/contracts/schemas';
import { OcrEngine } from '../../src/vision/OcrEngine';
import { locateRois } from '../../src/vision/RoiLocator';
import { detectLanguage, ScreenWitness, type WitnessRequest } from '../../src/vision/ScreenWitness';
import { makeFakeGame } from './fixtures/fakeGame';
import { makeScreen } from './fixtures/fakeScreen';

test.describe.configure({ mode: 'serial' });

const cfg1 = loadRunConfig('es', 'completed-spin', 'simulated');
const cfg2 = loadRunConfig('es', 'insufficient-balance', 'simulated');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-'));
let ocr: OcrEngine;
let witness: ScreenWitness;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ocr = new OcrEngine();
  await ocr.init(cfg1.ocr.languages);
  expect(ocr.ready, `OCR no disponible: ${ocr.error}`).toBe(true);
  witness = new ScreenWitness(ocr, dir);
});
test.afterAll(async () => {
  await ocr?.terminate();
});

const req = (png: Buffer, fields: VisualField[], over: Partial<WitnessRequest> = {}, config: RunConfig = cfg1): WitnessRequest => ({
  capture: { png, t: Date.now(), triggerEvent: fields.includes('message') ? 'cambio de pantalla' : 'ROUND_ENDED' },
  fields,
  rois: {},
  config,
  ...over,
});
const by = (rs: VisualReading[], f: VisualField) => rs.find((r) => r.field === f)!;

/** Toda lectura cumple C12 y deja su recorte en disco. */
function expectContract(rs: VisualReading[]) {
  for (const r of rs) {
    expect(VisualReading.safeParse(r).success, JSON.stringify(r)).toBe(true);
    expect(fs.existsSync(path.join(dir, r.cropPath)), r.cropPath).toBe(true);
    if (r.value === null) expect(r.reason, 'value null exige motivo').toBeTruthy();
  }
}

// Con una sola lectura, el testigo anterior leía aquí el rid 603731119 (un 6 como 0): FAIL falso en S1-RID-VISIBLE
test('escenario 1: lee rid y apuesta, y devuelve las zonas para el ControlMap', async () => {
  const { readings, locatedRois } = await witness.read(req(await makeScreen({ rid: '#663731119', bet: '2,80 €' }), ['rid', 'bet']));
  expectContract(readings);
  expect(by(readings, 'rid').value).toContain('663731119'); // el "#" puede leerse como 4: ridMatches lo tolera
  expect(by(readings, 'bet').value).toBe(280);
  expect(by(readings, 'bet').currencySymbol).toBe('€');
  expect(locatedRois.rid).toBeTruthy();
  expect(locatedRois.bet?.anchor).toMatch(/APUESTA/i);
});

test('consenso: la apuesta solo se acepta con dos lecturas que coinciden', async () => {
  const { readings } = await witness.read(req(await makeScreen({ rid: '#658268119', bet: '4,00 €' }), ['bet']));
  expectContract(readings);
  expect(by(readings, 'bet').value).toBe(400);
  expect(by(readings, 'bet').attempts).toBeGreaterThanOrEqual(2);
});

test('zonas guardadas: se reutilizan sin volver a localizar', async () => {
  const first = await witness.read(req(await makeScreen({ rid: '#663731119', bet: '2,80 €' }), ['rid', 'bet']));
  const { readings, locatedRois } = await witness.read(req(await makeScreen({ rid: '#648332119', bet: '3,00 €' }), ['rid', 'bet'], { rois: first.locatedRois }));
  expect(by(readings, 'rid').value).toContain('648332119');
  expect(by(readings, 'bet').value).toBe(300);
  expect(locatedRois.bet).toEqual(first.locatedRois.bet); // la misma zona, revalidada
});

test('zona guardada desplazada → se vuelve a localizar', async () => {
  const wrong = { rx: 0.05, ry: 0.1, rw: 0.1, rh: 0.05, anchor: 'APUESTA' };
  const { readings, locatedRois } = await witness.read(req(await makeScreen({ bet: '3,00 €' }), ['bet'], { rois: { bet: wrong } }));
  expectContract(readings);
  expect(by(readings, 'bet').value).toBe(300);
  expect(locatedRois.bet).not.toEqual(wrong);
});

// Con una sola lectura y el parseo anterior, aquí salía 0 en vez de 0,20 €
test('otra resolución, fondo animado y etiqueta en inglés', async () => {
  const png = await makeScreen({ width: 1920, height: 1080, noise: true, betLabel: 'BET', creditLabel: 'CREDIT', rid: '#663731119', bet: '0,20 €' });
  const { readings } = await witness.read(req(png, ['rid', 'bet']));
  expectContract(readings);
  expect(by(readings, 'rid').value).toContain('663731119');
  expect(by(readings, 'bet').value).toBe(20);
});

test('escenario 2: aviso en español → language es, y la apuesta mostrada', async () => {
  const { readings } = await witness.read(req(await makeScreen({ popup: ['Saldo insuficiente', 'Recarga tu cuenta'] }), ['message', 'bet'], {}, cfg2));
  expectContract(readings);
  expect(by(readings, 'message').language).toBe('es');
  expect(by(readings, 'bet').value).toBe(280);
});

test('escenario 2: aviso en inglés en betsson.es → language en (el check dará FAIL)', async () => {
  const { readings } = await witness.read(req(await makeScreen({ popup: ['Insufficient funds', 'Please deposit'] }), ['message'], {}, cfg2));
  expect(by(readings, 'message').language).toBe('en');
});

test('sin aviso en pantalla → sin idioma y con motivo', async () => {
  const { readings } = await witness.read(req(await makeScreen({}), ['message'], {}, cfg2));
  expectContract(readings);
  expect(by(readings, 'message').language).toBeUndefined();
  expect(by(readings, 'message').reason).toBeTruthy();
});

test('sin rid visible → null con motivo (nunca se inventa)', async () => {
  const { readings } = await witness.read(req(await makeScreen({ bet: '2,80 €' }), ['rid']));
  expectContract(readings);
  expect(by(readings, 'rid').value).toBeNull();
});

test('recaptura una vez si las dos primeras lecturas no valen (contador aún en marcha)', async () => {
  const good = await makeScreen({ bet: '2,80 €' });
  const located = await locateRois(ocr, good, cfg1);
  let recaptures = 0;
  const { readings } = await witness.read(
    req(await makeScreen({ bet: '' }), ['bet'], {
      rois: { bet: located.bet![0] },
      recapture: async () => {
        recaptures++;
        return good;
      },
    }),
  );
  expect(recaptures).toBe(1);
  expect(by(readings, 'bet').value).toBe(280);
});

// Réplica del juego del modo simulado: etiqueta e importe pegados ("APUESTA 0,20 €").
// Antes la zona del importe se comía la última A de APUESTA y se leía "10,20 €".
// (El renderizado del SVG no es idéntico al del canvas de Chromium: el caso que lo reproduce aquí es 0,20 € sin aviso.)
for (const bet of [['4,00 €', 400], ['0,20 €', 20]] as const) {
  test(`juego simulado: etiqueta pegada al importe → ${bet[0]}`, async () => {
    const png = await makeFakeGame({ credit: '58,50 €', bet: bet[0], rid: '658268119' });
    const { readings } = await witness.read(req(png, ['rid', 'bet']));
    expectContract(readings);
    expect(by(readings, 'bet').value).toBe(bet[1]);
    expect(by(readings, 'rid').value).toContain('658268119');
  });
}

test('juego simulado con aviso: mensaje en español y apuesta 0,20 €', async () => {
  const png = await makeFakeGame({ credit: '0,10 €', bet: '0,20 €', message: ['Saldo insuficiente', 'No tienes suficiente saldo.'] });
  const { readings } = await witness.read(req(png, ['message', 'bet'], {}, cfg2));
  expectContract(readings);
  expect(by(readings, 'message').language).toBe('es');
  expect(by(readings, 'bet').value).toBe(20);
});

test('idioma del aviso: tolera errores del OCR pero solo con palabras completas', () => {
  expect(detectLanguage('Sald0 insuficlente', cfg2).language).toBe('es'); // dos errores del OCR
  expect(detectLanguage('FONDOS INSUFlCIENTES', cfg2).language).toBe('es');
  expect(detectLanguage('Suficiente por hoy', cfg2).language).toBeUndefined(); // «suficiente» no es «insuficiente»
  expect(detectLanguage('Deposita para seguir jugando', cfg2).language).toBeUndefined(); // «deposita» no es «deposit»
  expect(detectLanguage('lnsufficient funds', cfg2).language).toBe('en');
});

test('OCR sin cargar → no lanza, motivo claro', async () => {
  const w = new ScreenWitness(new OcrEngine(), dir);
  const { readings } = await w.read(req(await makeScreen({ rid: '#663731119' }), ['rid', 'bet']));
  expectContract(readings);
  expect(readings.every((r) => /testigo no disponible/.test(r.reason ?? ''))).toBe(true);
});
