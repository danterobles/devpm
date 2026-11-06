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
- Vistas de clientes internos y externos (RF-10, RF-11, RF-15, RF-16): `/clients/internal` y
  `/clients/external` con listado (búsqueda, filtro de estado, paginación), alta y edición por
  formulario; la tarifa se captura en pesos y se guarda en centavos; los controles de escritura se
  ocultan a `developer` y `viewer`. Enlace «Clientes» en la navegación.
- Regla RF-18: los clientes no se eliminan (la API no ofrece `DELETE`; solo se desactivan) y la BD
  rechaza borrar uno con proyectos; cubierto con pruebas.
- Módulo `team` (RF-20): API `/api/v1/team-members` y vistas `/team` (listado con búsqueda, puesto,
  estado y paginación; alta, edición y desactivación). Capacidad semanal en minutos (formulario en
  horas), costo por hora en centavos visible solo para `admin` y `pm`; correo único; sin eliminación.
  Escritura solo `admin` y `pm`. Enlace «Equipo» en la navegación.
- Habilidades por miembro (RF-21): `GET/POST /api/v1/team-members/:id/skills` y
  `DELETE .../skills/:skillId`, y sección en la ficha `/team/:id`. Se asignan por nombre con nivel
  1–5; el catálogo `skills` se crea al asignar (sin distinguir mayúsculas); reasignar actualiza el nivel.
- Ausencias por miembro (RF-22): `GET/POST /api/v1/team-members/:id/time-off`,
  `PATCH/DELETE .../time-off/:offId` y sección en la ficha. Tipos `vacation`, `sick`, `personal` y
  `holiday`; periodos inclusivos con conteo de días; filtro `?from=&to=`; los traslapes se guardan con
  la advertencia `TIME_OFF_OVERLAP` (decisión registrada en `docs/DATA.md` §3.5); bitácora.
- Utilidad `isIsoDate` en `src/lib/dates.js`.

### Agregado (Etapa 5 — Proyectos, hitos y asignaciones)
- Módulo `projects` (RF-30, RF-34): API `/api/v1/projects` y vistas `/projects` (listado con búsqueda,
  estado, prioridad, cliente, líder y paginación; alta y edición). Código autogenerado `PRJ-AAAA-NNN`,
  `is_billable` por defecto según el tipo de cliente, presupuesto en minutos y centavos (formulario en
  horas y pesos), cliente activo obligatorio, cliente solo editable en planeación, fechas coherentes con
  las asignaciones existentes y bitácora. Escritura solo `admin` y `pm`. Enlace «Proyectos» en la navegación.
- Transiciones de estado del proyecto (RF-31): `POST /api/v1/projects/:id/status` y sección «Cambiar
  estado» en la ficha. Máquina de estados de `docs/DATA.md` §3.6 (422 en transiciones inválidas),
  `actual_start_date` al activar, `actual_end_date` al completar y confirmación explícita
  (`confirmOpenTasks`) si quedan tareas abiertas; se registra como `status_change` en la bitácora.
- Hitos por proyecto (RF-32): `GET/POST /api/v1/projects/:id/milestones`, `PATCH/DELETE .../:msId` y
  sección en la ficha del proyecto. Estados `pending`, `completed` y `missed`; `completed_at` se guarda
  al completar y se limpia al reabrir; ordenados por fecha compromiso; bitácora.
- Módulo `assignments` (RF-40, RF-41, RF-42): `GET/POST /api/v1/projects/:id/assignments`,
  `PATCH/DELETE .../:aId` y sección «Equipo asignado» en la ficha. Rol en el proyecto, dedicación 1–100 %
  y periodo dentro del rango del proyecto (422); solo miembros activos; la sobreasignación (> 100 % en
  periodos traslapados, inclusivos) se guarda con la advertencia `OVER_ALLOCATION`; bitácora.
- Ficha del proyecto (RF-33): panel de resumen (cliente, líder, horas consumidas frente al presupuesto,
  horas facturables, miembros asignados, avance de hitos y fechas reales) y `GET /api/v1/projects/:id/summary`.
  Las horas cuentan registros enviados y aprobadas (decisión en `docs/PRD.md`).
