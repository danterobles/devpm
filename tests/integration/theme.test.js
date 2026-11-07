import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

// Rediseño visual (RNF-12): tema claro/oscuro/sistema, riel de navegación y selector de tema.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

async function loginAs(role) {
  const db = createTestDb();
  user(db, { email: `${role}@test.local`, password_hash: hash, role });
  const agent = request.agent(buildTestApp({ db }));
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('toda página carga theme.js en <head> antes de la hoja de estilos (sin destello al aplicar el tema)', async () => {
  const agent = await loginAs('pm');
  for (const url of ['/', '/dashboard', '/projects']) {
    const html = (await agent.get(url)).text;
    const head = /<head>[\s\S]*<\/head>/.exec(html)[0];
    assert.ok(head.indexOf('/js/lib/theme.js') > -1, `${url} carga theme.js`);
    assert.ok(head.indexOf('/js/lib/theme.js') < head.indexOf('/css/output.css'), url);
    assert.doesNotMatch(html, /<script>[^<]/, 'sin scripts en línea (CSP)');
  }
});

test('el login también se muestra con el selector de tema, aun sin sesión', async () => {
  const html = (await request(buildTestApp({ db: createTestDb() })).get('/login')).text;
  assert.match(html, /data-theme-choice="system"/);
  assert.doesNotMatch(html, /aria-label="Principal"[\s\S]*href="\/clients"/); // sin menú de secciones
});

test('el encabezado ofrece Sistema, Claro y Oscuro y la sección activa lleva aria-current', async () => {
  const agent = await loginAs('pm');
  const html = (await agent.get('/dashboard')).text;
  for (const choice of ['system', 'light', 'dark'])
    assert.match(html, new RegExp(`data-theme-choice="${choice}"`));
  assert.match(html, /<a href="\/dashboard"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<a href="\/projects"[^>]*aria-current="page"/);
  const projects = (await agent.get('/projects')).text;
  assert.match(projects, /<a href="\/projects"[^>]*aria-current="page"/);
});

test('los enlaces del riel tienen nombre accesible aunque solo se vea el icono', async () => {
  const agent = await loginAs('admin');
  const html = (await agent.get('/dashboard')).text;
  for (const label of [
    'Tablero',
    'Clientes',
    'Equipo',
    'Proyectos',
    'Portafolio',
    'Carga',
    'Tiempo',
    'Usuarios',
  ])
    assert.match(html, new RegExp(`<span class="md:sr-only">${label}</span>`), label);
});

test('el tablero carga chart-theme.js y las gráficas siguen el tema', async () => {
  const agent = await loginAs('pm');
  const html = (await agent.get('/dashboard')).text;
  assert.match(html, /\/js\/lib\/chart-theme\.js/);
  assert.ok(html.indexOf('chart.umd.min.js') < html.indexOf('chart-theme.js'));
});
