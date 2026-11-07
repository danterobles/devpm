import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { createMailer } from '../../src/lib/mailer.js';
import { setClock } from '../../src/lib/dates.js';
import { hotp, stepOf } from '../../src/lib/totp.js';
import { user } from '../helpers/factories.js';

// Recuperación de contraseña y autenticación en dos pasos (RF-160 a RF-165).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup({ smtp = true, limit = 10 } = {}) {
  const sent = [];
  const mailer = smtp
    ? createMailer({
        smtp: { from: 'DevPM <x@t>' },
        transport: { sendMail: async (m) => sent.push(m) },
      })
    : createMailer({ smtp: { host: null } });
  const db = createTestDb();
  const ids = {
    admin: user(db, {
      email: 'admin@t.local',
      password_hash: hash,
      role: 'admin',
      full_name: 'Ada Admin',
    }),
    dev: user(db, {
      email: 'dev@t.local',
      password_hash: hash,
      role: 'developer',
      full_name: 'Ana Dev',
    }),
    other: user(db, { email: 'other@t.local', password_hash: hash, role: 'viewer' }),
  };
  const app = buildTestApp({
    db,
    mailer,
    config: testConfig({ LOGIN_MAX_ATTEMPTS: String(limit) }),
  });
  return { db, app, sent, ids };
}
const login = (agent, who = 'dev', password = PASSWORD) =>
  agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password });
async function loggedIn(app, who = 'dev') {
  const agent = request.agent(app);
  await login(agent, who);
  return agent;
}
const events = (db, type) =>
  db
    .prepare('SELECT * FROM security_events WHERE (? IS NULL OR type = ?) ORDER BY id')
    .all(type ?? null, type ?? null);
const tokenFrom = (mail) => /token=([a-f0-9]{64})/.exec(mail.text)[1];
const flush = () => new Promise((r) => setImmediate(r));

// ---------------- Recuperación de contraseña ----------------

test('sin correo configurado la página lo explica y no se genera ningún enlace', async () => {
  const { app, db } = setup({ smtp: false });
  assert.match((await request(app).get('/forgot-password')).text, /no tiene correo configurado/);
  const res = await request(app)
    .post('/forgot-password')
    .type('form')
    .send({ email: 'dev@t.local' });
  assert.match(res.text, /no tiene correo configurado/);
  assert.equal(db.prepare('SELECT count(*) FROM password_resets').pluck().get(), 0);
});

test('las rutas de recuperación son públicas y el login ofrece el enlace', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/forgot-password')).status, 200);
  assert.match((await request(app).get('/login')).text, /href="\/forgot-password"/);
});

test('solicitar: respuesta idéntica exista o no la cuenta; solo se envía a las cuentas activas; el token se guarda con hash', async () => {
  const { app, db, sent } = setup();
  const ok = await request(app)
    .post('/forgot-password')
    .type('form')
    .send({ email: 'dev@t.local' });
  const ghost = await request(app)
    .post('/forgot-password')
    .type('form')
    .send({ email: 'nadie@t.local' });
  assert.equal(ok.status, 200);
  assert.equal(ghost.status, ok.status);
  assert.match(ok.text, /Si existe una cuenta con ese correo/);
  assert.equal(
    ghost.text.match(/<p role="status"[^>]*>[^<]+/)[0],
    ok.text.match(/<p role="status"[^>]*>[^<]+/)[0],
  );
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'dev@t.local');
  assert.match(sent[0].text, /http:\/\/localhost:3000\/reset-password\?token=[a-f0-9]{64}/);
  const token = tokenFrom(sent[0]);
  const stored = db.prepare('SELECT token_hash FROM password_resets').pluck().all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0], token, 'solo se guarda el hash');
  assert.equal(events(db, 'password_reset_requested').length, 2, 'se registran ambas solicitudes');
  db.prepare('UPDATE users SET is_active = 0 WHERE email = ?').run('other@t.local');
  await request(app).post('/forgot-password').type('form').send({ email: 'other@t.local' });
  await flush();
  assert.equal(sent.length, 1, 'una cuenta inactiva no recibe correo');
});

