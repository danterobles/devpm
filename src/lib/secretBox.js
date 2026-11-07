import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado en reposo de secretos pequeños (p. ej. el secreto TOTP): AES-256-GCM con una clave
 * derivada de `SESSION_SECRET`. Formato: base64(iv 12 B | etiqueta 16 B | cifrado).
 * Cambiar `SESSION_SECRET` hace ilegibles los secretos guardados (PRD §5.18).
 */
export function createSecretBox(secret) {
  const key = Buffer.from(hkdfSync('sha256', secret, 'devpm', 'secret-box-v1', 32));
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    /** @returns {string|null} el texto, o `null` si el contenido fue alterado o la clave cambió */
    decrypt(blob) {
      try {
        const raw = Buffer.from(String(blob), 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
          'utf8',
        );
      } catch {
        return null;
      }
    },
  };
}
