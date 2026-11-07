# Arquitectura — DevPM

Este documento define **cómo** se construye el sistema: estilo arquitectónico, estructura,
responsabilidades de cada capa, tiempo real, seguridad, pruebas y mejores prácticas.
Los requerimientos están en `docs/PRD.md` y el modelo de datos en `docs/DATA.md`.

---

## 1. Visión general

Monolito modular con renderizado en servidor (SSR) y una API REST JSON para las interacciones
dinámicas (Kanban, Gantt, Burndown, tablero). Un solo proceso Node.js sirve HTML, API, estáticos
y el canal de tiempo real; la persistencia es un archivo SQLite.

```
┌───────────────────────────── Navegador ─────────────────────────────┐
│  Páginas EJS + Tailwind   │  JS por página (ES modules)             │
│                           │  Chart.js · Frappe Gantt · EventSource   │
└──────────────┬────────────┴───────────────┬─────────────────────────┘
               │ HTML (GET /...)            │ JSON (/api/v1/...)   ▲ SSE (/api/v1/events)
┌──────────────▼────────────────────────────▼──────────────────────┼──┐
│ Express 5                                                         │  │
│  helmet · session · rateLimit · auth · validate(Zod)              │  │
│  ┌─────────┐   ┌────────────┐   ┌─────────┐   ┌────────────┐      │  │
│  │ routes  │ → │ controller │ → │ service │ → │ repository │      │  │
│  └─────────┘   └────────────┘   └────┬────┘   └─────┬──────┘      │  │
│                                      │ emit         │ SQL         │  │
│                                ┌─────▼─────┐        │             │  │
│                                │ eventBus  │────────┼──► sse.js ──┘  │
│                                └───────────┘        │                │
│  jobs (snapshot diario de burndown, respaldo)       │                │
└─────────────────────────────────────────────────────┼────────────────┘
                                              ┌───────▼────────┐
                                              │ SQLite (WAL)   │
                                              │ data/devpm.db  │
                                              └────────────────┘
```

### Decisiones de arquitectura (ADR resumidas)

| # | Decisión | Motivo | Alternativa descartada |
|---|---|---|---|
| ADR-01 | Monolito modular por dominio | Equipo pequeño, despliegue simple, límites claros entre módulos | Microservicios (complejidad innecesaria) |
| ADR-02 | SSR con EJS + JS ligero por página | Sin build de frontend complejo; Tailwind cubre estilos | SPA con React (duplica lógica y tooling) |
| ADR-03 | `better-sqlite3` (síncrono) | Es el driver SQLite más rápido y estable en Node; transacciones simples | `sqlite3` asíncrono (más lento, callbacks); `node:sqlite` (aún en desarrollo activo) |
| ADR-04 | SQL plano + repositories, sin ORM | Control total de consultas de KPIs, cero magia | Prisma/Sequelize (peso, abstracción sobre agregaciones complejas) |
| ADR-05 | Server-Sent Events para tiempo real | Flujo unidireccional servidor→cliente es suficiente; nativo en navegador, reconexión automática | WebSockets/Socket.IO (bidireccional no requerido, otra dependencia) |
| ADR-06 | Bus de eventos en memoria (`EventEmitter`) | Un solo proceso; desacopla services del canal SSE | Redis pub/sub (solo necesario si se escala a varios procesos) |
| ADR-07 | Librerías de gráficas servidas localmente | CSP estricta sin CDNs; funciona sin internet | Cargar desde CDN |
| ADR-08 | Minutos y centavos como enteros | Evita errores de punto flotante en sumas | `REAL` para horas y dinero |

> Si el sistema necesitara varios procesos o servidores, el cambio se limita a: reemplazar
> `eventBus` por Redis pub/sub y SQLite por PostgreSQL en la capa repository.

## 2. Estructura de carpetas

