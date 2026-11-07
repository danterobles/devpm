import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUri,
  stepOf,
  verifyTotp,
} from '../../src/lib/totp.js';
import { createSecretBox } from '../../src/lib/secretBox.js';

// RFC 4226 (apéndice D) y RFC 6238 (apéndice B) usan el secreto ASCII «12345678901234567890».
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('base32: ida y vuelta, mayúsculas, espacios y guiones se ignoran, y rechaza caracteres inválidos', () => {
  const bytes = Buffer.from([1, 2, 3, 250, 251, 252, 0, 255]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(base32Decode('mzxw 6ytb-oi').toString(), 'foobar');
  assert.throws(() => base32Decode('MZXW6YT1'), /inválida/);
});

test('HOTP: vectores de la RFC 4226', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  expected.forEach((code, counter) =>
    assert.equal(hotp(RFC_SECRET, counter), code, `contador ${counter}`),
  );
});

test('TOTP: vectores de la RFC 6238 (SHA-1, últimos 6 dígitos de los códigos de 8)', () => {
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];
  for (const [seconds, code] of vectors)
    assert.equal(
      verifyTotp(RFC_SECRET, code, { timeMs: seconds * 1000, window: 0 }),
      stepOf(seconds * 1000),
      `t=${seconds}`,
    );
});

test('verifyTotp: ventana de ±1 intervalo, formato y reutilización', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const t = 1_700_000_000_000;
  const now = stepOf(t);
  const code = (step) => hotp(secret, step);
  assert.equal(verifyTotp(secret, code(now), { timeMs: t }), now);
  assert.equal(
    verifyTotp(secret, code(now - 1), { timeMs: t }),
    now - 1,
    'intervalo anterior (desfase de reloj)',
  );
  assert.equal(verifyTotp(secret, code(now + 1), { timeMs: t }), now + 1);
  assert.equal(verifyTotp(secret, code(now - 2), { timeMs: t }), null, 'fuera de la ventana');
  assert.equal(
    verifyTotp(secret, code(now), { timeMs: t, afterStep: now }),
    null,
    'ya usado: no se reutiliza',
  );
  assert.equal(verifyTotp(secret, code(now + 1), { timeMs: t, afterStep: now }), now + 1);
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5'])
    assert.equal(verifyTotp(secret, bad, { timeMs: t }), null, String(bad));
  assert.equal(
    verifyTotp(secret, ` ${code(now).slice(0, 3)} ${code(now).slice(3)} `, { timeMs: t }),
    now,
    'tolera espacios',
  );
});

test('otpauthUri incluye cuenta, emisor y parámetros', () => {
  const uri = otpauthUri({ secret: 'ABC234', account: 'ana@empresa.com' });
  assert.equal(
    uri,
    'otpauth://totp/DevPM%3Aana%40empresa.com?secret=ABC234&issuer=DevPM&algorithm=SHA1&digits=6&period=30',
  );
});

test('secretBox: cifra y descifra, cada cifrado es distinto y detecta alteraciones o una clave distinta', () => {
  const box = createSecretBox('x'.repeat(40));
  const a = box.encrypt('JBSWY3DPEHPK3PXP');
  const b = box.encrypt('JBSWY3DPEHPK3PXP');
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /JBSWY3DP/);
  assert.equal(box.decrypt(a), 'JBSWY3DPEHPK3PXP');
  const tampered = Buffer.from(a, 'base64');
  tampered[tampered.length - 1] ^= 1;
  assert.equal(box.decrypt(tampered.toString('base64')), null);
  assert.equal(createSecretBox('y'.repeat(40)).decrypt(a), null, 'otra SESSION_SECRET');
  assert.equal(box.decrypt('no es base64 válido'), null);
  assert.equal(box.decrypt(''), null);
});
