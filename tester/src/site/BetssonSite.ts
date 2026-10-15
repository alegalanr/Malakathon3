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
  /** Última petición al lanzador de juegos de Betsson (sin guardar la URL: lleva el token de sesión). */
  private launcher?: { forReal: boolean; t: number };

  constructor(
    private page: Page,
    private cfg: RunConfig,
  ) {
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/v\d+\/Gamelauncher\//i.test(u)) this.launcher = { forReal: new URL(u).searchParams.get('forReal') === 'true', t: Date.now() };
    });
  }

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
    // ✔ (15/10) Con sesión, la página del juego ya lo lanza en Real Play (Gamelauncher forReal=true):
    // recargar con ?gameAction=play solo reiniciaba la carga (~30 MB) desde cero.
    const since = Date.now() - 15_000;
    for (let i = 0; i < 12 && !(this.launcher && this.launcher.t >= since); i++) await this.page.waitForTimeout(500);
    if (this.launcher && this.launcher.t >= since && this.launcher.forReal) return 'Real Play directo (lanzador con forReal=true)';
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
   * con «Iniciar sesión» / «Volver a Casino». Se pulsa como un jugador; si después sale el formulario de
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
    let attempts = 0;
    while (Date.now() < until) {
      if ((await this.hasGameFrame()) && !(await visible(required, 300))) return 'confirmed';
      // Hasta 3 intentos: si el formulario sigue abierto (validación), se vuelve a rellenar
      if (attempts < 3 && (await this.fillSessionLimits(log))) {
        attempts++;
        await this.page.waitForTimeout(2000);
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
   * ✔ (15/10) Formulario de la sesión de juego («Se ha sobrepasado el límite de tiempo de sesión»):
   * «Tiempo de juego» con botones (15 Min … 5 Horas), «Límite de pérdidas» con campo y botones de
   * porcentaje del saldo (25 % … 100 %) y «Iniciar sesión». Se elige GAME_SESSION_TIME («5 Horas») y
   * GAME_SESSION_LOSS («100%»), lo que decidió el equipo para la cuenta de prueba.
   * NUNCA se toca «Más opciones»: ahí está el «Tiempo de exclusión», que autoexcluye la cuenta y no se puede deshacer.
   */
  private async fillSessionLimits(log: (msg: string) => void): Promise<boolean> {
    const dialog = this.page.getByRole('dialog').filter({ hasText: /tiempo de juego/i }).filter({ visible: true }).first();
    if (!(await visible(dialog, 500))) return false;
    const time = process.env.GAME_SESSION_TIME ?? '5 Horas';
    const loss = process.env.GAME_SESSION_LOSS ?? '100%';
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const timeButton = dialog.getByRole('button', { name: new RegExp(`^\\s*${esc(time)}\\s*$`, 'i') });
    const lossButton = dialog.getByRole('button', { name: new RegExp(`^\\s*${esc(loss)}`, 'i') });
    const start = dialog.getByRole('button', { name: /^\s*iniciar sesi[oó]n\s*$/i });
    if (!(await visible(timeButton, 2000)) || !(await visible(lossButton, 2000)) || !(await visible(start, 2000))) {
      log(`formulario de sesión de juego sin «${time}», «${loss}» o «Iniciar sesión»: no se rellena`);
      return false;
    }
    await timeButton.first().click();
    await lossButton.first().click();
    log(`formulario de sesión de juego: tiempo «${time}», límite de pérdidas «${loss}» → «Iniciar sesión»`);
    await start.first().click();
    return true;
  }
}
