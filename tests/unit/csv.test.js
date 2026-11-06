import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../../src/lib/csv.js';

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