```
gestionproyectos/
├── CLAUDE.md · CHANGELOG.md · CHECKLIST.md · package.json · .env.example
├── docs/                         PRD.md · ARQUITECTURA.md · DATA.md
├── data/                         devpm.db (ignorado) · backups/
├── public/
│   ├── css/output.css            (generado por Tailwind, ignorado)
│   ├── js/
│   │   ├── lib/                  api.js (fetch wrapper) · live.js (EventSource) · format.js
│   │   └── pages/                dashboard.js · gantt.js · burndown.js · kanban.js · timesheet.js
│   └── vendor/                   chart.js · frappe-gantt (copiados en postinstall, ignorados)
├── scripts/                      copy-vendor.js · backup-db.js
├── src/
│   ├── app.js                    createApp({ db }) → app Express (sin listen)
│   ├── server.js                 arranque, jobs, cierre ordenado (SIGINT/SIGTERM)
│   ├── config/index.js           lee .env, valida con Zod, exporta config inmutable
│   ├── db/
│   │   ├── connection.js         abre SQLite y aplica PRAGMAs
│   │   ├── migrate.js            runner de migraciones
│   │   ├── migrations/           001_init.sql, 002_..., (inmutables una vez aplicadas)
│   │   └── seeds/                dev.js (datos de ejemplo)
│   ├── lib/                      AppError.js · dates.js · pagination.js · logger.js
│   ├── middlewares/              requireAuth.js · requireRole.js · validate.js · errorHandler.js · notFound.js
│   ├── realtime/                 eventBus.js · sse.js
│   ├── jobs/                     burndownSnapshot.js · scheduler.js
│   ├── modules/
│   │   ├── auth/                 (login, logout, usuarios)
│   │   ├── clients/              (internos y externos)
│   │   ├── team/                 (miembros, skills, ausencias, carga)
│   │   ├── projects/             (proyectos, hitos)
│   │   ├── assignments/
│   │   ├── time-entries/         (registro, hoja semanal, aprobación)
│   │   ├── planning/             (sprints, tareas, dependencias, Kanban)
│   │   ├── charts/               (datos de Gantt y Burndown)
│   │   └── dashboard/            (KPIs y vista del tablero)
│   ├── views/
│   │   ├── layouts/main.ejs
│   │   ├── partials/             nav, flash, paginación, componentes de formulario
│   │   └── pages/<modulo>/       index.ejs · form.ejs · show.ejs
│   └── styles/input.css
└── tests/
    ├── helpers/                  testDb.js (BD en memoria migrada) · factories.js · agent.js (login)
    ├── unit/                     services y utilidades puras (cálculo de KPIs, fechas)
    └── integration/              endpoints con supertest
```

### Anatomía de un módulo

```
src/modules/clients/
├── clients.routes.js       define rutas HTML y API, aplica requireRole y validate
├── clients.controller.js   traduce req/res ↔ llamadas al service; decide render o JSON
├── clients.service.js      reglas de negocio, transacciones, emisión de eventos
├── clients.repository.js   SQL con sentencias preparadas; devuelve objetos planos
└── clients.schemas.js      esquemas Zod de entrada (create, update, query)
```

Reglas de dependencia:

- `routes → controller → service → repository`. Nunca al revés.
- Un service puede usar repositories de **otros** módulos solo para lectura; las escrituras
  de otro dominio pasan por el service de ese dominio.
- `repository` solo recibe la instancia `db` por inyección (facilita pruebas con BD en memoria).
- El módulo `dashboard` solo lee (consultas agregadas); nunca escribe.

## 3. Capas en detalle

### 3.1 Configuración

- Variables en `.env` (plantilla en `.env.example`), validadas al arrancar con Zod. Si falta
  algo obligatorio el proceso termina con un mensaje claro.
- Variables: `NODE_ENV`, `PORT`, `DATABASE_PATH`, `SESSION_SECRET` (≥ 32 caracteres),
  `TZ_APP` (por defecto `America/Mexico_City`), `LOG_LEVEL`, `BACKUP_RETENTION_DAYS`.

### 3.2 Base de datos

`src/db/connection.js` aplica al abrir:

```sql
PRAGMA journal_mode = WAL;        -- lectores no bloquean al escritor
PRAGMA foreign_keys = ON;         -- SQLite las trae desactivadas por defecto
PRAGMA busy_timeout = 5000;       -- espera en vez de fallar con SQLITE_BUSY
PRAGMA synchronous = NORMAL;      -- seguro con WAL y más rápido
```

