/**
 * Tipos de archivo permitidos como adjuntos (PRD §5.16). Se decide por el **contenido** (firma del
 * archivo), nunca por lo que declare el navegador, y la extensión debe coincidir con lo detectado.
 * HTML, SVG, scripts y ejecutables no están en la lista.
 */
const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Texto plano: UTF-8 válido, sin bytes nulos ni caracteres de control (salvo tab y saltos de línea). */
function isPlainText(buf) {
  if (buf.includes(0)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    // eslint-disable-next-line no-control-regex
    return !/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
  } catch {
    return false;
  }
}

export const TYPES = [
  {
    type: 'image/png',
    exts: ['.png'],
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { type: 'image/jpeg', exts: ['.jpg', '.jpeg'], test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    type: 'image/gif',
    exts: ['.gif'],
    test: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  },
  {
    type: 'image/webp',
    exts: ['.webp'],
    test: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  },
  { type: 'application/pdf', exts: ['.pdf'], test: (b) => startsWith(b, ascii('%PDF-')) },
  {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    exts: ['.docx'],
    test: (b) => startsWith(b, ZIP),
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    exts: ['.xlsx'],
    test: (b) => startsWith(b, ZIP),
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    exts: ['.pptx'],
    test: (b) => startsWith(b, ZIP),
  },
  { type: 'application/msword', exts: ['.doc'], test: (b) => startsWith(b, OLE) },
  { type: 'application/vnd.ms-excel', exts: ['.xls'], test: (b) => startsWith(b, OLE) },
  { type: 'application/vnd.ms-powerpoint', exts: ['.ppt'], test: (b) => startsWith(b, OLE) },
  { type: 'text/plain', exts: ['.txt'], test: isPlainText },
  { type: 'text/csv', exts: ['.csv'], test: isPlainText },
];

export const ALLOWED_EXTENSIONS = TYPES.flatMap((t) => t.exts);

/** Extensión en minúsculas (con punto) o cadena vacía. */
export function extensionOf(name) {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Tipo MIME verificado, o `null` si la extensión no está permitida o el contenido no corresponde.
 * @param {string} name nombre original
 * @param {Buffer} buffer contenido
 */
export function detectType(name, buffer) {
  const ext = extensionOf(name);
  const found = TYPES.find((t) => t.exts.includes(ext));
  return found && buffer.length > 0 && found.test(buffer) ? found.type : null;
}
