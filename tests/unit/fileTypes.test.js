import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectType, extensionOf } from '../../src/modules/attachments/fileTypes.js';
import { cleanName } from '../../src/modules/attachments/attachments.service.js';

// Tipos de adjuntos permitidos (PRD §5.16): se decide por el contenido y la extensión debe coincidir.
const bytes = (...b) => Buffer.from(b);
const text = (s) => Buffer.from(s, 'utf8');
const SAMPLES = {
  'foto.png': bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0),
  'foto.jpg': bytes(0xff, 0xd8, 0xff, 0xe0, 0),
  'foto.JPEG': bytes(0xff, 0xd8, 0xff, 0xe1, 0),
  'anim.gif': text('GIF89a....'),
  'foto.webp': Buffer.concat([text('RIFF'), bytes(1, 2, 3, 4), text('WEBP')]),
  'doc.pdf': text('%PDF-1.7\n'),
  'a.docx': bytes(0x50, 0x4b, 0x03, 0x04, 0),
  'a.xlsx': bytes(0x50, 0x4b, 0x03, 0x04, 0),
  'a.pptx': bytes(0x50, 0x4b, 0x03, 0x04, 0),
  'a.doc': bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0),
  'a.xls': bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0),
  'a.ppt': bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0),
  'notas.txt': text('Hola\nmundo — ñandú\t✓'),
  'datos.csv': text('a,b\n1,2\n'),
};

test('detecta cada tipo permitido por su contenido y extensión', () => {
  const found = Object.fromEntries(Object.entries(SAMPLES).map(([n, b]) => [n, detectType(n, b)]));
  assert.equal(found['foto.png'], 'image/png');
  assert.equal(found['foto.jpg'], 'image/jpeg');
  assert.equal(found['foto.JPEG'], 'image/jpeg');
  assert.equal(found['anim.gif'], 'image/gif');
  assert.equal(found['foto.webp'], 'image/webp');
  assert.equal(found['doc.pdf'], 'application/pdf');
  assert.match(found['a.docx'], /wordprocessingml/);
  assert.match(found['a.xlsx'], /spreadsheetml/);
  assert.match(found['a.pptx'], /presentationml/);
  assert.equal(found['a.doc'], 'application/msword');
  assert.equal(found['a.xls'], 'application/vnd.ms-excel');
  assert.equal(found['a.ppt'], 'application/vnd.ms-powerpoint');
  assert.equal(found['notas.txt'], 'text/plain');
  assert.equal(found['datos.csv'], 'text/csv');
});

test('rechaza una extensión que no coincide con el contenido', () => {
  const png = SAMPLES['foto.png'];
  assert.equal(detectType('foto.jpg', png), null, 'PNG con extensión .jpg');
  assert.equal(detectType('foto.pdf', png), null);
  assert.equal(
    detectType('script.png', text('<script>alert(1)</script>')),
    null,
    'HTML disfrazado de imagen',
  );
  assert.equal(detectType('x.docx', text('no es un zip')), null);
  assert.equal(detectType('x.doc', bytes(0x50, 0x4b, 0x03, 0x04)), null);
});

test('rechaza tipos fuera de la lista aunque el contenido sea inocuo', () => {
  for (const name of [
    'a.html',
    'a.htm',
    'a.svg',
    'a.js',
    'a.exe',
    'a.sh',
    'a.php',
    'a.zip',
    'a.xml',
    'a.json',
    'a.bat',
    'sin-extension',
    'a.',
  ])
    assert.equal(detectType(name, text('texto inofensivo')), null, name);
  assert.equal(
    detectType(
      'a.svg',
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ),
    null,
  );
  assert.equal(detectType('a.exe', bytes(0x4d, 0x5a, 0x90, 0)), null, 'ejecutable de Windows');
});

test('un .txt o .csv debe ser texto: se rechazan binarios y bytes nulos', () => {
  assert.equal(detectType('a.txt', bytes(0x89, 0x50, 0x4e, 0x47, 0x00)), null);
  assert.equal(detectType('a.txt', bytes(0xff, 0xfe, 0xfd)), null, 'UTF-8 inválido');
  assert.equal(detectType('a.csv', text('a\u0001b')), null, 'caracteres de control');
  assert.equal(detectType('a.txt', Buffer.alloc(0)), null, 'vacío');
});

test('extensionOf y cleanName: sin rutas, sin caracteres de control y acotados', () => {
  assert.equal(extensionOf('Informe.FINAL.PDF'), '.pdf');
  assert.equal(extensionOf('sin-extension'), '');
  assert.equal(cleanName('../../etc/passwd.png'), 'passwd.png');
  assert.equal(cleanName('C:\\Users\\ana\\foto.png'), 'foto.png');
  assert.equal(cleanName('.htaccess'), 'htaccess');
  assert.equal(cleanName('a\u0000b\nc.png'), 'abc.png');
  assert.equal(cleanName('x'.repeat(300) + '.png').length, 120);
  assert.equal(cleanName(undefined), 'archivo');
  assert.equal(cleanName('   '), 'archivo');
  assert.equal(cleanName('Reporte ñandú 2026.pdf'), 'Reporte ñandú 2026.pdf');
});