- **Una sola conexión** compartida por el proceso (better-sqlite3 es síncrono; no hay pool).
- **Migraciones:** archivos `NNN_descripcion.sql` ejecutados en orden dentro de una transacción;
  la tabla `schema_migrations` registra cuáles se aplicaron. Una migración aplicada no se edita.
- **Transacciones:** toda operación que escribe en más de una tabla usa `db.transaction(fn)`.
- **Sentencias preparadas** cacheadas a nivel de módulo cuando se usan con frecuencia.
- **Vistas SQL** (`v_project_progress`, `v_member_load`, …) para consultas de KPIs reutilizables
  (ver `docs/DATA.md`).
- **Respaldo:** `VACUUM INTO 'data/backups/devpm-YYYYMMDD-HHmm.db'` (seguro en caliente).

### 3.3 Validación

- Middleware `validate({ body, query, params })` con esquemas Zod; el resultado parseado
  reemplaza a `req.body`/`req.validated` (coerción de tipos, recorte de cadenas, valores por defecto).
- Las reglas que dependen de datos (p. ej. sobreasignación, transición de estado válida)
  se validan en el **service**, no en el esquema.

### 3.4 Manejo de errores

- `AppError(status, code, message, details?)`: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`,
  `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `422 BUSINESS_RULE`.
- Express 5 propaga errores de handlers `async` al `errorHandler` sin `try/catch`.
- `errorHandler` responde JSON en `/api/*` y renderiza `pages/error.ejs` en rutas HTML.
  Errores 5xx se registran con stack; al cliente solo se envía un mensaje genérico.
- Errores de restricción de SQLite (`SQLITE_CONSTRAINT_*`) se traducen a 409.

### 3.5 API REST

- Prefijo `/api/v1`. Recursos en plural y `kebab-case`: `/clients`, `/team-members`,
  `/projects/:id/milestones`, `/time-entries`, `/sprints/:id/burndown`, `/projects/:id/gantt`.
- Verbos: `GET` lista/detalle, `POST` crear, `PATCH` actualizar parcial, `DELETE` eliminar o desactivar.
- Listados: `?page=1&pageSize=20&sort=-created_at&q=texto&status=active`. `pageSize` máximo 100.
- Formato de respuesta:

```json
// éxito (lista)
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134 } }
// éxito (recurso)
{ "data": { ... } }
// error
{ "error": { "code": "VALIDATION_ERROR", "message": "Datos inválidos", "details": [ ... ] } }
```

- Códigos: `200`, `201` (con el recurso creado), `204` (sin cuerpo), `4xx`/`5xx` según §3.4.
- Las páginas HTML usan formularios estándar (POST + redirect + mensaje flash) para CRUD
  simples, y la API JSON para vistas interactivas.

### 3.6 Vistas y frontend

- **EJS** con un layout (`layouts/main.ejs`) y parciales reutilizables. Salida siempre con `<%= %>`.
- **Tailwind CSS 4** con configuración CSS-first:

```css
/* src/styles/input.css */
@import "tailwindcss";
@source "../views";
@source "../../public/js";

@theme {
  --color-brand-500: oklch(0.62 0.19 255);
  --color-ok: oklch(0.72 0.17 150);
  --color-warn: oklch(0.80 0.16 80);
  --color-danger: oklch(0.63 0.22 25);
}
```

  Compilación: `npx @tailwindcss/cli -i src/styles/input.css -o public/css/output.css --minify`.
  Componentes repetidos (botón, tarjeta, badge de estado) se crean como **parciales EJS**, no
  con `@apply` masivo.