test('límites: 5 solicitudes por IP y 3 por correo cada 15 minutos', async () => {
  const { app } = setup();
  const ask = (email) => request(app).post('/forgot-password').type('form').send({ email });
  for (let i = 0; i < 3; i += 1) assert.equal((await ask('dev@t.local')).status, 200);
  assert.equal((await ask('dev@t.local')).status, 429, 'cuarta del mismo correo');
  assert.equal((await ask('a@t.local')).status, 200, 'quinta solicitud');
  assert.equal((await ask('b@t.local')).status, 429, 'sexta solicitud desde la misma IP');
});

test('restablecer: cambia la contraseña, es de un solo uso, cierra las sesiones y registra el evento', async () => {
  const { app, db, sent } = setup();
  const old = await loggedIn(app);
  assert.equal((await old.get('/projects')).status, 200);
  await request(app).post('/forgot-password').type('form').send({ email: 'dev@t.local' });
  await flush();
  const token = tokenFrom(sent[0]);
  assert.match(
    (await request(app).get(`/reset-password?token=${token}`)).text,
    /name="newPassword"/,
  );
  const done = await request(app)
    .post('/reset-password')
    .type('form')
    .send({ token, newPassword: 'NuevaClave2026', confirmPassword: 'NuevaClave2026' });
  assert.equal(done.headers.location, '/login?reset=1');
  assert.match((await request(app).get('/login?reset=1')).text, /Contraseña actualizada/);
  assert.equal((await login(request(app), 'dev', PASSWORD)).status, 401, 'la anterior ya no sirve');
  assert.equal((await login(request(app), 'dev', 'NuevaClave2026')).headers.location, '/');
  assert.equal((await old.get('/api/v1/clients')).status, 401, 'la sesión anterior se cerró');
  const again = await request(app)
    .post('/reset-password')
    .type('form')
    .send({ token, newPassword: 'OtraClave2026', confirmPassword: 'OtraClave2026' });
  assert.equal(again.status, 400, 'el enlace no se reutiliza');
  assert.equal((await request(app).get(`/reset-password?token=${token}`)).status, 400);
  assert.equal(events(db, 'password_reset_completed').length, 1);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) FROM audit_log WHERE entity = 'user' AND changes LIKE '%restablecida%'",
      )
      .pluck()
      .get(),
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(db.prepare('SELECT * FROM audit_log').all()),
    /NuevaClave2026/,
  );
});

