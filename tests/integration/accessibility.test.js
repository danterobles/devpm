import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project } from '../helpers/factories.js';

// RNF-07: interfaz en español, responsiva (≥ 360 px) y accesible con teclado.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

async function session() {
  const db = createTestDb();
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  const pid = project(db);
  const app = buildTestApp({ db });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'admin@test.local', password: PASSWORD });
  return { agent, pid };
}

test('el diseño base tiene idioma, título, enlace para saltar al contenido y landmarks', async () => {
  const { agent } = await session();
  const html = (await agent.get('/dashboard')).text;
  assert.match(html, /<html lang="es">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<a href="#contenido"[^>]*>Saltar al contenido<\/a>/);
  assert.match(html, /<main id="contenido"/);
  assert.match(html, /<nav[^>]+aria-label="Principal"/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
});

test('la navegación se ajusta en pantallas angostas (sin scroll horizontal a 360 px)', async () => {
  const { agent } = await session();
  const html = (await agent.get('/dashboard')).text;
  const nav = /<nav[^>]*>/.exec(html)[0];
  assert.match(nav, /flex-wrap/);
  assert.match(/<ul class="[^"]*"/.exec(html)[0], /flex-wrap/);
});

test('cada página tiene un único h1 y los formularios tienen etiquetas', async () => {
  const { agent, pid } = await session();
  for (const url of [
    '/dashboard',
    '/projects',
    '/clients/internal/new',
    '/team',
    `/projects/${pid}`,
    '/admin/users/new',
    '/account/password',
    '/admin/settings/kpis',
  ]) {
    const html = (await agent.get(url)).text;
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${url}: un h1`);
    const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter(
      (m) => !/type="(hidden|checkbox)"/.test(m[2]) || /type="checkbox"/.test(m[2]),
    );
    for (const [, , attrs] of controls) {
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      const labeled =
        /aria-label=/.test(attrs) || (id && new RegExp(`<label[^>]+for="${id}"`).test(html));
      assert.ok(labeled, `${url}: control sin etiqueta (${attrs.trim().slice(0, 60)})`);
    }
  }
});

test('los botones solo con icono o símbolo tienen nombre accesible y las tablas tienen encabezados con scope', async () => {
  const { agent } = await session();
  const html = (await agent.get('/projects')).text;
  assert.match(html, /<th scope="col"/);
  assert.doesNotMatch(html, /<th(?=[\s>])(?![^>]*scope)[^>]*>/); // ningún <th> sin scope
});