- **Sistema de diseño (Etapa 12, RNF-12)**:
  - Paleta `navy` (50–950) definida en `@theme`; azul marino predominante en encabezado, riel y acentos.
    `brand-*`, `ok`, `warn` y `danger` se conservan para estados y bordes.
  - **Modo oscuro**: variante `dark:` personalizada que sigue `prefers-color-scheme` y se anula con
    `data-theme="light|dark"` en `<html>`. Las vistas existentes usan los tokens de Tailwind
    (`white`, `slate-*`, `red-*`…): en modo oscuro esos tokens se **redefinen** en `input.css`, así que las
    vistas no necesitan clases `dark:` una por una.
  - **Tema**: `public/js/lib/theme.js` (externo, la CSP prohíbe scripts en línea) aplica el tema guardado
    en `localStorage` antes de pintar y gestiona el selector Sistema / Claro / Oscuro del encabezado.
  - **Layout**: `layouts/main.ejs` + `partials/nav.ejs`: riel de iconos (≥ `md`) o barra superior que se
    ajusta (móvil), encabezado azul marino y área de contenido. El enlace de la sección activa lleva
    `aria-current="page"` (`res.locals.currentPath`).
  - **Gráficas**: Chart.js toma los colores de texto y rejilla del tema activo.
  - **Gantt (Frappe Gantt)**: la librería solo reconoce `html[data-theme=dark]`, que no existe cuando se sigue al sistema.
    Por eso `input.css` redefine sus variables `--g-*` con la paleta `navy` bajo la variante `dark:` (sobre
    `.gantt-container`), de modo que el diagrama cambia con el tema igual que el resto de la interfaz.
- **JS del cliente**: módulos ES nativos en `public/js/pages/`, uno por vista, sin bundler.
  `public/js/lib/api.js` centraliza `fetch` (JSON, manejo de errores, cabecera de origen).
- **Gráficas**: Chart.js (Burndown, barras, donas, sparklines) y Frappe Gantt. Ambas se copian
  de `node_modules` a `public/vendor/` con `scripts/copy-vendor.js` (hook `postinstall`).
- **Accesibilidad**: etiquetas en formularios, foco visible, colores del semáforo acompañados
  de texto/icono, tablas con `<th scope>`.

### 3.7 Notificaciones, Mi día e importación (v0.3)

