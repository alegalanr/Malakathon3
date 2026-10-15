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
    // Consentimiento ya guardado en la sesión (cookie estándar de OneTrust): no se espera a un banner que no saldrá
    const cookies = await this.page.context().cookies().catch(() => []);
    if (cookies.some((c) => c.name === 'OptanonAlertBoxClosed')) return 'consentimiento ya guardado (sin banner)';
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

  /** Se resuelve cuando aparece «Iniciar sesión»; si no aparece en `timeout`, no se resuelve nunca (para usar en carreras). */
  loginButtonShown(timeout: number): Promise<'logged-out'> {
    return loginButton(this.page)
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => 'logged-out' as const, () => new Promise<never>(() => {}));
  }

  async isLoggedIn(): Promise<boolean> {
    await this.page.waitForTimeout(1500);
    return !(await visible(loginButton(this.page), 4000));
  }

  /** F1: sesión iniciada en el dominio del mercado (C2). */
  async session(opts: { walletSeen?: boolean } = {}): Promise<SessionState> {
    const finalUrl = this.page.url();
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    const expected = new URL(this.cfg.baseUrl).hostname.replace(/^www\./, '');
    if (host !== expected) throw new MarketMismatchError(`mercado incorrecto: ${host} (se esperaba ${expected})`);
    // Si la cartera ya respondió, la sesión está iniciada y el encabezado ya está pintado: comprobación inmediata
    const loggedIn = opts.walletSeen ? !(await loginButton(this.page).first().isVisible().catch(() => false)) : await this.isLoggedIn();
    if (!loggedIn) throw new LoginError('sesión no iniciada: sigue visible «Iniciar sesión»');
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
   * ⚠️ Sesión de juego obligatoria (DGOJ): ventana con límites antes de jugar. Se detecta y se confirma
   * con los valores que traiga por defecto; si exige rellenar algo, se devuelve 'blocked' con captura.
   */
  async handleGameSession(): Promise<'none' | 'confirmed' | 'blocked'> {
    const dialog = this.page
      .locator('[role="dialog"], fds-modal, fds-dialog, dialog')
      .filter({ hasText: /sesi[oó]n de juego|l[ií]mite de (tiempo|gasto|p[eé]rdida)/i })
      .first();
    if (!(await visible(dialog, 6000))) return 'none';
    const confirm = dialog
      .locator('fds-button, button')
      .filter({ hasText: /empezar|iniciar|comenzar|continuar|jugar|aceptar|confirmar/i })
      .first();
    if (await visible(confirm, 2000)) {
      await confirm.click();
      if (!(await visible(dialog, 4000))) return 'confirmed';
    }
    return 'blocked';
  }
}
