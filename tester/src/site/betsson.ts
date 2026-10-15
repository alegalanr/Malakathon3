/**
 * La web de Betsson: cookies, login, sesión de juego (DGOJ), búsqueda y apertura del juego.
 *
 * La web usa web components con shadow DOM; los localizadores de Playwright lo atraviesan
 * (todos menos XPath), así que se usan CSS y roles normales.
 *
 * Lo verificado en la web pública está marcado con ✔; lo que depende de la sesión iniciada
 * y aún no se ha visto, con ⚠️ (ver tester/README.md, "Pendiente de definir").
 */
import type { Frame, Locator, Page } from '@playwright/test';
import { SETTINGS } from '../../config/settings';
import type { Timeline } from '../evidence/timeline';

const m = SETTINGS.market;

async function visible(l: Locator, timeout = 1500): Promise<boolean> {
  try {
    await l.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ✔ OneTrust: "Configuración de cookies" → "Rechazarlas todas" (comprobado en betsson.es el 15/10).
export async function rejectCookies(page: Page): Promise<string> {
  const settings = page.locator('#onetrust-pc-btn-handler');
  if (!(await visible(settings, 8000))) return 'sin banner de cookies';
  await settings.click();
  const refuse = page.locator('.ot-pc-refuse-all-handler');
  if (await visible(refuse, 3000)) {
    await refuse.click();
    return 'cookies no esenciales rechazadas';
  }
  return 'no se encontró «Rechazarlas todas»; banner abierto sin aceptar';
}

export async function openCasino(page: Page) {
  await page.goto(m.baseUrl + m.casinoPath, { waitUntil: 'domcontentloaded' });
}

/**
 * ⚠️ Login. Selectores genéricos: botón «Iniciar sesión» del encabezado, campos de usuario y
 * contraseña y botón de envío. Ajustar cuando se vea el formulario con la sesión real.
 */
export async function login(page: Page, user: string, pass: string) {
  await page.getByRole('button', { name: /iniciar sesi[oó]n/i }).first().click();
  const userInput = page
    .locator('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[id*="user" i]')
    .first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 15000 });
  await userInput.fill(user);
  await passInput.fill(pass);
  await passInput.press('Enter');
  // Sesión iniciada = desaparece el botón «Iniciar sesión» del encabezado.
  await page
    .getByRole('button', { name: /iniciar sesi[oó]n/i })
    .first()
    .waitFor({ state: 'hidden', timeout: 30000 });
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  return !(await visible(page.getByRole('button', { name: /iniciar sesi[oó]n/i }), 5000));
}

/**
 * Busca el juego como un jugador: lupa del lobby → escribir → elegir el resultado.
 * ✔ El botón (gaming-discovery-search-button) y el campo («Búsqueda de juegos y proveedores») existen.
 * ⚠️ Cómo se pintan los resultados: se elige el enlace que apunta a la página del juego.
 */
export async function searchGame(page: Page, query: string, gamePath: string): Promise<boolean> {
  await page.locator('gaming-discovery-search-button').first().click();
  const input = page.getByPlaceholder(/b[uú]squeda de juegos/i).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.pressSequentially(query, { delay: 60 });
  const slug = gamePath.split('/').pop()!;
  const result = page.locator(`a[href$="/${slug}"], a[href*="/${slug}?"]`).filter({ visible: true }).first();
  if (!(await visible(result, 10000))) return false;
  await result.click();
  return true;
}

/**
 * ⚠️ Sesión de juego obligatoria en España (DGOJ): antes de jugar puede pedirse una sesión
 * con límite de tiempo y de gasto. Aquí solo se detecta y se intenta confirmar con lo que
 * venga por defecto; si exige rellenar algo, se para con el motivo y una captura.
 */
export async function handleGameSession(page: Page, tl: Timeline): Promise<'none' | 'confirmed' | 'blocked'> {
  const dialog = page.getByRole('dialog').filter({ hasText: /sesi[oó]n de juego|l[ií]mite/i }).first();
  if (!(await visible(dialog, 4000))) return 'none';
  tl.note('aparece la sesión de juego (DGOJ)');
  const confirm = dialog.getByRole('button', { name: /empezar|iniciar|comenzar|continuar|jugar|aceptar|confirmar/i }).first();
  if (await visible(confirm, 1000)) {
    await confirm.click();
    if (!(await visible(dialog, 3000))) return 'confirmed';
  }
  return 'blocked';
}

/**
 * Abre el juego en Real Play. Nunca se pulsa un botón de demo.
 * ✔ La página del juego es m.baseUrl + GAME_PATH. ⚠️ El parámetro gameAction=play (del diagrama del equipo).
 */
export async function launchRealPlay(page: Page, tl: Timeline) {
  const play = page.getByRole('button', { name: /^(jugar|jugar ahora|play)$/i }).first();
  if (await visible(play, 4000)) {
    tl.note('clic en «Jugar» de la página del juego');
    await play.click();
    return;
  }
  const url = new URL(page.url());
  if (url.searchParams.get('gameAction') !== 'play') {
    url.searchParams.set('gameAction', 'play');
    tl.note('se abre con gameAction=play');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  }
}

/** El juego es el iframe más grande de la página. */
export async function findGameFrame(page: Page, timeoutMs: number): Promise<{ frame: Frame; element: Locator } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = page.locator('iframe');
    let best: { i: number; area: number } | null = null;
    for (let i = 0; i < (await frames.count()); i++) {
      const box = await frames.nth(i).boundingBox().catch(() => null);
      const area = box ? box.width * box.height : 0;
      if (area > 200 * 150 && (!best || area > best.area)) best = { i, area };
    }
    if (best) {
      const element = frames.nth(best.i);
      const frame = await (await element.elementHandle())?.contentFrame();
      if (frame) return { frame, element };
    }
    await page.waitForTimeout(1000);
  }
  return null;
}
