/**
 * Importes en céntimos enteros (nunca float para comparar). Parseo por formato de mercado.
 */
import type { Cents, RunConfig } from '../contracts/schemas';

type NumberFormat = RunConfig['numberFormat'];

/** Euros (número o texto "2.80"/"1,234.56" de Pragmatic, que usa coma de miles) → céntimos. */
export function eurosToCents(v: unknown): Cents | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.trim().replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Valor que ya viene en céntimos (updateBalance). */
export function centsValue(v: unknown): Cents | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Confusiones típicas del OCR (O→0, l/I→1, S→5, B→8…), solo dentro de tramos que ya tienen dígitos. */
const DIGIT_FIXES: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', g: '9' };
export function fixDigitConfusions(text: string): string {
  return text.replace(/[0-9OoDQlIi|ZzSsBg.,]+/g, (run) => (/[0-9]/.test(run) ? run.replace(/[OoDQlIi|ZzSsBg]/g, (c) => DIGIT_FIXES[c] ?? c) : run));
}

/**
 * Texto leído en pantalla ("4,00 €", "€4.00", "S/ 2.80", "1.234,56") → céntimos, según el mercado.
 * El OCR confunde "," y ".", así que se decide por la forma y no por el carácter:
 *  - separador final + 2 dígitos → céntimos (los miles siempre van de 3 en 3);
 *  - separador final + 3 dígitos → miles, salvo que sea el separador decimal del mercado (ambiguo → null);
 *  - sin separador → euros enteros; con `alwaysDecimals` (el juego siempre pinta 2 decimales) → null,
 *    porque "280 €" casi seguro es "2,80 €" con la coma sin leer.
 * Ante cualquier duda devuelve null en vez de adivinar: el OCR es testigo, no juez.
 */
export function parseDisplayedAmount(text: string, fmt: NumberFormat): Cents | null {
  const body = text
    .replace(/S\s*\//g, ' ') // símbolo de soles (la S no es un 5)
    .replace(/(\d)\s*E\s*$/, '$1'); // € leído como E
  const tokens = fixDigitConfusions(body).match(/\d(?:[\d.,]*\d)?/g) ?? [];
  if (tokens.length !== 1) return null; // ningún número, o varios (ambiguo)
  const tok = tokens[0];
  const lastSep = Math.max(tok.lastIndexOf(','), tok.lastIndexOf('.'));
  let intStr = tok;
  let decStr = '00';
  if (lastSep === -1) {
    if (fmt.alwaysDecimals) return null;
  } else {
    const tail = tok.slice(lastSep + 1);
    if (tail.length === 2) {
      intStr = tok.slice(0, lastSep);
      decStr = tail;
    } else if (!(tail.length === 3 && tok[lastSep] !== fmt.decimal && !fmt.alwaysDecimals)) {
      return null;
    }
  }
  const groups = intStr.split(/[.,]/);
  if (groups.length > 1 && (groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3))) return null;
  const cents = Number(groups.join('')) * 100 + Number(decStr);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function currencySymbolIn(text: string): string | undefined {
  if (/S\s*\//.test(text)) return 'S/';
  if (/€/.test(text) || /\d\s*E\s*$/.test(text)) return '€'; // el OCR a veces lee € como E
  if (/EUR/i.test(text)) return '€';
  if (/PEN/i.test(text)) return 'S/';
  return undefined;
}

/** 280 → "2,80 €" (formato del mercado, solo para mostrar). */
export function formatCents(c: Cents | undefined | null, cfg: Pick<RunConfig, 'numberFormat' | 'currencySymbol'>): string {
  if (c === undefined || c === null) return '—';
  const neg = c < 0;
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, cfg.numberFormat.thousands);
  const dec = (abs % 100).toString().padStart(2, '0');
  const num = `${neg ? '−' : ''}${int}${cfg.numberFormat.decimal}${dec}`;
  return cfg.currencySymbol === '€' ? `${num} €` : `${cfg.currencySymbol} ${num}`;
}
