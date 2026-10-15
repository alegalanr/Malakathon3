/**
 * La web de Betsson (DOM del operador, no del juego). Usa web components con shadow DOM:
 * los localizadores de Playwright lo atraviesan (todos menos XPath).
 *
 * ✔ = comprobado en la web pública de betsson.es (15/10) · ⚠️ = depende de la sesión, sin ver todavía.
 */
import type { Locator, Page } from '@playwright/test';
import type { RunConfig, SessionState } from '../contracts/schemas';

export class MarketMismatchError extends Error {}
export class LoginError extends Error {}

async function visible(l: Locator, timeout = 1500): Promise<boolean> {
  try {
    await l.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

const loginButton = (page: Page) => page.locator('fds-button').filter({ hasText: /^\s*Iniciar sesi[oó]n\s*$/i });

export class BetssonSite {
  constructor(
    private page: Page,
    private cfg: RunConfig,
  ) {}

  async openCasino() {
    await this.page.goto(this.cfg.baseUrl + this.cfg.casinoPath, { waitUntil: 'domcontentloaded' });
  }

  /** ✔ OneTrust: «Configuración de cookies» → «Rechazarlas todas». Nunca se aceptan las no esenciales. */
  async rejectCookies(): Promise<string> {
    const settings = this.page.locator('#onetrust-pc-btn-handler');
    if (!(await visible(settings, 8000))) return 'sin banner de cookies';
    await settings.click();
    const refuse = this.page.locator('.ot-pc-refuse-all-handler');
    if (await visible(refuse, 4000)) {
      await refuse.click();
      return 'cookies no esenciales rechazadas';
    }
    return 'banner abierto sin «Rechazarlas todas»: no se acepta nada';
  }

  /**
   * ⚠️ Login. ✔ El botón «Iniciar sesión» lleva a la página /inicio?returnUrl=/casino.
   * ⚠️ El formulario no se ha visto: se espera al campo de contraseña y se usa el campo de texto
   * visible más cercano a él como usuario. Se llama desde global-setup (fuera de toda traza).
   */
  async login(user: string, pass: string) {
    await this.page.goto(this.cfg.baseUrl + this.cfg.loginPath, { waitUntil: 'domcontentloaded' });
    await this.rejectCookies();
    const password = this.page.locator('input[type="password"]').first();
    if (!(await visible(password, 15_000))) {
      // En algunas vistas el formulario se abre con el botón
      if (await visible(loginButton(this.page), 3000)) await loginButton(this.page).first().click();
      if (!(await visible(password, 15_000))) throw new LoginError('no aparece el formulario de login (campo de contraseña)');
    }
    const userInput = this.page
      .locator('input[type="email"], input[type="text"], input[type="tel"], input:not([type])')
      .filter({ visible: true })
      .first();
    if (!(await visible(userInput, 5000))) throw new LoginError('no aparece el campo de usuario');
    await userInput.fill(user);
    await password.fill(pass);
    await password.press('Enter');
    // Sesión iniciada = desaparece «Iniciar sesión» del encabezado.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!(await visible(loginButton(this.page), 1000))) return;
      await this.page.waitForTimeout(1000);
    }
    throw new LoginError('tras enviar el formulario sigue visible «Iniciar sesión» (¿credenciales, verificación adicional o CAPTCHA?)');
  }

  async isLoggedIn(): Promise<boolean> {
    await this.page.waitForTimeout(1500);
    return !(await visible(loginButton(this.page), 4000));
  }

  /** F1: sesión iniciada en el dominio del mercado (C2). */
  async session(): Promise<SessionState> {
    const finalUrl = this.page.url();
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    const expected = new URL(this.cfg.baseUrl).hostname.replace(/^www\./, '');
    if (host !== expected) throw new MarketMismatchError(`mercado incorrecto: ${host} (se esperaba ${expected})`);
    if (!(await this.isLoggedIn())) throw new LoginError('sesión no iniciada: sigue visible «Iniciar sesión»');
    return { loggedIn: true, finalUrl, market: this.cfg.market, at: Date.now() };
  }

  /**
   * Buscar el juego como un jugador: lupa → escribir → resultado.
   * ✔ gaming-discovery-search-button y el campo «Búsqueda de juegos y proveedores» existen y el resultado
   * enlaza a la página del juego (prueba del lobby en verde). Si el buscador no lo devuelve, se va a su página.
   */
  async searchGame(): Promise<'buscador' | 'url'> {
    const { search, path } = this.cfg.game;
    try {
      await this.page.locator('gaming-discovery-search-button').first().click({ timeout: 10_000 });
      const input = this.page.getByPlaceholder(/b[uú]squeda de juegos/i).first();
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      await input.pressSequentially(search, { delay: 60 });
      const slug = path.split('/').pop()!;
      const result = this.page.locator(`a[href$="/${slug}"], a[href*="/${slug}?"]`).filter({ visible: true }).first();
      if (await visible(result, 10_000)) {
        await result.click();
        await this.page.waitForURL(new RegExp(`/${slug}($|\\?)`), { timeout: 15_000 });
        return 'buscador';
      }
    } catch {
      /* se intenta por URL */
    }
    await this.page.goto(this.cfg.baseUrl + path, { waitUntil: 'domcontentloaded' });
    return 'url';
  }

  /**
   * Abrir en Real Play: botón de jugar con dinero real si existe; si no, ?gameAction=play (diagrama del equipo).
   * Nunca se pulsa un botón de demo / jugar gratis.
   */
  async launchRealPlay(): Promise<string> {
    const real = this.page
      .locator('fds-button, button')
      .filter({ hasText: /^\s*(jugar|jugar ahora|jugar con dinero real|play|play now)\s*$/i })
      .filter({ hasNotText: /demo|gratis|diversi[oó]n|fun|pr[aá]ctica/i });
    if (await visible(real, 5000)) {
      await real.first().click();
      return 'botón «Jugar»';
    }
    const url = new URL(this.page.url());
    if (url.searchParams.get('gameAction') !== 'play') {
      url.searchParams.set('gameAction', 'play');
      await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    }
    return 'gameAction=play';
  }

  /**
   * Sesión de juego obligatoria (DGOJ). ✔ (15/10) Al abrir el juego sin sesión de juego, el recuadro muestra
   * «El juego no se inicia · Se requiere una sesión de juego activa» con «Iniciar una nueva sesión», y unos
   * 5 s después sale encima la ventana «Atención» («Hace menos de 60 mins. que finalizaste tu sesión de juego»)
   * con «Iniciar sesión» / «Volver a Casino». Se pulsa como un jugador; si después sale un formulario de
   * límites, se rellena (ver fillSessionLimits). Localizadores por rol: atraviesan el shadow DOM.
   */
  async handleGameSession(log: (msg: string) => void = () => {}): Promise<'none' | 'confirmed' | 'blocked'> {
    const attention = this.page.getByRole('dialog').filter({ hasText: /sesi[oó]n de juego/i });
    const attentionStart = attention.getByRole('button', { name: /^\s*iniciar sesi[oó]n\s*$/i });
    const newSession = this.page.getByRole('button', { name: /iniciar una nueva sesi[oó]n/i });
    const required = this.page.getByText(/se requiere una sesi[oó]n de juego/i);

    // La ventana «Atención» tarda unos segundos: se espera a ella o a que el juego arranque sin pedir nada
    const deadline = Date.now() + 20_000;
    let sawRequired = false;
    let clicked = false;
    while (Date.now() < deadline) {
      if (await visible(attentionStart, 1000)) {
        log('ventana «Atención» de sesión de juego: «Iniciar sesión»');
        await attentionStart.first().click();
        clicked = true;
        break;
      }
      sawRequired ||= await visible(required, 500);
      if (!sawRequired && (await this.hasGameFrame())) return 'none';
      // Sin ventana «Atención» tras 8 s: el botón del propio recuadro
      if (sawRequired && Date.now() > deadline - 12_000 && (await visible(newSession, 500))) {
        log('«Se requiere una sesión de juego activa»: «Iniciar una nueva sesión»');
        await newSession.first().click();
        clicked = true;
        break;
      }
    }
    if (!clicked) return sawRequired ? 'blocked' : 'none';

    // Tras el clic: o arranca el juego, o sale el formulario de límites de la sesión
    const until = Date.now() + 30_000;
    let filled = false;
    while (Date.now() < until) {
      if ((await this.hasGameFrame()) && !(await visible(required, 300))) return 'confirmed';
      if (!filled && (await this.fillSessionLimits(log))) {
        filled = true;
        continue;
      }
      // La ventana «Atención» puede volver a salir si el primer clic no bastó
      if (await visible(attentionStart, 300)) await attentionStart.first().click();
      await this.page.waitForTimeout(1000);
    }
    return 'blocked';
  }

  /** Hay un iframe grande (el juego) en la página. */
  private async hasGameFrame(): Promise<boolean> {
    const frames = this.page.locator('iframe');
    const n = await frames.count();
    for (let i = 0; i < n; i++) {
      const b = await frames.nth(i).boundingBox().catch(() => null);
      if (b && b.width > 300 && b.height > 200) return true;
    }
    return false;
  }

  /**
   * ⚠️ Formulario de límites de la sesión de juego (sin ver todavía): en el diálogo abierto se eligen los
   * límites más bajos que ofrezca (primera opción de cada desplegable y de cada grupo de opciones) y, en los
   * campos vacíos, GAME_SESSION_MINUTES (30) para el tiempo y GAME_SESSION_LIMIT (10 €) para el importe.
   * Después se pulsa el botón de empezar. Todo queda en el registro.
   */
  private async fillSessionLimits(log: (msg: string) => void): Promise<boolean> {
    const dialog = this.page
      .getByRole('dialog')
      .filter({ has: this.page.locator('input:not([type="hidden"]), select') })
      .filter({ visible: true })
      .first();
    if (!(await visible(dialog, 500))) return false;
    const text = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    log(`formulario de sesión de juego: «${text}»`);

    const selects = dialog.locator('select').filter({ visible: true });
    for (let i = 0; i < (await selects.count()); i++) {
      const s = selects.nth(i);
      if (await s.inputValue().catch(() => '')) continue;
      const values = await s.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      if (values[0]) await s.selectOption(values[0]);
    }
    const radios = dialog.locator('input[type="radio"]').filter({ visible: true });
    if ((await radios.count()) && !(await dialog.locator('input[type="radio"]:checked').count())) await radios.first().check();
    const inputs = dialog.locator('input[type="number"], input[type="text"], input:not([type])').filter({ visible: true });
    for (let i = 0; i < (await inputs.count()); i++) {
      const input = inputs.nth(i);
      if (await input.inputValue().catch(() => '')) continue;
      const label = `${await input.getAttribute('aria-label')} ${await input.getAttribute('name')} ${await input.getAttribute('placeholder')}`;
      const isTime = /min|tiempo|time|duraci/i.test(label);
      await input.fill(isTime ? process.env.GAME_SESSION_MINUTES ?? '30' : process.env.GAME_SESSION_LIMIT ?? '10');
      log(`campo «${label.replace(/null/g, '').trim()}» = ${isTime ? 'minutos' : 'importe'}`);
    }
    const start = dialog
      .getByRole('button', { name: /iniciar|empezar|comenzar|continuar|jugar|aceptar|confirmar|guardar/i })
      .filter({ visible: true })
      .first();
    if (!(await visible(start, 2000))) {
      log('formulario de sesión de juego sin botón para empezar');
      return false;
    }
    log(`pulsado «${(await start.innerText().catch(() => '')).trim()}»`);
    await start.click();
    return true;
  }
}