- **`modules/notifications/`**: repository (tabla `notifications`), service (`notify`, `list`, `unreadCount`, `markRead`, `markAllRead`, `prune`), schemas y rutas (`/notifications`, `/account/notifications`, `/api/v1/notifications/*`). Los services de tiempo y tareas reciben el notificador por inyección y lo invocan **después** de confirmar su transacción; `notify` inserta (con `INSERT OR IGNORE` sobre la clave de deduplicación), emite `notification.created` por el bus de eventos y envía el correo sin esperar su resultado.
- **`lib/mailer.js`**: envoltorio de `nodemailer`. Sin `SMTP_HOST` queda deshabilitado (no hace nada). En pruebas se usa el transporte `jsonTransport` (sin red).
- **`jobs/reminders.js`**: revisión diaria a las 09:00 de la zona de la aplicación (mismo `setTimeout` recalculado del job de Burndown) y al arrancar. La lógica vive en un service (`reminders.service.js`) que recibe la fecha por parámetro, para probarla sin esperar.
- **`modules/home/`**: service y repository de solo lectura que arman el panel «Mi día» por rol.
- **`modules/import/`**: parser CSV propio (`lib/csv.js`, sin dependencia), esquemas por entidad y service que valida fila por fila y, al importar, usa los services existentes dentro de **una** transacción; los eventos se acumulan y se emiten al confirmar.
- **Configuración** (opcional): `APP_URL` (enlaces de los correos), `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.

### 3.8 Colaboración (v0.4)

- **`modules/comments/`**: repository (`task_comments`), service (crear, editar, eliminar con permisos y bitácora; menciones y avisos mediante el notificador de la v0.3), rutas anidadas en la tarea (`/api/v1/tasks/:id/comments`) y fragmento en la ficha de la tarea que se refresca con SSE (`comment.changed`).
- **`modules/attachments/`**: repository (`task_attachments`), service (límites, lista de tipos, verificación de firma por *magic bytes*, nombre aleatorio) y rutas (`POST /api/v1/tasks/:id/attachments?name=…` con `express.raw({ limit })`, `GET /attachments/:id` autenticada y siempre como descarga, `DELETE`). Los archivos viven en `UPLOAD_DIR` (por defecto `data/uploads/`, ignorada por git, permisos `0700`/`0600`). `db:backup` copia también esa carpeta (`devpm-AAAAMMDD-HHmm.uploads/`, antes de la base para que la copia de la base nunca apunte a un archivo ausente). Los huérfanos se barren al arrancar y al eliminar tareas. Sin dependencias nuevas.
- **`modules/search/`**: service y repository de solo lectura que reutilizan las reglas de visibilidad de cada listado; `LIKE` con escape (y FTS5 solo si la prueba de rendimiento lo exige). Filtros guardados en `saved_filters`.
- **Seguridad**: los adjuntos nunca se sirven desde `public/`; la CSP no cambia; un archivo no se interpreta nunca como HTML (descarga forzada, `nosniff`, tipos permitidos por lista); las menciones y los comentarios se escapan como el resto del contenido.
- **Configuración**: `UPLOAD_DIR` y `UPLOAD_MAX_MB` (1 a 5; 5 por defecto).

### 3.9 Cuentas, bitácora y estado (v0.5)

- **`modules/account-security/`**: `totp.js` (RFC 6238 con `node:crypto`: base32, HMAC-SHA1, intervalo de 30 s, ventana ±1, comparación en tiempo constante), `secretBox.js` (AES-256-GCM con clave derivada de `SESSION_SECRET`), repository, service (activar, verificar, desactivar, códigos de recuperación, restablecimiento de contraseña con token aleatorio guardado como SHA-256) y rutas públicas (`/forgot-password`, `/reset-password`, `/login/2fa`) y autenticadas (`/account/security`).
- **Inicio de sesión en dos pasos**: tras validar la contraseña, si la cuenta tiene 2FA se guarda en la sesión solo `twoFactorUserId` (sin `userId`): la sesión no queda autenticada hasta superar `/login/2fa`, y se regenera el ID al completarla.
- **`modules/security-events/`**: `record(type, { userId, email, ip, detail })` (también escribe en el log de `pino`), consulta paginada y poda diaria de 90 días.
- **`modules/audit/`**: consulta de solo lectura de `audit_log` con filtros y presentación legible.
- **`modules/status/`**: `lib/metrics.js` (middleware con un anillo en memoria de las últimas 1 000 solicitudes: contadores, errores 5xx, p50 y p95) y el servicio que arma la pantalla de estado.
- **`scripts/healthcheck.js`** (`npm run health`): consulta `/health` y devuelve código 0 o 1.
- **Preferencias por tipo**: `notification_preferences`, consultada por `notify` antes de insertar o enviar.
- **Sin dependencias nuevas.**

## 4. Tiempo real (SSE)

### Flujo

1. Un service confirma una transacción (p. ej. `tasks.service.updateStatus`).
2. Emite un evento de dominio: `eventBus.emit('domain', { type: 'task.updated', projectId, sprintId, at })`.
3. `realtime/sse.js` mantiene el conjunto de clientes conectados a `GET /api/v1/events` y
   reenvía el evento a cada uno (filtrando por permisos y, si el cliente lo pidió, por proyecto).
4. El navegador (`public/js/lib/live.js`) recibe el evento y la página decide qué refrescar:
   el tablero vuelve a pedir `/api/v1/dashboard/kpis` (con *debounce* de 500 ms), el Burndown
   pide `/api/v1/sprints/:id/burndown`, etc.

Se envían **notificaciones** ("algo cambió"), no los datos completos: así los permisos y
filtros se aplican siempre en el endpoint de lectura.

### Detalles de implementación

```js
// cabeceras SSE
res.set({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // desactiva buffering en nginx
});
res.flushHeaders();
```

- Formato de mensaje: `id: <n>\nevent: <type>\ndata: <json>\n\n`.
- **Heartbeat** (`: ping\n\n`) cada 25 s para mantener viva la conexión tras proxies.
- `retry: 3000` para la reconexión automática de `EventSource`.
- Al cerrar la conexión (`req.on('close')`) se elimina el cliente del conjunto.
- Solo usuarios autenticados; la cookie de sesión viaja con `EventSource` (mismo origen).
- `server.js` cierra las conexiones SSE al recibir `SIGTERM` para un apagado limpio.

### Eventos de dominio

| Evento | Emitido por | Refresca |
|---|---|---|
| `project.created/updated/status_changed` | projects | KPIs K1–K5, riesgo, Gantt portafolio |
| `milestone.updated` | projects | K15, Gantt |
| `assignment.changed` | assignments | K6, K7, carga del equipo |
| `task.created/updated/status_changed/deleted` | planning | K2, K8–K12, Burndown, Kanban, Gantt |
| `sprint.started/closed` | planning | K8, K9, Burndown |
| `time_entry.changed/approved` | time-entries | K4–K6, K13, K14, K16 |
| `team_member.updated`, `time_off.changed` | team | K6, K7, K16 |
| `sprint.updated` | planning | Burndown, Kanban |
| `client.updated` | clients | filtros del tablero, K14 |
| `settings.updated` | settings | semáforos de los KPIs |

Todos los eventos llevan `id` (incremental por proceso), `type`, `at` (UTC ISO-8601) y, según el caso,
`projectId`, `sprintId`, `taskId`, `memberId` o `clientId`. La emisión usa `src/realtime/eventBus.js`;
los services reciben el bus como dependencia opcional (`events`) y emiten solo tras confirmar la transacción.

## 5. Gantt y Burndown

### Gantt

- Endpoint `GET /api/v1/projects/:id/gantt` devuelve tareas e hitos en el formato que espera
  Frappe Gantt: `{ id, name, start, end, progress, dependencies, custom_class }`.
  - Tareas sin fechas no se dibujan; se listan aparte como "sin programar".
  - `progress`: 100 si `done`; si no, proporción de horas registradas / estimadas (tope 95).
  - Hitos: barra de un día con `custom_class: 'milestone'`.
- Reprogramar (`on_date_change`) llama `PATCH /api/v1/tasks/:id` con `start_date` y `due_date`;
  el servidor valida dependencias (una tarea no inicia antes de que termine su predecesora).
- Gantt de portafolio: `GET /api/v1/gantt/portfolio` (una barra por proyecto activo).

### Burndown

- Tabla `sprint_daily_snapshots` (ver `docs/DATA.md`): una fila por sprint y día.
- **Job diario** (`jobs/burndownSnapshot.js`, programado a las 23:55 en la zona de la app) que
  hace *upsert* de la instantánea de cada sprint activo. Además, cualquier evento `task.*` de un
  sprint activo recalcula la instantánea **del día actual**, de modo que la gráfica está viva.
- Al iniciar un sprint se guarda `committed_points` y la instantánea del día 0.
- Línea ideal: de `committed_points` el día de inicio a 0 el día de fin, solo días hábiles.
- Endpoint `GET /api/v1/sprints/:id/burndown` → `{ days[], ideal[], remaining[], scopeChanges[] }`.
- El scheduler es un `setTimeout` recalculado (sin dependencias); al arrancar el servidor se
  rellenan las instantáneas faltantes de días anteriores del sprint activo.

## 6. KPIs

- `src/modules/dashboard/kpi.service.js` expone una función por KPI (`getSpi(filters)`, …) y
  `getAll(filters)` que las combina. Las fórmulas son **exactamente** las de `docs/PRD.md` §6.
- Las agregaciones se hacen en SQL (vistas + consultas con `GROUP BY`); el cálculo de índices
  (divisiones, semáforo) en JS puro y probado con pruebas unitarias.
- División entre cero → `null`, y la UI muestra "—".
- Umbrales del semáforo en `src/modules/dashboard/thresholds.js` (luego configurables, RF-93).
- Objetivo de rendimiento: `getAll` < 150 ms con el volumen de RNF-01; hay índices en todas
  las columnas usadas en filtros y `JOIN` (ver `docs/DATA.md`).

## 7. Seguridad

| Tema | Práctica |
|---|---|
| Autenticación | `express-session` con *store* propio sobre `better-sqlite3` (`src/modules/auth/sqliteSessionStore.js`, ~40 líneas, tabla `sessions` de la migración 003, sin dependencia extra; el ID de sesión se guarda **con hash SHA-256**, de modo que una copia de la base o de un respaldo no permite suplantar sesiones); `req.session.regenerate()` al iniciar sesión; expiración por inactividad de 8 h |
| Contraseñas | `bcrypt` con costo 12; nunca se registran ni se devuelven en la API; longitud de 8 a 72 bytes UTF-8 (bcrypt ignora lo que pase de 72, así que se rechaza en lugar de truncarlo en silencio) |
| Autorización | `requireAuth` **global** (en `app.js`) para todo excepto `/login`, `/logout`, `/health` y los estáticos (una prueba recorre todas las rutas y exige 401/redirección sin sesión); `requireRole('admin','pm')` por ruta; el service verifica pertenencia (p. ej. un `pm` solo aprueba horas de sus proyectos) |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` en producción; nombre propio (`devpm.sid`), no el genérico `connect.sid` |
| CSRF | `SameSite=Strict` + `verifyOrigin` (global, antes de las rutas): en POST/PUT/PATCH/DELETE el host de `Origin` (o `Referer` si falta) debe coincidir con `Host`, si no responde 403; `Origin: null` se rechaza; sin ambas cabeceras pasa, salvo que el navegador declare `Sec-Fetch-Site: cross-site`, que se rechaza con 403 |
| Cabeceras | `helmet` con CSP: `default-src 'self'`, `script-src 'self'` (sin `unsafe-inline` en scripts; `style-src` sí lo admite porque Chart.js y Frappe Gantt aplican estilos en línea) y `Referrer-Policy: same-origin`; `upgrade-insecure-requests` y HSTS **solo en producción** (en HTTP plano romperían la carga de recursos) |
| Fuerza bruta | `express-rate-limit` en `/login`: `LOGIN_MAX_ATTEMPTS` intentos fallidos / 15 min **por IP** y el doble **por cuenta** (correo), para frenar ataques repartidos entre varias IP. Detrás de un proxy depende de `trust proxy`: la aplicación no debe ser accesible sin pasar por él |
| Registro de seguridad | `pino` registra en nivel `warn` los inicios de sesión fallidos (`login.failed`) y los bloqueos (`login.blocked`) con IP y correo, nunca la contraseña; desde la v0.5 también se guardan en `security_events` (90 días) y el administrador los consulta |
| Dos pasos y recuperación | TOTP (RFC 6238) con secreto cifrado en reposo, un código no se reutiliza, códigos de recuperación y enlaces de restablecimiento guardados solo como hash, un solo uso y vencimiento de 1 h; la respuesta de «olvidé mi contraseña» no revela si la cuenta existe; la sesión de 2FA pendiente no concede acceso |
| Adjuntos | Fuera de `public/`, con nombre aleatorio (`0600`, carpeta `0700`); tipo decidido por la firma del archivo y extensión coincidente (sin HTML, SVG ni ejecutables); descarga solo autenticada, siempre `attachment` con `nosniff` y `Content-Security-Policy: sandbox`; 5 MB y 10 por tarea; el nombre original se limpia y nunca forma parte de una ruta; riesgo aceptado: sin antivirus |
| Comentarios y búsqueda | Texto plano escapado al mostrarse; menciones solo a usuarios activos por correo completo; la búsqueda usa `LIKE` con escape, mínimo 2 caracteres y solo columnas que los listados ya muestran (nunca RFC, tarifas ni costos) |
| Respaldos | `data/backups` con permisos `0700` y cada copia `0600` (contienen los hashes de contraseña) |
| Inyección | SQL solo con parámetros; ordenamiento con lista blanca de columnas |
| XSS | Escapado EJS `<%= %>`; en el cliente usar `textContent`, nunca `innerHTML` con datos |
| Secretos | Solo en `.env`; `SESSION_SECRET` obligatorio (≥ 32 caracteres) y, en producción, distinto del valor de ejemplo de `.env.example` |
| Dependencias | `npm audit --omit=dev` sin vulnerabilidades en producción (las de herramientas de desarrollo, como ESLint, no se despliegan) |
| Auditoría | `audit_log` registra quién, qué entidad, qué acción y los cambios (JSON) |

