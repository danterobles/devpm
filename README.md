# DevPM

Sistema de gestión de proyectos de desarrollo de software. Administra clientes internos y externos, el
equipo, los proyectos y sus asignaciones, el registro y la aprobación de tiempo, y la planeación (sprints,
tareas, hitos), con **diagrama de Gantt**, **Burndown/Burnup** y un **tablero de KPIs en tiempo real**.

- **Stack:** Node.js 22 · Express 5 · EJS (SSR) · SQLite (`better-sqlite3`) · Tailwind CSS 4 · Chart.js y
  Frappe Gantt (servidos localmente, sin CDN) · Server-Sent Events para el tiempo real.
- **Sin servicios externos:** una sola base SQLite y un solo proceso Node.

## Instalación

Requisitos: **Node.js 22 o superior** y npm.

```bash
npm install                      # instala, copia las librerías de gráficas y compila el CSS
cp .env.example .env             # y edítalo (ver «Variables de entorno»)
npm run db:migrate               # crea el esquema de la base de datos
npm run user:create -- --email ana@empresa.com --name "Ana Directora"   # primer administrador
npm start                        # http://localhost:3000
```

`npm run user:create` pide la contraseña (mínimo 8 caracteres) sin mostrarla; también acepta la variable
`ADMIN_PASSWORD` o la entrada estándar (`echo 'clave' | npm run user:create -- …`). Después, el
administrador crea el resto de los usuarios desde **Usuarios** en el menú.

> Con `npm install --omit=dev` no se instala Tailwind: compila el CSS con `npm run build:css` en un
> entorno que tenga las dependencias de desarrollo.

## Desarrollo

```bash
npm run db:reset    # borra la base local, migra y carga datos de ejemplo (solo desarrollo)
npm run dev         # servidor con recarga + Tailwind en modo watch
```

Usuarios de ejemplo (contraseña `Cambiar123!`, **solo para desarrollo**; el seed está deshabilitado en producción):

| Correo | Rol |
|---|---|
| `admin@devpm.local` | Administrador |
| `pm@devpm.local` | Líder de proyecto |
| `dev@devpm.local` | Desarrollador |
| `viewer@devpm.local` | Observador (solo lectura) |

### Roles

| Rol | Puede |
|---|---|
| `admin` | Todo, incluidos usuarios, umbrales de los KPIs y la exportación |
| `pm` | Clientes, equipo, proyectos, sprints, tareas, asignaciones; aprueba las horas de sus proyectos |
| `developer` | Registrar su tiempo y cambiar el estado de sus tareas; lee el resto |
| `viewer` | Solo lectura del tablero, proyectos, Gantt y Burndown |

## Variables de entorno

Se leen de `.env` (ver `.env.example`) o del entorno.

| Variable | Por defecto | Descripción |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` o `production` |
| `PORT` | `3000` | Puerto HTTP |
| `DATABASE_PATH` | `data/devpm.db` | Archivo SQLite |
| `SESSION_SECRET` | — (obligatoria) | Mínimo 32 caracteres; en producción no puede ser el valor de ejemplo. Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TZ_APP` | `America/Mexico_City` | Zona horaria de las fechas de calendario (las marcas de tiempo son UTC) |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `LOGIN_MAX_ATTEMPTS` | `10` | Intentos fallidos de inicio de sesión cada 15 min por IP (y el doble por cuenta). Los fallos y bloqueos se registran en el log |
| `BACKUP_RETENTION_DAYS` | `14` | Días que se conservan los respaldos |
| `BACKUP_DIR` | `data/backups` | Carpeta de los respaldos |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor de producción |
| `npm run dev` | Desarrollo con recarga y Tailwind en modo watch |
| `npm run build:css` | Compila Tailwind a `public/css/output.css` |
| `npm run db:migrate` | Aplica las migraciones pendientes |
| `npm run db:seed` | Carga datos de ejemplo (solo desarrollo) |
| `npm run db:reset` | Borra la base local, migra y siembra (solo desarrollo) |
| `npm run db:backup` | Respaldo en caliente con retención |
| `npm run user:create` | Crea un administrador |
| `npm test` | Pruebas de unidad e integración |
| `npm run test:coverage` | Pruebas con cobertura; falla si los services bajan de 80 % |
| `npm run test:perf` | Pruebas de rendimiento con 100 000 registros de tiempo |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Despliegue