test('restablecer: valida la contraseña, rechaza tokens falsos o vencidos y un enlace nuevo invalida el anterior', async () => {
  const { app, db, sent } = setup();
  await request(app).post('/forgot-password').type('form').send({ email: 'dev@t.local' });
  await flush();
  const token = tokenFrom(sent[0]);
  const post = (body) =>
    request(app)
      .post('/reset-password')
      .type('form')
      .send({ token, ...body });
  assert.equal((await post({ newPassword: 'corta', confirmPassword: 'corta' })).status, 400);
  assert.equal(
    (await post({ newPassword: 'a'.repeat(73), confirmPassword: 'a'.repeat(73) })).status,
    400,
    '73 bytes',
  );
  assert.match(
    (await post({ newPassword: 'NuevaClave2026', confirmPassword: 'Distinta2026' })).text,
    /confirmación no coincide/,
  );
  assert.equal((await request(app).get('/reset-password?token=' + 'a'.repeat(64))).status, 400);
  assert.equal((await request(app).get('/reset-password?token=abc')).status, 400);
  assert.equal((await request(app).get('/reset-password')).status, 400);
  assert.equal(
    (
      await post({
        token: 'b'.repeat(64),
        newPassword: 'NuevaClave2026',
        confirmPassword: 'NuevaClave2026',
      })
    ).status,
    400,
  );
  // vencido
  db.prepare("UPDATE password_resets SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await request(app).get(`/reset-password?token=${token}`)).status, 400);
  // un enlace nuevo invalida el anterior
  await request(app).post('/forgot-password').type('form').send({ email: 'dev@t.local' });
  await flush();
  const second = tokenFrom(sent[1]);
  assert.equal((await request(app).get(`/reset-password?token=${token}`)).status, 400);
  assert.equal((await request(app).get(`/reset-password?token=${second}`)).status, 200);
  // cuenta desactivada tras pedir el enlace
  db.prepare("UPDATE users SET is_active = 0 WHERE email = 'dev@t.local'").run();
  assert.equal((await request(app).get(`/reset-password?token=${second}`)).status, 400);
});

// ---------------- Dos pasos ----------------

/** Activa el 2FA de `who` por la interfaz y devuelve su secreto y los códigos de recuperación. */
async function enable2fa(app, who = 'dev') {
  const agent = await loggedIn(app, who);
  const setupPage = (await agent.post('/account/security/setup')).text;
  const secret = /data-totp-secret[^>]*>([^<]+)</.exec(setupPage)[1].replaceAll(' ', '');
  const res = await agent
    .post('/account/security/enable')
    .type('form')
    .send({ code: hotp(secret, stepOf()) });
  const codes = [
    ...res.text.matchAll(/<li class="rounded bg-navy-50[^>]*>([a-f0-9]{5}-[a-f0-9]{5})</g),
  ].map((m) => m[1]);
  return { agent, secret, codes, res };
}

test('activar: muestra la clave, rechaza un código incorrecto y entrega 10 códigos de recuperación guardados con hash', async () => {
  const { app, db, ids } = setup();
  const agent = await loggedIn(app);
  assert.match((await agent.get('/account/security')).text, /Desactivada/);
  const setup1 = await agent.post('/account/security/setup');
  assert.match(setup1.text, /data-totp-secret/);
  assert.match(setup1.text, /otpauth:\/\/totp\/DevPM%3Adev%40t\.local\?secret=[A-Z2-7]{32}/);
  const secret = /data-totp-secret[^>]*>([^<]+)</.exec(setup1.text)[1].replaceAll(' ', '');
  const stored = db
    .prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?')
    .get(ids.dev);
  assert.equal(stored.totp_enabled, 0);
  assert.notEqual(stored.totp_secret, secret, 'el secreto se guarda cifrado');
  assert.doesNotMatch(stored.totp_secret, new RegExp(secret));
  const bad = await agent.post('/account/security/enable').type('form').send({ code: '000000' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /data-totp-secret/, 'conserva la clave pendiente');
  assert.equal(db.prepare('SELECT totp_enabled FROM users WHERE id = ?').pluck().get(ids.dev), 0);
  const ok = await agent
    .post('/account/security/enable')
    .type('form')
    .send({ code: hotp(secret, stepOf()) });
  const codes = [
    ...ok.text.matchAll(/<li class="rounded bg-navy-50[^>]*>([a-f0-9]{5}-[a-f0-9]{5})</g),
  ].map((m) => m[1]);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(db.prepare('SELECT totp_enabled FROM users WHERE id = ?').pluck().get(ids.dev), 1);
  const hashes = db.prepare('SELECT code_hash FROM recovery_codes').pluck().all();
  assert.equal(hashes.length, 10);
  assert.ok(
    codes.every((c) => !hashes.includes(c) && !hashes.includes(c.replace('-', ''))),
    'solo hashes',
  );
  assert.match((await agent.get('/account/security')).text, /Activada · te quedan 10/);
  assert.doesNotMatch(
    (await agent.get('/account/security')).text,
    /data-recovery-codes/,
    'los códigos no se vuelven a mostrar',
  );
  assert.equal(events(db, 'twofa_enabled').length, 1);
  assert.equal((await agent.post('/account/security/setup')).status, 422, 'ya activado');
});

test('la seguridad de la cuenta exige sesión', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/account/security')).headers.location, '/login');
  assert.equal((await request(app).post('/account/security/setup')).headers.location, '/login');
});

test('iniciar sesión con 2FA: la contraseña sola no da acceso; el código correcto sí y cambia el ID de sesión', async () => {
  const { app, db } = setup();
  const { secret } = await enable2fa(app);
  const agent = request.agent(app);
  const first = await login(agent);
  assert.equal(first.headers.location, '/login/2fa');
  const cookie1 = first.headers['set-cookie'][0].split(';')[0];
  assert.equal(
    (await agent.get('/projects')).headers.location,
    '/login',
    'sin segundo paso no hay acceso',
  );
  assert.equal((await agent.get('/api/v1/clients')).status, 401);
  assert.equal((await agent.get('/dashboard')).headers.location, '/login');
  assert.match((await agent.get('/login/2fa')).text, /Verificación en dos pasos/);
  const wrong = await agent.post('/login/2fa').type('form').send({ code: '123456' });
  assert.equal(wrong.status, 401);
  assert.equal(events(db, 'twofa_failed').length, 1);
  const ok = await agent
    .post('/login/2fa')
    .type('form')
    .send({ code: hotp(secret, stepOf() + 1) }); // el intervalo actual ya lo usó la activación
  assert.equal(ok.headers.location, '/');
  assert.notEqual(ok.headers['set-cookie'][0].split(';')[0], cookie1, 'ID de sesión nuevo');
  assert.equal((await agent.get('/projects')).status, 200);
  assert.equal(events(db, 'login_success').length >= 2, true);
  assert.equal(
    (await request(app).get('/login/2fa')).headers.location,
    '/login',
    'sin paso pendiente vuelve al login',
  );
});

test('un código TOTP no se reutiliza', async () => {
  const { app } = setup();
  const { secret } = await enable2fa(app);
  const code = hotp(secret, stepOf());
  const a = request.agent(app);
  await login(a);
  // enable2fa ya consumió el intervalo actual: el mismo código no sirve; el del siguiente intervalo sí
  assert.equal((await a.post('/login/2fa').type('form').send({ code })).status, 401);
  assert.equal(
    (
      await a
        .post('/login/2fa')
        .type('form')
        .send({ code: hotp(secret, stepOf() + 1) })
    ).headers.location,
    '/',
  );
  const b = request.agent(app);
  await login(b);
  assert.equal(
    (
      await b
        .post('/login/2fa')
        .type('form')
        .send({ code: hotp(secret, stepOf() + 1) })
    ).status,
    401,
    'el intervalo ya usado',
  );
});

test('códigos de recuperación: sirven una vez y se aceptan con o sin guion', async () => {
  const { app, db } = setup();
  const { codes } = await enable2fa(app);
  const a = request.agent(app);
  await login(a);
  assert.equal(
    (await a.post('/login/2fa').type('form').send({ code: codes[0].toUpperCase() })).headers
      .location,
    '/',
  );
  const b = request.agent(app);
  await login(b);
  assert.equal(
    (await b.post('/login/2fa').type('form').send({ code: codes[0] })).status,
    401,
    'ya usado',
  );
  assert.equal(
    (
      await b
        .post('/login/2fa')
        .type('form')
        .send({ code: codes[1].replace('-', '') })
    ).headers.location,
    '/',
  );
  assert.equal(events(db, 'recovery_code_used').length, 2);
  assert.match((await a.get('/account/security')).text, /te quedan 8 código/);
});

test('el segundo paso vence a los 10 minutos y se limita por intentos', async () => {
  const { app } = setup({ limit: 3 });
  await enable2fa(app);
  const a = request.agent(app);
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  await login(a);
  setClock(() => new Date('2026-05-13T18:11:00Z'));
  assert.equal((await a.get('/login/2fa')).headers.location, '/login');
  assert.equal(
    (await a.post('/login/2fa').type('form').send({ code: '123456' })).headers.location,
    '/login',
  );
  setClock(() => new Date());
  const b = request.agent(app);
  await login(b);
  for (let i = 0; i < 3; i += 1)
    assert.equal((await b.post('/login/2fa').type('form').send({ code: '111111' })).status, 401);
  const blocked = await b.post('/login/2fa').type('form').send({ code: '111111' });
  assert.equal(blocked.status, 429);
});

test('desactivar exige la contraseña y un código; renovar códigos exige un código vigente', async () => {
  const { app, db, ids } = setup();
  const { agent, secret, codes } = await enable2fa(app);
  const next = () => hotp(secret, stepOf() + 1);
  assert.equal(
    (
      await agent
        .post('/account/security/disable')
        .type('form')
        .send({ password: 'mala', code: next() })
    ).status,
    400,
  );
  assert.equal(
    (
      await agent
        .post('/account/security/disable')
        .type('form')
        .send({ password: PASSWORD, code: '000000' })
    ).status,
    400,
  );
  assert.equal(db.prepare('SELECT totp_enabled FROM users WHERE id = ?').pluck().get(ids.dev), 1);
  assert.equal(
    (await agent.post('/account/security/codes').type('form').send({ code: '000000' })).status,
    400,
  );
  const renewed = await agent.post('/account/security/codes').type('form').send({ code: next() });
  const fresh = [
    ...renewed.text.matchAll(/<li class="rounded bg-navy-50[^>]*>([a-f0-9]{5}-[a-f0-9]{5})</g),
  ].map((m) => m[1]);
  assert.equal(fresh.length, 10);
  const probe = request.agent(app);
  await login(probe);
  assert.equal(
    (await probe.post('/login/2fa').type('form').send({ code: codes[0] })).status,
    401,
    'los códigos anteriores ya no sirven',
  );
  const off = await agent
    .post('/account/security/disable')
    .type('form')
    .send({ password: PASSWORD, code: fresh[0] });
  assert.equal(off.headers.location, '/account/security?disabled=1');
  assert.equal(
    db.prepare('SELECT totp_enabled, totp_secret FROM users WHERE id = ?').get(ids.dev).totp_secret,
    null,
  );
  assert.equal(db.prepare('SELECT count(*) FROM recovery_codes').pluck().get(), 0);
  assert.equal(events(db, 'twofa_disabled').length, 1);
  assert.equal(
    (await login(request.agent(app))).headers.location,
    '/',
    'vuelve a entrar solo con la contraseña',
  );
});

test('el administrador quita el 2FA y desbloquea cuentas; los demás reciben 403', async () => {
  const { app, db, ids } = setup({ limit: 2 });
  await enable2fa(app);
  const admin = await loggedIn(app, 'admin');
  assert.match(
    (await admin.get(`/admin/users/${ids.dev}`)).text,
    /Quitar autenticación en dos pasos/,
  );
  assert.doesNotMatch((await admin.get(`/admin/users/${ids.other}`)).text, /Quitar autenticación/);
  const dev = await loggedIn(app, 'other');
  assert.equal((await dev.post(`/admin/users/${ids.dev}/reset-2fa`)).status, 403);
  assert.equal((await dev.post(`/admin/users/${ids.dev}/unlock`)).status, 403);
  const reset = await admin.post(`/admin/users/${ids.dev}/reset-2fa`);
  assert.equal(reset.headers.location, `/admin/users/${ids.dev}?done=reset-2fa`);
  assert.match(
    (await admin.get(reset.headers.location)).text,
    /Se quitó la autenticación en dos pasos/,
  );
  assert.equal(db.prepare('SELECT totp_enabled FROM users WHERE id = ?').pluck().get(ids.dev), 0);
  assert.equal(events(db, 'twofa_reset_by_admin').length, 1);
  assert.equal((await login(request.agent(app))).headers.location, '/');
  assert.equal((await admin.post('/admin/users/9999/reset-2fa')).status, 404);

  // bloqueo por intentos fallidos: se levanta con «Desbloquear»
  for (let i = 0; i < 4; i += 1)
    await request(app).post('/login').type('form').send({ email: 'dev@t.local', password: 'mala' });
  const cuenta = await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'dev@t.local', password: PASSWORD });
  assert.equal(cuenta.status, 429);
  const unlock = await admin.post(`/admin/users/${ids.dev}/unlock`);
  assert.equal(unlock.headers.location, `/admin/users/${ids.dev}?done=unlock`);
  assert.equal(events(db, 'account_unlocked').length, 1);
});

test('los eventos de seguridad cubren acceso correcto, fallido y cambio de contraseña', async () => {
  const { app, db } = setup();
  await login(request(app), 'dev', 'mala');
  const dev = await loggedIn(app);
  await dev.post('/account/password').type('form').send({
    currentPassword: PASSWORD,
    newPassword: 'OtraClave2026',
    confirmPassword: 'OtraClave2026',
  });
  const types = events(db).map((e) => e.type);
  assert.ok(types.includes('login_failed'));
  assert.ok(types.includes('login_success'));
  assert.ok(types.includes('password_changed'));
  const failed = events(db, 'login_failed')[0];
  assert.equal(failed.email, 'dev@t.local');
  assert.ok(failed.ip);
  assert.doesNotMatch(JSON.stringify(events(db)), /mala|OtraClave/);
});
