import nodemailer from 'nodemailer';

/**
 * Envoltorio de nodemailer (RF-101). Sin `smtp.host` queda deshabilitado y `send` no hace nada.
 * Un fallo de envío se registra y nunca se propaga: el correo no puede romper la operación.
 * `transport` permite inyectar uno de pruebas (p. ej. `jsonTransport`).
 * @param {{ smtp: object, logger?: object, transport?: object }} options
 */
export function createMailer({ smtp, logger = null, transport = null }) {
  const enabled = Boolean(transport || smtp?.host);
  const real =
    transport ??
    (smtp?.host
      ? nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
        })
      : null);
  return {
    enabled,
    /** @returns {Promise<boolean>} true si el servidor aceptó el mensaje */
    async send({ to, subject, text }) {
      if (!real) return false;
      try {
        await real.sendMail({ from: smtp?.from, to, subject, text });
        return true;
      } catch (err) {
        logger?.warn({ err: err.message, event: 'mail.failed' }, 'No se pudo enviar el correo');
        return false;
      }
    },
  };
}