1. Servidor con Node.js 22. Clona el repositorio y ejecuta los pasos de **Instalación** con
   `NODE_ENV=production`.
2. **HTTPS es obligatorio.** En producción las cookies de sesión son `Secure` y la aplicación envía
   HSTS: por HTTP plano el navegador no conserva la sesión y el inicio de sesión parece no funcionar.
   Publica la aplicación detrás de un proxy inverso con TLS que envíe `Host` y `X-Forwarded-Proto`
   (la aplicación confía en un proxy). La aplicación valida que `Origin`/`Referer` coincidan con `Host`,
   así que el proxy debe conservar el `Host` original. Ejemplo para nginx:

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   # Tiempo real (SSE): sin buffering y con conexión larga
   location /api/v1/events {
     proxy_pass http://127.0.0.1:3000;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_http_version 1.1;
     proxy_set_header Connection '';
     proxy_buffering off;
     proxy_read_timeout 1h;
   }
   ```

3. Mantén el proceso con un supervisor (systemd, pm2…). La aplicación atiende `SIGTERM`/`SIGINT` cerrando
   las conexiones y la base de datos de forma ordenada. Para monitoreo usa `GET /health` (público).
4. **Actualizar:** `git pull && npm install && npm run db:migrate` y reinicia el servicio. Las migraciones
   aplicadas nunca se editan; los cambios llegan como migraciones nuevas. Al pasar a una versión que cambia
   el almacén de sesiones (0.2.2) se cierran las sesiones abiertas y cada persona vuelve a iniciar sesión.
5. Un solo proceso de aplicación por base de datos (SQLite en modo WAL admite los 50 usuarios simultáneos
   previstos).

## Respaldos

`npm run db:backup` crea `data/backups/devpm-AAAAMMDD-HHmm.db` (hora UTC) con `VACUUM INTO`, una copia
consistente de un solo archivo que se puede hacer **con la aplicación en marcha**. Verifica su integridad
y borra los respaldos con más de `BACKUP_RETENTION_DAYS` días. Prográmalo a diario, por ejemplo con cron:

```cron
15 2 * * *  cd /opt/devpm && /usr/bin/npm run db:backup >> /var/log/devpm-backup.log 2>&1
```

Los respaldos y su carpeta se crean con permisos restringidos (`0600` / `0700`): contienen los hashes de contraseña.

**Restaurar:** detén la aplicación, copia el respaldo elegido sobre `DATABASE_PATH`, borra los archivos
`-wal` y `-shm` si existen, ejecuta `npm run db:migrate` (por si el respaldo es de una versión anterior) y
arranca de nuevo. Guarda además una copia de `data/backups/` fuera del servidor.

## Pruebas

```bash
npm test                # unidad e integración (SQLite en memoria)
npm run test:coverage   # cobertura de los services (mínimo 80 %)
npm run test:perf       # RNF-01: p95 < 300 ms con 50 proyectos, 50 miembros y 100 000 registros
npm run lint
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/manuales/Manual-Usuario.pdf`](docs/manuales/Manual-Usuario.pdf) | Manual del usuario (líderes, desarrolladores y observadores) con pantallas y pasos |
| [`docs/manuales/Manual-Administrador.pdf`](docs/manuales/Manual-Administrador.pdf) | Manual del administrador: usuarios, catálogos, umbrales, despliegue y respaldos |
| [`docs/PRD.md`](docs/PRD.md) | Requerimientos, roles, KPIs y criterios de aceptación |
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Arquitectura, convenciones, seguridad y tiempo real |
| [`docs/DATA.md`](docs/DATA.md) | Entidades, relaciones, índices y vistas |
| [`CHECKLIST.md`](CHECKLIST.md) | Avance por etapas |
| [`CHANGELOG.md`](CHANGELOG.md) | Historial de cambios |
| [`CLAUDE.md`](CLAUDE.md) | Guía de trabajo del repositorio |
