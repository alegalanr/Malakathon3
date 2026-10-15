/**
 * Un adaptador traduce los mensajes de un proveedor a eventos estándar (C3).
 * El resto del tester solo conoce los eventos estándar.
 */
import type { StandardEvent } from '../contracts/schemas';

export interface RawMessage {
  t: number; // hora de recepción en la página de Betsson
  origin: string;
  data: unknown;
}

export interface ProviderAdapter {
  name: string;
  /** null si el mensaje no es de este proveedor (anuncios, analítica, la propia web). */
  translate(msg: RawMessage, gameOrigin?: string): StandardEvent | null;
}

export function asObject(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  if (typeof data === 'string') {
    try {
      const o = JSON.parse(data);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Busca una clave en cualquier nivel (el sobre exacto del mensaje no condiciona la lectura). */
export function findKey(obj: unknown, key: string, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  const o = obj as Record<string, unknown>;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}
