import { expect, test } from '@playwright/test';
import { findSecrets, redact, redactText } from '../../src/evidence/redact';

test('la censura elimina tokens de URLs, cuerpos y claves', () => {
  const s = 'https://x/gs2c/ge/v5/gameService?mgckey=AUTHTOKEN@abc123~stylename@x&symbol=vs20bblup&ssid=99';
  const out = redactText(s);
  expect(findSecrets(out)).toEqual([]);
  expect(out).not.toContain('abc123');
  const obj = redact({ mgckey: 'secret', nested: { gameSessionId: 'x', ok: 'Authorization: Bearer abc.def' } });
  expect(findSecrets(JSON.stringify(obj))).toEqual([]);
  expect(JSON.stringify(obj)).not.toContain('secret');
});

test('el escáner detecta patrones y valores de credenciales', () => {
  expect(findSecrets('Cookie: a=b')).not.toEqual([]);
  process.env.BETSSON_TEST_USER = 'usuario-de-prueba';
  expect(findSecrets('hola usuario-de-prueba')).toContain('valor de credencial BETSSON_*');
  expect(redactText('hola usuario-de-prueba')).toBe('hola ***');
  delete process.env.BETSSON_TEST_USER;
});
