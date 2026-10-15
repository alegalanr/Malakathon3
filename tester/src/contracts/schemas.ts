/**
 * Contratos entre componentes (SOLUCION.md §14, DISENO.md §7) como esquemas zod.
 * Cambiar un contrato es un cambio compartido: PR pequeño que actualiza esquema, fixtures y tests.
 */
import { z } from 'zod';

// --- 14.1 Tipos comunes ------------------------------------------------------
export const Cents = z.number().int(); // importes SIEMPRE en céntimos enteros
export const Currency = z.enum(['EUR', 'PEN']);
export const Source = z.enum(['event', 'network', 'wallet', 'screen', 'config']);
export const Millis = z.number(); // Date.now() al RECIBIR el dato
export const Scenario = z.enum(['completed-spin', 'insufficient-balance']);
export const MarketId = z.enum(['es', 'com', 'pe']);
export type Cents = z.infer<typeof Cents>;
export type Currency = z.infer<typeof Currency>;
export type Source = z.infer<typeof Source>;
export type Scenario = z.infer<typeof Scenario>;
export type MarketId = z.infer<typeof MarketId>;

// --- C1 RunConfig ------------------------------------------------------------
export const RunConfig = z.object({
  market: MarketId,
  scenario: Scenario,
  mode: z.enum(['real', 'simulated']),
  baseUrl: z.string().url(),
  casinoPath: z.string(),
  loginPath: z.string(),
  language: z.enum(['es', 'en']),
  locale: z.string(),
  timezone: z.string(),
  currency: Currency,
  currencySymbol: z.string(),
  numberFormat: z.object({ decimal: z.enum([',', '.']), thousands: z.enum([',', '.', ' ', '']) }),
  texts: z.object({ insufficientBalance: z.array(z.string()).min(1) }),
  game: z.object({ provider: z.literal('pragmatic'), name: z.string(), search: z.string(), path: z.string() }),
  maxBet: Cents,
  ocr: z.object({
    languages: z.array(z.string()),
    minConfidence: z.number().min(0).max(1),
    maxAttempts: z.number().int().min(1),
    anchors: z.object({ bet: z.array(z.string()), rid: z.array(z.string()) }),
  }),
  // Las credenciales nunca se serializan: solo se guarda el nombre de las variables.
  credentialEnv: z.object({ userEnv: z.string(), passEnv: z.string() }),
});
export type RunConfig = z.infer<typeof RunConfig>;

// --- C2 SessionState -----------------------------------------------------------
export const SessionState = z.object({ loggedIn: z.literal(true), finalUrl: z.string(), market: MarketId, at: Millis });
export type SessionState = z.infer<typeof SessionState>;

// --- C3 StandardEvent ----------------------------------------------------------
export const EventType = z.enum(['READY', 'ROUND_STARTED', 'SPIN_ENDED', 'ROUND_ENDED', 'BET_CHANGED', 'BALANCE', 'REJECTED', 'UNKNOWN']);
export type EventType = z.infer<typeof EventType>;
export const StandardEvent = z.object({
  type: EventType,
  t: Millis,
  name: z.string(), // nombre original del proveedor
  data: z.object({
    bet: Cents.optional(),
    balanceBefore: Cents.optional(),
    win: Cents.optional(),
    balanceAfter: Cents.optional(),
    amount: Cents.optional(),
    currency: z.string().optional(),
    reason: z.string().optional(),
  }),
  raw: z.unknown(),
  sender: z.string().optional(),
  origin: z.string(),
});
export type StandardEvent = z.infer<typeof StandardEvent>;

// --- C4 GameHandle (el frame no se serializa) --------------------------------------
export const Box = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
export type Box = z.infer<typeof Box>;

// --- C6 SpinRecord ---------------------------------------------------------------
export const SpinRecord = z.object({
  rid: z.string().optional(),
  bet: Cents.optional(), // c × l de la PETICIÓN
  balanceAfterSpin: Cents.optional(),
  win: Cents.optional(), // tw
  needsCollect: z.boolean(), // na = c
  collectBalance: Cents.optional(),
  status: z.number(),
  error: z.string().optional(),
  t: Millis,
});
export type SpinRecord = z.infer<typeof SpinRecord>;

// --- C7 WalletReading ------------------------------------------------------------
export const WalletReading = z.object({ amount: Cents, currency: z.string(), t: Millis, source: z.literal('api') });
export type WalletReading = z.infer<typeof WalletReading>;