### 7.1 Riesgos aceptados

- **`style-src 'unsafe-inline'`**: Chart.js y Frappe Gantt aplican estilos en línea. Los scripts siguen sin `unsafe-inline`.
- **`/health` público** expone solo `status`, `db` y `uptime`.
- Los seeds de desarrollo usan una contraseña conocida; están bloqueados en producción.

## 8. Logs y observabilidad

- `pino` con nivel por entorno; en desarrollo `pino-pretty`.
- Un log por petición: método, ruta, status, duración, `userId` (sin cuerpos ni contraseñas).
- `GET /health` responde `{ status: 'ok', db: 'ok', uptime }` (comprueba `SELECT 1`).

## 9. Pruebas

| Tipo | Herramienta | Alcance |
|---|---|---|
| Unitarias | `node:test` + `node:assert/strict` | Cálculo de KPIs, línea ideal del burndown, validación de dependencias, utilidades de fechas |
| Integración | `supertest` sobre `createApp({ db })` | Cada endpoint: éxito, validación (400), permisos (401/403), no encontrado (404), reglas de negocio (409/422) |
| Tiempo real | `supertest` + lectura del stream | Un cambio emite el evento esperado al cliente SSE |

- Cada archivo de prueba crea una BD `:memory:` migrada (`tests/helpers/testDb.js`) y usa
  *factories* para los datos; las pruebas no dependen del orden.
