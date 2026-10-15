import { expect, test } from '@playwright/test';
import { currencyCode, currencySymbolIn, eurosToCents, formatCents, parseDisplayedAmount } from '../../src/domain/Money';

const ES = { decimal: ',' as const, thousands: '.' as const };
const COM = { decimal: '.' as const, thousands: ',' as const };

test('euros de Pragmatic → céntimos enteros', () => {
  expect(eurosToCents(4)).toBe(400);
  expect(eurosToCents(2.8)).toBe(280);
  expect(eurosToCents('62.50')).toBe(6250);
  expect(eurosToCents('1,234.56')).toBe(123456);
  expect(eurosToCents(0.1 + 0.2)).toBe(30); // sin errores de coma flotante
  expect(eurosToCents('')).toBeUndefined();
});

test('importes mostrados en pantalla según el mercado', () => {
  expect(parseDisplayedAmount('4,00 €', ES)).toBe(400);
  expect(parseDisplayedAmount('APUESTA 2,80 €', ES)).toBe(280);
  expect(parseDisplayedAmount('1.234,56 €', ES)).toBe(123456);
  expect(parseDisplayedAmount('€4.00', COM)).toBe(400);
  expect(parseDisplayedAmount('S/ 2.80', COM)).toBe(280);
  expect(parseDisplayedAmount('€4.00', ES)).toBe(400); // el juego puede formatear distinto que la web
  expect(parseDisplayedAmount('€', ES)).toBeNull();
});

test('pantalla: rechaza lo ambiguo en vez de adivinar', () => {
  const STRICT = { ...ES, alwaysDecimals: true };
  expect(parseDisplayedAmount('2.80 €', ES)).toBe(280); // coma leída como punto
  expect(parseDisplayedAmount('2,8O €', ES)).toBe(280); // O leída en vez de 0
  expect(parseDisplayedAmount('280 €', STRICT)).toBeNull(); // coma perdida: no son 280 €
  expect(parseDisplayedAmount('2,80 € 3,00 €', ES)).toBeNull(); // dos importes
  expect(parseDisplayedAmount('2,805 €', ES)).toBeNull(); // 3 decimales
  expect(parseDisplayedAmount('1 €', ES)).toBe(100);
});

test('símbolo de moneda y formato', () => {
  expect(currencySymbolIn('4,00 €')).toBe('€');
  expect(currencySymbolIn('S/ 2.80')).toBe('S/');
  expect(formatCents(5850, { numberFormat: ES, currencySymbol: '€' })).toBe('58,50 €');
  expect(formatCents(123456, { numberFormat: ES, currencySymbol: '€' })).toBe('1.234,56 €');
  expect(formatCents(280, { numberFormat: COM, currencySymbol: 'S/' })).toBe('S/ 2.80');
});

test('moneda del juego («€») y de la cartera («EUR») se comparan por código', () => {
  expect(currencyCode('€')).toBe('EUR');
  expect(currencyCode('EUR')).toBe('EUR');
  expect(currencyCode('S/')).toBe('PEN');
  expect(currencyCode('eur')).toBe('EUR');
});

test('importe con texto vecino: varios números es ambiguo (null), la etiqueta no molesta', () => {
  expect(parseDisplayedAmount('4,00 € 3X', ES)).toBeNull(); // ✔ recorte real de Bubble Up: ante la duda, null
  expect(parseDisplayedAmount('APUESTA 4,00 €', ES)).toBe(400);
});
