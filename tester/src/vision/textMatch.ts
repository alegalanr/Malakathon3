/**
 * Comparación difusa de texto leído por OCR (tolera "sald0 insuficlente").
 * La usan el testigo visual (idioma del aviso) y las reglas.
 */

/** Minúsculas, sin tildes, solo letras, dígitos y espacios. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const L = Math.max(a.length, b.length);
  return L === 0 ? 1 : 1 - levenshtein(a, b) / L;
}

/** ¿Aparece `phrase` en `text`? Compara la frase con cada ventana de palabras del mismo tamaño. */
export function containsFuzzy(text: string, phrase: string, minSimilarity = 0.8): { found: boolean; score: number; match?: string } {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const target = normalizeText(phrase);
  const n = target.split(' ').length;
  let best: { found: boolean; score: number; match?: string } = { found: false, score: 0 };
  for (let i = 0; i + n <= words.length; i++) {
    const win = words.slice(i, i + n).join(' ');
    const s = similarity(win, target);
    if (s > best.score) best = { found: s >= minSimilarity, score: s, match: win };
  }
  return best;
}