// --- C8 ControlMap -----------------------------------------------------------------
const Rel = z.number().min(0).max(1);
export const Control = z.object({
  method: z.enum(['key', 'click']),
  key: z.string().optional(),
  point: z.object({ rx: Rel, ry: Rel }).optional(),
  validatedAt: Millis.optional(),
});
export const Roi = z.object({ rx: Rel, ry: Rel, rw: Rel, rh: Rel, anchor: z.string() });
export const ControlMap = z.object({
  game: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  controls: z.object({ spin: Control.optional(), betUp: Control.optional(), betDown: Control.optional() }),
  rois: z.object({ rid: Roi.optional(), bet: Roi.optional() }),
});
export type Control = z.infer<typeof Control>;
export type Roi = z.infer<typeof Roi>;
export type ControlMap = z.infer<typeof ControlMap>;

// --- C10 ActionRecord ----------------------------------------------------------------
export const ActionRecord = z.object({
  action: z.enum(['spin', 'betUp', 'betDown']),
  method: z.enum(['key', 'click']),
  key: z.string().optional(),
  point: z.object({ rx: Rel, ry: Rel }).optional(),
  t: Millis,
  confirmedBy: StandardEvent.optional(),
});
export type ActionRecord = z.infer<typeof ActionRecord>;

// --- C12 VisualReading ---------------------------------------------------------------
export const VisualField = z.enum(['rid', 'bet', 'message']);
export type VisualField = z.infer<typeof VisualField>;
export const VisualReading = z.object({
  field: VisualField,
  raw: z.string(),
  value: z.union([z.string(), Cents, z.null()]),
  currencySymbol: z.string().optional(),
  confidence: z.number().min(0).max(1),
  roi: Roi.nullable(),
  cropPath: z.string(), // relativa a la carpeta del run; siempre existe
  attempts: z.number().int(),
  reason: z.string().optional(),
  language: z.enum(['en', 'es']).optional(),
});
export type VisualReading = z.infer<typeof VisualReading>;

// --- C9 GameRound --------------------------------------------------------------------
const BySource = <T extends z.ZodTypeAny>(t: T) => z.object({ event: t, network: t, wallet: t, screen: t, config: t }).partial();
export const GameRound = z.object({
  rid: BySource(z.string()),
  bet: BySource(Cents),
  win: BySource(Cents),
  balanceBefore: BySource(Cents),
  balanceAfter: BySource(Cents),
  betsson: z.object({ before: WalletReading.optional(), after: WalletReading.optional() }),
  currency: BySource(z.string()),
  message: z.object({ text: z.string(), language: z.enum(['en', 'es']).optional() }).optional(),
  startedAt: Millis.optional(),
  endedAt: Millis.optional(),
  findings: z.array(z.string()),
});
export type GameRound = z.infer<typeof GameRound>;

// --- C13 Check -----------------------------------------------------------------------
export const Check = z.object({
  id: z.string(),
  title: z.string(),
  scenario: Scenario,
  market: MarketId,
  result: z.enum(['PASS', 'FAIL']),
  expected: z.string(),
  observed: z.string(),
  sources: z.array(Source),
  evidence: z.array(z.string()),
  message: z.string().min(1),
});
export type Check = z.infer<typeof Check>;

// --- C18 PhaseStatus -------------------------------------------------------------------
export const PhaseId = z.enum(['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13']);
export type PhaseId = z.infer<typeof PhaseId>;
export const PhaseStatus = z
  .object({
    phase: PhaseId,
    name: z.string(),
    status: z.enum(['ok', 'failed', 'skipped']),
    startedAt: Millis,
    endedAt: Millis,
    reason: z.string().optional(),
    produced: z.array(z.string()),
  })
  .refine((p) => p.status === 'ok' || !!p.reason, { message: 'failed y skipped llevan reason' });
export type PhaseStatus = z.infer<typeof PhaseStatus>;

// --- C14 RunReport (DISENO.md §7.1) ------------------------------------------------------
export const RunReport = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  mode: z.enum(['simulated', 'real']),
  market: MarketId,
  scenario: Scenario,
  game: z.object({ name: z.string(), provider: z.literal('pragmatic'), sender: z.string().optional() }),
  startedAt: z.string(),
  finishedAt: z.string(),
  phases: z.array(PhaseStatus),
  checks: z.array(Check),
  round: GameRound.nullable(),
  visual: z.array(VisualReading),
  timeline: z.array(z.object({ t: Millis, source: z.string(), type: z.string(), summary: z.string() })).optional(),
  artifacts: z.object({
    screenshots: z.array(z.object({ label: z.string(), path: z.string(), t: Millis.optional() })),
    video: z.string().optional(),
  }),
});
export type RunReport = z.infer<typeof RunReport>;
