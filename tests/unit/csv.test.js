import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, parseCsv, toCsv } from '../../src/lib/csv.js';

test('csvCell: valores simples sin comillas', () => {
  assert.equal(csvCell('hola'), 'hola');
  assert.equal(csvCell(12), '12');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('csvCell: entrecomilla y duplica comillas con comas, comillas y saltos de línea', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('dijo "hola"'), '"dijo ""hola"""');
  assert.equal(csvCell('línea1\nlínea2'), '"línea1\nlínea2"');
  assert.equal(csvCell('a\r\nb'), '"a\r\nb"');
});

test('csvCell: neutraliza inyección de fórmulas (=, +, -, @, tab, retorno)', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) {
    const out = csvCell(evil);
    assert.ok(out.replace(/^"/, '').startsWith("'"), `${JSON.stringify(evil)} → ${out}`);
  }
  assert.equal(csvCell('=HYPERLINK("http://x","a")'), '"\'=HYPERLINK(""http://x"",""a"")"');
  assert.equal(csvCell('texto - normal'), 'texto - normal');
});

test('toCsv: BOM UTF-8, encabezados, CRLF y filas en el orden de las columnas', () => {
  const csv = toCsv(
    [
      { key: 'a', header: 'Columna A' },
      { key: 'b', header: 'B, con coma' },
    ],
    [
      { a: 1, b: 'x' },
      { a: '=cmd', b: null },
    ],
  );
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1), 'Columna A,"B, con coma"\r\n1,x\r\n\'=cmd,\r\n');
});

// ---- Lectura (importación, PRD §5.14) ----

test('parseCsv: cabecera en minúsculas, filas con su línea y celdas recortadas', () => {
  const r = parseCsv('Nombre, Correo\r\nAna , ana@x.co\r\n\r\nBeto,beto@x.co\r\n');
  assert.deepEqual(r.header, ['nombre', 'correo']);
  assert.deepEqual(r.rows, [
    { line: 2, cells: ['Ana', 'ana@x.co'] },
    { line: 4, cells: ['Beto', 'beto@x.co'] },
  ]);
  assert.equal(r.delimiter, ',');
});

test('parseCsv: comillas, comas y saltos de línea dentro de una celda, y comillas escapadas', () => {
  const r = parseCsv('a,b\n"uno, dos","línea 1\nlínea 2"\n"dice ""hola""",x\n');
  assert.deepEqual(r.rows[0].cells, ['uno, dos', 'línea 1\nlínea 2']);
  assert.deepEqual(r.rows[1].cells, ['dice "hola"', 'x']);
  assert.equal(r.rows[1].line, 4, 'la línea cuenta los saltos dentro de comillas');
});

test('parseCsv: detecta punto y coma, ignora el BOM y acepta un archivo sin salto final', () => {
  const r = parseCsv(String.fromCharCode(0xfeff) + 'a;b\n1;2');
  assert.deepEqual(r.header, ['a', 'b']);
  assert.deepEqual(r.rows[0].cells, ['1', '2']);
  assert.equal(r.delimiter, ';');
});

test('parseCsv: entrada vacía o solo cabecera no produce filas y las celdas vacías se conservan', () => {
  assert.deepEqual(parseCsv('').rows, []);
  assert.deepEqual(parseCsv('a,b\n').rows, []);
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n').rows[0].cells, ['1', '', '3']);
});

test('parseCsv es la inversa de toCsv (ida y vuelta, incluidas fórmulas neutralizadas)', () => {
  const cols = [
    { key: 'a', header: 'a' },
    { key: 'b', header: 'b' },
  ];
  const csv = toCsv(cols, [{ a: 'x, "y"', b: 'línea\nnueva' }]);
  assert.deepEqual(parseCsv(csv).rows[0].cells, ['x, "y"', 'línea\nnueva']);
});