- Fechas inyectables (`now()` en `lib/dates.js`) para probar vencimientos y burndown sin
  depender del reloj real.
- Meta de cobertura: ≥ 80 % en `services` y `dashboard`.

## 10. Mejores prácticas (resumen)

1. **Documentación primero:** el cambio de diseño se refleja en `docs/` antes que en el código.
2. **Pequeño y frecuente:** un commit por cambio lógico, con pruebas y CHANGELOG actualizado.
3. **Funciones puras** para la lógica de cálculo; efectos (BD, eventos) en los bordes.
4. **Sin lógica en vistas:** los controllers entregan a EJS datos ya formateados.
5. **Fallar rápido:** validar configuración al arrancar y entradas en el borde.
6. **Idempotencia** en jobs (upsert de snapshots) y migraciones (registro en `schema_migrations`).
7. **Índices** para toda columna de filtro o `JOIN`; revisar con `EXPLAIN QUERY PLAN` las consultas de KPIs.
8. **Borrado lógico** (`is_active = 0`) para clientes, miembros y proyectos con historial;
   borrado físico solo para datos sin dependencias.
9. **Dependencias mínimas:** justificar cada paquete nuevo en este documento.
10. **Cierre ordenado:** detener jobs, cerrar SSE y cerrar la BD en `SIGINT`/`SIGTERM`.

