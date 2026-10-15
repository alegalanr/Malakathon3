/** Utilidades de importes. */

export const EPS = 0.005; // medio céntimo

export function sameAmount(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a - b) < EPS;
}

/** Convierte "1,234.56", "1234.56" o 1234.56 en número. Los textos de Pragmatic usan la coma como separador de miles. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export const eur = (v: number | undefined) => (v === undefined ? '¿?' : `${v.toFixed(2)}`);
