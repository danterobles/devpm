// Serialización CSV segura (RFC 4180) con protección contra inyección de fórmulas.
// Marca de orden de bytes UTF-8: Excel la usa para detectar la codificación.
const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Una celda: neutraliza fórmulas (prefijo «'») y entrecomilla cuando hace falta. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Documento CSV completo: BOM UTF-8 (para Excel), encabezados y filas separadas con CRLF.
 * @param {{key: string, header: string}[]} columns
 * @param {Record<string, unknown>[]} rows
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
