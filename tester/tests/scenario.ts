/**
 * Spec común a los dos escenarios (DISENO.md §6.1): RUN_MODE=real → runScenario; simulated → simulateScenario.
 * Un expect.soft por check: el test marca cada FAIL pero el informe se escribe siempre.
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Scenario } from '../src/contracts/schemas';
import { authFile, loadRunConfig, marketFromEnv, readCredentials, runMode } from '../src/config/RunConfig';
import { runScenario } from '../src/scenarios/runScenario';
import { simulateScenario } from '../src/scenarios/simulateScenario';
import { writeRunReport } from '../src/report/Report';
import { live } from '../src/live/LiveFeed';

export function scenarioTest(scenario: Scenario) {
  const market = marketFromEnv();
  const mode = runMode();
  const state = authFile(market, scenario);
  test.use({ storageState: mode === 'real' && fs.existsSync(state) ? state : { cookies: [], origins: [] } });

  test(`${scenario} · ${market} · ${mode}`, async ({ page, context }, testInfo) => {
    const cfg = loadRunConfig(market, scenario, mode);
    // Sin credenciales no hay nada que probar en real: se salta con el motivo en vez de dar FAIL en cadena
    test.skip(
      mode === 'real' && !readCredentials(cfg),
      `Faltan ${cfg.credentialEnv.userEnv} y ${cfg.credentialEnv.passEnv} (en tester/.env o en el .env de la raíz del repo)`,
    );
    const report = mode === 'real' ? await runScenario({ page, context, cfg, testInfo }) : await simulateScenario({ page, cfg });
    const { dir, secrets, contractErrors } = writeRunReport(report, cfg);
    live('done', { run: `${market}-${scenario}`, ok: report.checks.every((c) => c.result === 'PASS'), checks: report.checks.length, passed: report.checks.filter((c) => c.result === 'PASS').length });
    await testInfo.attach('report.html', { path: `${dir}/report.html`, contentType: 'text/html' });
    await testInfo.attach('report.json', { path: `${dir}/report.json`, contentType: 'application/json' });

    console.log(`\n  Informe: tester/reports/${market}-${scenario}/report.html`);
    for (const p of report.phases.filter((x) => x.status !== 'ok')) console.log(`  ${p.phase} ${p.status}: ${p.reason}`);
    for (const c of report.checks) console.log(`  ${c.result === 'PASS' ? '✔' : '✘'} ${c.id} · ${c.observed}`);

    expect.soft(contractErrors, 'el informe cumple el contrato C14').toEqual([]);
    expect.soft(secrets, 'el informe no contiene secretos').toEqual([]);
    for (const c of report.checks) expect.soft(c.result, `${c.id}: ${c.message}`).toBe('PASS');
  });
}
