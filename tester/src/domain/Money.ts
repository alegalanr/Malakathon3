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

/**
 * Texto leído en pantalla ("4,00 €", "€4.00", "S/ 2.80", "1.234,56") → céntimos, según el mercado.
 * Si el texto trae un único separador seguido de 2 dígitos, se toma como decimal aunque no coincida
 * con el del mercado (el juego puede formatear distinto que la web); el informe enseña el texto en bruto.
 */
export function parseDisplayedAmount(text: string, fmt: NumberFormat): Cents | null {
  const s = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let intPart = s;
  let decPart = '';
  if (lastSep >= 0) {
    const tail = s.slice(lastSep + 1);
    const sep = s[lastSep];
    if (tail.length === 2 || (sep === fmt.decimal && tail.length <= 2)) {
      intPart = s.slice(0, lastSep);
      decPart = tail;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (intPart === '' && decPart === '') return null;
  const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
  return Number.isFinite(cents) ? cents : null;
}

export function currencySymbolIn(text: string): string | undefined {
  if (/S\s*\//.test(text)) return 'S/';
  if (/€/.test(text)) return '€';
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
