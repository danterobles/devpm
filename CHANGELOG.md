# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

Categorías permitidas por versión: `Agregado`, `Cambiado`, `Obsoleto`, `Eliminado`, `Corregido`, `Seguridad`.

## [Sin publicar]

### Agregado
- Repositorio git inicializado en la rama `main` con `.gitignore` para Node.js y SQLite.
- `CHANGELOG.md` para registrar los cambios del proyecto.
- `CLAUDE.md` con stack (Node.js 22, Express 5, EJS, Tailwind CSS 4, SQLite/better-sqlite3),
  comandos, convenciones de código y flujo de trabajo (CHECKLIST → código → CHANGELOG → commit).
- `docs/PRD.md` con visión, roles, requerimientos funcionales (RF-01 a RF-95), 16 KPIs con
  fórmulas y umbrales, requerimientos no funcionales, criterios de aceptación del MVP y roadmap.
- `docs/ARQUITECTURA.md` con monolito modular por capas, decisiones (ADR-01 a ADR-08),
  estructura de carpetas, convenciones de API, tiempo real con SSE, diseño de Gantt y Burndown,
  seguridad, pruebas, mejores prácticas y despliegue.
- `docs/DATA.md` con convenciones de esquema, diagrama ER, 19 tablas (usuarios, clientes
  internos/externos, equipo, skills, ausencias, proyectos, hitos, asignaciones, sprints, tareas,
  dependencias, historial, registro de tiempo, snapshots de burndown, auditoría y soporte),
  índices, vistas para KPIs, ciclo de vida de datos y datos semilla.
- `CHECKLIST.md` con 12 etapas (0 a 11), tareas trazables a los requerimientos del PRD y
  criterio de cierre por etapa; Etapa 0 marcada como completada.

### Agregado (Etapa 1 — Scaffolding)
- `package.json` (ES Modules, Node >= 22) con scripts de desarrollo, build de CSS, pruebas y lint.
- Configuración validada con Zod (`src/config`), logger pino y `AppError`.
- App Express 5 (`createApp`) con helmet y CSP estricta, EJS con layout propio, `/health`,
  manejo central de errores (JSON en `/api`, vista HTML en el resto) y cierre ordenado.
- Tailwind CSS 4 (CSS-first), layout base con navegación y parciales de flash y paginación.
- `scripts/copy-vendor.js`: Chart.js y Frappe Gantt servidos localmente desde `public/vendor`.
- ESLint, Prettier y 11 pruebas iniciales (`node:test` + `supertest`).

### Agregado (Etapa 2 — Base de datos)
- `src/db/connection.js` (PRAGMAs WAL, foreign_keys, busy_timeout) y runner de migraciones
  transaccional con `schema_migrations`.
- Migraciones `001_init` (tablas de negocio) y `002_indexes_views` (índices, sprint activo único
  y vistas `v_project_progress`, `v_member_allocations`, `v_time_by_client_type`).
- Utilidades `src/lib/dates.js` (reloj inyectable) y `src/lib/audit.js` (`diff`, `recordAudit`).
- Seed de desarrollo y scripts `db:migrate`, `db:seed`, `db:reset`.
- Helpers de prueba (`testDb`, `factories`) y 37 pruebas nuevas (esquema, vistas, auditoría, fechas, seed).
- El servidor abre la BD y `/health` reporta su estado.

### Corregido
- CHECK de fechas: `col = date(col)` aceptaba formatos inválidos (daba NULL); ahora `col IS date(col)`.

### Agregado (Etapa 3 — Autenticación)
- Migración `003_sessions` y `SqliteSessionStore` (store propio de `express-session` sobre
  better-sqlite3: upsert, expiración, `prune`, `destroyByUser`).
- Middleware de sesión: cookie `devpm.sid` HttpOnly, SameSite=Strict, Secure en producción,
  expiración por inactividad de 8 h y sin cookie para visitantes anónimos; limpieza horaria.
- Login y logout (RF-01): `GET/POST /login` y `POST /logout` con módulo `auth` (schemas, repository,
  service, controller, routes), bcrypt, `session.regenerate()` al autenticar, mensaje genérico
  idéntico para correo inexistente, contraseña errónea o usuario inactivo (con comparación
  de relleno para igualar tiempos), `last_login_at`, vista de login y botón «Salir» en la navegación.
- Rate limit en `POST /login` (RNF-04): 10 intentos fallidos por IP cada 15 min (configurable con
  `LOGIN_MAX_ATTEMPTS`); los logins correctos no consumen cupo; responde 429.
- Middleware `validateBody` (Zod) en `src/middlewares/validate.js`.
- Middlewares `requireAuth` (401 JSON en `/api/*`, redirección a `/login` en vistas) y
  `requireRole(...roles)` (401 sin sesión, 403 con rol insuficiente; lista explícita, sin herencia) (RF-02).
- Middleware global `verifyOrigin` (CSRF): en POST/PUT/PATCH/DELETE rechaza con 403 un `Origin`/`Referer`
  que no coincida con `Host` (RNF-04).
- CRUD de usuarios para `admin` (RF-03, RF-04): API `/api/v1/users` (listado con búsqueda, estado y
  paginación; alta, edición y baja lógica) y vistas `/admin/users`. Contraseña mínima de 8
  caracteres; vinculación opcional con miembro del equipo; desactivar o cambiar rol/contraseña
  cierra las sesiones del usuario; un admin no puede desactivarse ni quitarse el rol. Con bitácora.
- Enlace «Usuarios» en la navegación para administradores.
- Cambio de contraseña propio (RF-05): vista `/account/password` y `PATCH /api/v1/me/password`;
  exige la contraseña actual, cierra las demás sesiones del usuario y deja bitácora. El nombre del
  usuario en la navegación enlaza a esa vista.
- Pruebas de la matriz de roles (PRD §8.6): `pm`, `developer` y `viewer` reciben 403 en la API y las
  vistas de usuarios, sin sesión 401/redirección, enlace «Usuarios» solo para `admin` y usuario
  desactivado sin acceso.

### Agregado (Etapa 4 — Clientes y equipo)
- Módulo `clients` (RF-10, RF-15): API `/api/v1/clients` con listado (búsqueda, tipo, estado,
  paginación), detalle, alta y edición/desactivación. Esquemas Zod estrictos por tipo
  (`internal` / `external`), `type` inmutable, tarifa en centavos, moneda ISO-4217 (por defecto
  MXN), RFC único y bitácora. Lectura para cualquier usuario autenticado; escritura solo `admin` y `pm`.

### Cambiado
- `CLAUDE.md`: regla de contexto limpio: tras cada tarea terminada se pide `/clear` al usuario y
  todo el estado se conserva en CHECKLIST, CHANGELOG y docs.
- Decisión (Etapa 3): el almacén de sesiones es propio sobre `better-sqlite3`, sin dependencia extra
  (ARQUITECTURA §7, DATA §3.16).
- `CLAUDE.md`: nueva regla para preguntar al usuario ante cualquier duda de definición y
  registrar la decisión en `docs/` antes de implementarla.
- `CLAUDE.md`: obligación de ejecutar la suite completa de pruebas y el lint al terminar cada
  tarea; si algo falla, corregir y volver a ejecutar antes de continuar o hacer commit.