## 11. Dependencias

| Paquete | Uso | Tipo |
|---|---|---|
| `express` 5 | servidor HTTP | prod |
| `ejs` | vistas SSR | prod |
| `better-sqlite3` | base de datos | prod |
| `zod` | validación de entrada y configuración | prod |
| `express-session` | sesiones (store propio sobre better-sqlite3, ver §7) | prod |
| `bcrypt` | hash de contraseñas | prod |
| `helmet` | cabeceras de seguridad | prod |
| `express-rate-limit` | límite de intentos | prod |
| `pino` | logs | prod |
| `nodemailer` | correo de las notificaciones (RF-101). Única dependencia nueva de la v0.3: enviar por SMTP con TLS, autenticación y codificación correcta de cabeceras no es razonable de escribir a mano; sin `SMTP_HOST` no se usa | prod |
| `chart.js`, `frappe-gantt` | gráficas (copiadas a `public/vendor`) | prod |
| `tailwindcss`, `@tailwindcss/cli` | estilos | dev |
| `supertest` | pruebas HTTP | dev |
| `eslint`, `prettier`, `pino-pretty` | calidad y DX | dev |

## 12. Despliegue

- Requisitos: Node.js 22 LTS y disco persistente para `data/`.
- Pasos: `npm ci --omit=dev` (tras compilar CSS en CI) → `npm run db:migrate` → `npm start`.
- Ejecutar detrás de un proxy inverso (nginx/Caddy) con HTTPS; desactivar buffering para
  `/api/v1/events`; `app.set('trust proxy', 1)` para cookies `Secure`.
- Proceso supervisado (systemd o PM2 en modo *fork*, **una sola instancia**, ver ADR-06).
- Respaldo diario con `scripts/backup-db.js` y retención de `BACKUP_RETENTION_DAYS`.
