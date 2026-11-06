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
- **JS del cliente**: módulos ES nativos en `public/js/pages/`, uno por vista, sin bundler.
  `public/js/lib/api.js` centraliza `fetch` (JSON, manejo de errores, cabecera de origen).
- **Gráficas**: Chart.js (Burndown, barras, donas, sparklines) y Frappe Gantt. Ambas se copian
  de `node_modules` a `public/vendor/` con `scripts/copy-vendor.js` (hook `postinstall`).
- **Accesibilidad**: etiquetas en formularios, foco visible, colores del semáforo acompañados
  de texto/icono, tablas con `<th scope>`.

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
| Autenticación | `express-session` con *store* propio sobre `better-sqlite3` (`src/modules/auth/sqliteSessionStore.js`, ~40 líneas, tabla `sessions` de la migración 003, sin dependencia extra); `req.session.regenerate()` al iniciar sesión; expiración por inactividad de 8 h |
| Contraseñas | `bcrypt` con costo 12; nunca se registran ni se devuelven en la API |
| Autorización | `requireAuth` global para todo excepto `/login` y estáticos; `requireRole('admin','pm')` por ruta; el service verifica pertenencia (p. ej. un `pm` solo aprueba horas de sus proyectos) |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` en producción, nombre no predecible |
| CSRF | `SameSite=Strict` + `verifyOrigin` (global, antes de las rutas): en POST/PUT/PATCH/DELETE el host de `Origin` (o `Referer` si falta) debe coincidir con `Host`, si no responde 403; `Origin: null` se rechaza; sin ambas cabeceras (clientes no navegador) pasa |
| Cabeceras | `helmet` con CSP: `default-src 'self'`; sin `unsafe-inline` en scripts |
| Fuerza bruta | `express-rate-limit` en `/login` (10 intentos / 15 min por IP) |
| Inyección | SQL solo con parámetros; ordenamiento con lista blanca de columnas |
| XSS | Escapado EJS `<%= %>`; en el cliente usar `textContent`, nunca `innerHTML` con datos |
| Secretos | Solo en `.env`; `SESSION_SECRET` obligatorio en producción |
| Auditoría | `audit_log` registra quién, qué entidad, qué acción y los cambios (JSON) |

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
