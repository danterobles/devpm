// Alta del primer administrador (en producción no hay seed).
// Uso:  ADMIN_PASSWORD='…' npm run user:create -- --email ana@empresa.com --name "Ana Directora"
//   o:  npm run user:create -- --email … --name …   (pide la contraseña sin mostrarla)
//   o:  echo 'clave' | npm run user:create -- --email … --name …
import bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { loadConfig } from '../src/config/index.js';
import { recordAudit } from '../src/lib/audit.js';
import { openDb } from '../src/db/connection.js';
import { passwordSchema } from '../src/modules/auth/users.schemas.js';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Contraseña: ADMIN_PASSWORD, entrada estándar (si no es terminal) o pregunta sin eco. */
async function readPassword() {
  if (process.env.ADMIN_PASSWORD !== undefined) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.split(/\r?\n/)[0] ?? '';
  }
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write('Contraseña (mínimo 8 caracteres): ');
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const config = loadConfig();

const email = option('email');
const name = option('name');
if (!email) fail('Falta el correo: --email ana@empresa.com');
if (!z.string().email().safeParse(email.trim()).success) fail('El correo no es válido.');
if (!name?.trim()) fail('Falta el nombre: --name "Ana Directora"');

const password = await readPassword();
const checked = passwordSchema.safeParse(password);
if (!checked.success)
  fail(`Contraseña inválida: ${checked.error.issues[0].message.toLowerCase()}.`);

if (!existsSync(config.databasePath)) {
  fail(`La base de datos no existe: ${config.databasePath}. Ejecuta primero npm run db:migrate.`);
}
const db = openDb(config.databasePath);
try {
  const migrated = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (!migrated) fail('La base no está migrada: ejecuta npm run db:migrate.');

  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) {
    fail(`El correo ya está registrado: ${normalized}`);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')",
        )
        .run(normalized, passwordHash, name.trim()).lastInsertRowid,
    );
    recordAudit(db, {
      userId: null,
      entity: 'user',
      entityId: id,
      action: 'create',
      changes: { email: [null, normalized], role: [null, 'admin'] },
    });
  })();
  console.log(`Administrador creado: ${normalized}`);
} finally {
  db.close();
}
