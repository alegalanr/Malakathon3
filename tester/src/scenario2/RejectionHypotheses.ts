/**
 * Hipótesis del contrato de rechazo (escenario 2) en config/rejection-hypotheses.json.
 * Mientras status sea 'hypothesis', un REJECTED por evento es una señal más, no la prueba.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const RejectionHypotheses = z.object({
  status: z.enum(['hypothesis', 'confirmed']),
  events: z.object({ namePatterns: z.array(z.string()), payloadPatterns: z.array(z.string()) }),
  network: z.object({ errorKeys: z.array(z.string()) }),
});
export type RejectionHypotheses = z.infer<typeof RejectionHypotheses>;

const FILE = path.join(__dirname, '..', '..', 'config', 'rejection-hypotheses.json');
let cached: RejectionHypotheses | undefined;

export function loadRejectionHypotheses(): RejectionHypotheses {
  if (!cached) cached = RejectionHypotheses.parse(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  return cached;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_\-/]+/g, '');

/** ¿El nombre o el contenido del mensaje coinciden con un rechazo por saldo? Devuelve el motivo o null. */
export function rejectionReason(name: string, raw: unknown, hyp = loadRejectionHypotheses()): string | null {
  const n = squash(name);
  const byName = hyp.events.namePatterns.find((p) => n.includes(squash(p)));
  if (byName) return `nombre «${name}» ~ ${byName}`;
  let text = '';
  try {
    text = (typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '').toLowerCase();
  } catch {
    return null;
  }
  const byPayload = hyp.events.payloadPatterns.find((p) => text.includes(p.toLowerCase()));
  return byPayload ? `contenido ~ «${byPayload}»` : null;
}

/** Clave de error en la respuesta key=value de gameService (p. ej. frozen=…, errorcode=…). */
export function errorKeyIn(res: URLSearchParams, hyp = loadRejectionHypotheses()): string | null {
  const keys = new Set(hyp.network.errorKeys.map((k) => k.toLowerCase()));
  for (const [k, v] of res) if (keys.has(k.toLowerCase())) return `${k}=${v}`;
  return null;
}
