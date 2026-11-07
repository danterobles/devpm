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

/**
 * Lectura de CSV (RFC 4180): comillas dobles con `""` escapado, saltos de línea dentro de comillas,
 * CRLF o LF, BOM UTF-8 y separador coma o punto y coma (se detecta en la cabecera). Ignora las líneas
 * vacías. No interpreta fórmulas: todo es texto.
 * @param {string} input
 * @returns {{ header: string[], rows: { line: number, cells: string[] }[], delimiter: string }}
 */
export function parseCsv(input) {
  const raw = String(input ?? '');
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '');
  const delimiter =
    (outsideQuotes.match(/;/g) ?? []).length > (outsideQuotes.match(/,/g) ?? []).length ? ';' : ',';

  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const endCell = () => {
    cells.push(cell.trim());
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c !== '')) records.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length > 0) endRecord();

  const [head, ...rest] = records;
  return { header: (head?.cells ?? []).map((h) => h.toLowerCase()), rows: rest, delimiter };
}
