/**
 * Censura de secretos antes de escribir cualquier evidencia (SOLUCION.md §8.3).
 * La misma lista de patrones la usa scripts/scan-secrets.mjs para bloquear la publicación.
 */

export const SECRET_PATTERNS: RegExp[] = [
  /AUTHTOKEN@/i,
  /mgckey/i,
  /SESSION@/i,
  /ssid=/i,
  /gameSessionId/i,
  /Authorization:/i,
  /Cookie:/i,
  /Set-Cookie:/i,
];

const SECRET_KEY = /^(token|mgckey|ssid|sid|sessionid|gamesessionid|authorization|cookie|set-cookie|password|pass|jwt|accesstoken|refreshtoken)$/i;

const IN_TEXT: [RegExp, string][] = [
  [/((?:mgckey|token|sessionId|gameSessionId|ssid|sid|jwt)=)[^&\s"']+/gi, '$1***'],
  [/(?:AUTHTOKEN|SESSION)@[^~&\s"']*/gi, '***'],
  [/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1***'],
  [/\b(mgckey|gameSessionId|ssid)\b/gi, 'tok'],
  [/\b(Authorization|Set-Cookie|Cookie):/gi, 'h***:'],
];

/** Valores exactos de las credenciales del entorno: nunca deben aparecer en ningún artefacto. */
export function credentialValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => /^BETSSON_.*_(USER|PASS)$/.test(k) && v && v.length >= 3)
    .map(([, v]) => v as string);
}

export function redactText(s: string): string {
  let out = IN_TEXT.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
  for (const v of credentialValues()) out = out.split(v).join('***');
  return out;
}

export function redact<T>(v: T, depth = 0): T {
  if (depth > 12) return '…' as unknown as T;
  if (typeof v === 'string') return redactText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const key = SECRET_KEY.test(k) ? 'tok' : redactText(k);
      out[key] = SECRET_KEY.test(k) ? '***' : redact(val, depth + 1);
    }
    return out as T;
  }
  return v;
}

export function findSecrets(text: string): string[] {
  const hits = SECRET_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
  if (credentialValues().some((v) => text.includes(v))) hits.push('valor de credencial BETSSON_*');
  return hits;
}