- Fichas de cliente (RF-12, RF-17): sección «Proyectos y horas» en `/clients/:type/:id` y
  `GET /api/v1/clients/:id/summary` con proyectos, horas consumidas y facturables, y monto estimado
  (horas facturables × tarifa) para clientes externos.
- Carga semanal del equipo (RF-23) y matriz de asignaciones (RF-43): vistas `/assignments/load` y
  `/assignments/matrix` y API `/api/v1/assignments/load|matrix` (lectura para cualquier usuario
  autenticado). Semanas lunes–domingo (8 por defecto, máximo 26), % por suma de dedicación con alerta
  de sobreasignación (> 100 %), días hábiles de ausencia informativos y filtro `?from=&to=`.

### Agregado (Etapa 6 — Planeación)
- Sprints (RF-60, RF-66): API `/api/v1/projects/:id/sprints` y `/api/v1/sprints/:id` (alta, edición,
  `start`, `close` y baja de sprints planeados) y vista `/projects/:id/sprints`. Fechas dentro del
  proyecto y sin traslapes; un solo sprint activo por proyecto; iniciar fija `committed_points`;
  cerrar fija `completed_points` y manda las tareas no terminadas al backlog (con historial de estado)
  o a un sprint planeado (`moveTo`); un sprint cerrado es de solo lectura. Utilidad
  `src/lib/taskHistory.js`.
- Tareas (RF-61, RF-62, RF-42, RF-65): API `/api/v1/projects/:id/tasks`, `/api/v1/tasks/:id`,
  `POST .../status` y `GET .../history`. Alta, edición y baja (`admin`/`pm`); responsable asignado al
  proyecto; sprint e hito del mismo proyecto; entrar a un sprint pasa `backlog → todo` y salir regresa a
  `backlog` (una tarea `done` no sale); estados libres con historial, `started_at` (primera vez en
  progreso) y `completed_at`; un `developer` solo cambia el estado de sus tareas; subtareas de un
  nivel que siguen el sprint del padre; tareas de sprints cerrados en solo lectura; bitácora.
- Backlog del proyecto (RF-63): vista `/projects/:id/backlog` (tareas sin sprint en orden, alta rápida,
  subir/bajar y enviar a un sprint) y `PUT /api/v1/projects/:id/tasks/order` para reordenar; las tareas
  fuera del subconjunto conservan su posición relativa. Enlaces al backlog desde proyecto y sprints.
- Tablero Kanban por sprint (RF-63): vista `/projects/:id/sprints/:sid/board`, API
  `GET /api/v1/sprints/:id/board` y `public/js/pages/board.js` (arrastrar y soltar con reversión si el
  servidor rechaza el cambio). Solo se pueden mover las tarjetas que el usuario puede cambiar (admin/pm
  todas; developer las suyas) y cada tarjeta incluye un formulario de respaldo sin JavaScript.
- Dependencias entre tareas (RF-64): `GET/POST /api/v1/tasks/:id/dependencies` y
  `DELETE .../dependencies/:depId`. Fin-a-inicio, mismo proyecto, sin duplicados y sin ciclos
  (detección con `WITH RECURSIVE`, 422); se eliminan en cascada con la tarea; bitácora.
- Página de la tarea `/tasks/:id` y subtareas (RF-65): edición por formulario, cambio de estado,
  historial, subtareas (un nivel; siguen al padre al cambiar de sprint; el padre no pasa a `done` con
  subtareas abiertas) y gestión de dependencias, con controles según el rol. Enlaces desde backlog y
  tablero.

### Cambiado
- `CLAUDE.md`: regla de contexto limpio: tras cada tarea terminada se pide `/clear` al usuario y
  todo el estado se conserva en CHECKLIST, CHANGELOG y docs.
- Decisión (Etapa 3): el almacén de sesiones es propio sobre `better-sqlite3`, sin dependencia extra
  (ARQUITECTURA §7, DATA §3.16).
- `CLAUDE.md`: nueva regla para preguntar al usuario ante cualquier duda de definición y
  registrar la decisión en `docs/` antes de implementarla.
- `CLAUDE.md`: obligación de ejecutar la suite completa de pruebas y el lint al terminar cada
  tarea; si algo falla, corregir y volver a ejecutar antes de continuar o hacer commit.
