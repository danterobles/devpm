import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238 / HOTP RFC 4226) con HMAC-SHA1, 6 dígitos e intervalos de 30 s (compatible con las apps comunes). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new Error('Clave base32 inválida');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo de 160 bits en base32 (20 bytes → 32 caracteres). */
export const generateSecret = () => base32Encode(randomBytes(20));

/** HOTP(secreto, contador) → código de `DIGITS` dígitos. */
export function hotp(secretBase32, counter, digits = DIGITS) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepOf = (timeMs = Date.now()) => Math.floor(timeMs / 1000 / STEP_SECONDS);

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Verifica un código con ventana de ±`window` intervalos. Devuelve el intervalo que coincidió o
 * `null`. Con `afterStep` se rechazan los intervalos ya usados (un código no se reutiliza).
 */
export function verifyTotp(
  secretBase32,
  code,
  { timeMs = Date.now(), window = 1, afterStep = null } = {},
) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = stepOf(timeMs);
  let found = null;
  for (let step = now - window; step <= now + window; step += 1) {
    if (afterStep !== null && step <= afterStep) continue;
    if (safeEqual(hotp(secretBase32, step), clean)) found = step; // no corta: tiempo constante
  }
  return found;
}

/** Dirección `otpauth://` para las apps de autenticación. */
export function otpauthUri({ secret, account, issuer = 'DevPM' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
