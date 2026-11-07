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

### Seguridad
- Revisión de seguridad (Etapa 11, ARQUITECTURA §7): `requireAuth` ahora es **global** (todo exige
  sesión salvo estáticos, `/health`, `/login` y `/logout`; una prueba recorre las 157 rutas registradas y
  comprueba 401/redirección sin sesión); HSTS y `upgrade-insecure-requests` solo en producción; en
  producción se rechaza el `SESSION_SECRET` de ejemplo; pruebas de CSP sin CDNs, cabeceras, cookie
  (`HttpOnly`, `SameSite=Strict`, `Secure`, sin fijación de sesión), CSRF con `Origin` ajeno o nulo,
  XSS por escapado, inyección SQL, errores sin trazas, hashes ausentes de la API y pérdida inmediata de
  acceso de un usuario desactivado. `npm audit --omit=dev`: 0 vulnerabilidades (las 4 moderadas
  restantes son de ESLint, solo desarrollo).
- Pruebas de rendimiento RNF-01 (`npm run test:perf`, fuera de `npm test`): con 50 proyectos, 50
  miembros y 100 000 registros de tiempo, las 21 páginas y endpoints principales miden p95 entre 1 y 66 ms
  (límite 300 ms); y una revisión de `EXPLAIN QUERY PLAN` de las 124 consultas que ejecutan esos flujos
  comprueba que ninguna recorre por completo una tabla de crecimiento ilimitado.

### Corregido (Etapa 11)
- Gantt del proyecto: p95 de 538 ms con 100 000 registros de tiempo porque `time_entries.task_id` no
  tenía índice (el avance de cada tarea recorría todos los registros); la migración `004_time_task_index`
  lo baja a ~1 ms.

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
- Prueba de extremo a extremo del flujo de un sprint (planear, iniciar, ejecutar en el tablero y cerrar).

### Agregado (Etapa 7 — Registro de tiempo)
- Módulo `time-entries` (RF-50, RF-53): API `/api/v1/time-entries` (listado con filtros y paginación,
  detalle, alta, edición y baja). Cada usuario registra solo su tiempo (miembro vinculado); un developer
  solo ve el suyo y admin/pm ven todo; el viewer no accede. Validaciones: duración 1–1440 min, sin fechas
  futuras (zona horaria de la aplicación), máximo 24 h por miembro y día, asignación vigente en la fecha y
  tarea del mismo proyecto. `is_billable` se hereda del proyecto. Solo `draft` y `rejected` se editan o
  eliminan; editar un rechazado lo regresa a borrador. Bitácora.
- Hoja de tiempos semanal (RF-51): vista `/time` y `GET /api/v1/time-sheet` con cuadrícula día × proyecto
  (lunes a domingo), totales por día y semana, resumen por estado y navegación entre semanas; alta,
  edición y baja de registros desde la hoja (horas en el formulario, minutos en la BD). Admin y pm pueden
  consultar la hoja de otros miembros en solo lectura (`?memberId=`). Enlace «Tiempo» en la navegación.
- Envío y aprobación de tiempo (RF-52): `POST /api/v1/time-entries/:id/submit`, `submit-week`,
  `GET .../pending`, `POST .../:id/approve` y `.../reject` (motivo obligatorio), y vista
  `/time/approvals`. Aprueba el líder del proyecto o un admin (pm ajeno 403) y nadie revisa sus propios
  registros (422); el rechazado vuelve al autor con el motivo y puede reenviarse; transiciones
  registradas como `status_change` en la bitácora. La hoja permite enviar un registro o toda la semana.
- Bandera facturable (RF-54): se hereda del proyecto al registrar (y al cambiar de proyecto);
  `PATCH /api/v1/time-entries/:id/billable` y selector en `/time/approvals` para el líder del proyecto
  y admin (el autor y los pm ajenos reciben 403); el cambio queda en la bitácora.
- Exportación de horas a CSV (RF-55): `GET /api/v1/time-entries/export.csv` (solo `admin` y `pm`) con
  filtros por rango, proyecto, cliente, miembro y estado, y formulario en `/time/approvals`. UTF-8 con
  BOM, coma como separador, horas con 2 decimales y protección contra inyección de fórmulas
  (`src/lib/csv.js`).
- Prueba de extremo a extremo del flujo de tiempo (registrar, enviar la semana, rechazar, corregir, aprobar y exportar).

### Agregado (Etapa 8 — Diagrama de Gantt)
- Endpoint `GET /api/v1/projects/:id/gantt` (RF-70, RF-72): tareas e hitos en el formato de Frappe Gantt
  (`id`, `name`, `start`, `end`, `progress`, `dependencies`, `custom_class`) más `meta`; avance (100 si
  `done`, o horas enviadas+aprobadas ÷ estimadas con tope 95), dependencias solo entre barras dibujadas,
  hitos de un día, tareas sin fechas en `unscheduled`, orden por inicio o `?groupBy=sprint`, fecha de hoy
  y bandera `canReschedule` (admin/pm). Lectura para cualquier usuario autenticado.
- Vista del Gantt `/projects/:id/gantt` (RF-70 a RF-72) con Frappe Gantt servido localmente
  (`public/js/pages/gantt.js`): escalas día/semana/mes, agrupación por sprint, dependencias, avance,
  línea del día actual, colores por estado (atrasadas con borde rojo, hitos en morado), popups con
  contenido escapado y lista de tareas «sin programar». Enlaces desde la ficha del proyecto y los sprints.
- Reprogramación arrastrando (RF-73): admin y pm arrastran las barras y el Gantt guarda con
  `PATCH /api/v1/tasks/:id`; el servidor valida (en cualquier edición de fechas) que la tarea inicie
  después de sus predecesoras, termine antes de sus sucesoras y quede dentro del proyecto (422 con el
  motivo; la barra regresa a su lugar). Sin cascada; los hitos no se arrastran; las tareas de sprints
  cerrados son de solo lectura.
- Gantt de portafolio (RF-74): vista `/gantt` y `GET /api/v1/gantt/portfolio` con un renglón por
  proyecto activo, avance por puntos de historia terminados (o por tareas si no hay puntos), color por
  prioridad y clic en la barra para abrir el Gantt del proyecto. Enlace «Portafolio» en la navegación.
- Pruebas del Gantt con los datos del seed (tareas, hitos, dependencias y reprogramación con validación).

### Corregido
- Login rechazado con 403 en navegadores reales: `Referrer-Policy: no-referrer` (valor por defecto de
  helmet) hace que los navegadores envíen `Origin: null` en los formularios y `verifyOrigin` los
  bloqueaba. Ahora la política es `same-origin`. Las pruebas con supertest no lo detectaban; se
  encontró al probar el Gantt en un navegador.
- Gantt: `custom_class` con espacios hacía fallar a Frappe Gantt (`classList.add`) y no se dibujaba
  ninguna barra; ahora es un único token (`gantt-<estado>`, `gantt-late`, `milestone-<estado>`).

### Agregado (Etapa 9 — Burndown)
- Servicio de instantáneas diarias (RF-81, `src/modules/burndown/snapshots.service.js`): `capture`,
  `captureActive` y `recalculate` con *upsert* idempotente por (sprint, día) de puntos totales,
  completados y restantes, y minutos estimados restantes (padres y subtareas). Iniciar un sprint guarda
  la instantánea del día 0 y cerrarlo guarda la final, antes de devolver las tareas no terminadas.
- Recalculo en vivo del Burndown (RF-81): crear, editar (puntos, estimación, sprint), cambiar de estado
  o eliminar una tarea recalcula la instantánea de hoy de los sprints activos afectados, después de
  confirmar la transacción; los sprints planeados o cerrados no generan instantáneas.
- Job diario del Burndown (`src/jobs/burndownSnapshot.js`): `setTimeout` recalculado que guarda la
  instantánea de cada sprint activo a las 23:55 de la zona de la aplicación, y relleno al arrancar el
  servidor de los días pasados sin instantánea (arrastrando el último valor conocido) más la captura de
  hoy; idempotente y con cierre ordenado (`SIGINT`/`SIGTERM`).
- Endpoint `GET /api/v1/sprints/:id/burndown` (RF-80, RF-82): `days`, `ideal`, `remaining`, `total` y
  `scopeChanges` por día. Línea ideal por días hábiles (`src/modules/burndown/ideal.js`), días pasados
  sin instantánea arrastran el último valor, los futuros y los previos al inicio real son `null`,
  sprints cerrados terminan en su instantánea final y los sprints que se pasan de fecha amplían el eje.
- Vista del Burndown `/projects/:id/sprints/:sid/burndown` (RF-80, RF-82) con Chart.js servido
  localmente (`public/js/pages/burndown.js`): línea ideal discontinua, restante real, barras de cambio de
  alcance (ámbar al agregar, verde al retirar), resumen del sprint y tabla de datos como alternativa
  accesible. Enlaces desde la lista de sprints y el tablero.
- Burndown por horas (RF-83): `?metric=hours` del endpoint del Burndown (minutos restantes, ideal desde
  la primera instantánea, sin cambios de alcance) y selector «Medir en» en la vista, que muestra horas.
- Burnup de proyecto (RF-84): `GET /api/v1/projects/:id/burnup` y vista `/projects/:id/burnup`
  (Chart.js) con alcance total frente a completado por día, sumando las instantáneas de sus sprints;
  un sprint cerrado aporta solo lo completado tras su cierre (decisión en `docs/PRD.md` §5.10). Enlace
  «Burnup» en la ficha del proyecto.
- Pruebas del Burndown: línea ideal (unitarias), instantáneas con fecha inyectada y verificación día a día con los sprints activos del seed.

### Agregado (Etapa 10 — Tablero de KPIs)
- Bus de eventos de dominio (`src/realtime/eventBus.js`) y emisión desde los services (proyectos, hitos,
  asignaciones, sprints, tareas, tiempo, equipo, ausencias y clientes) **después** de confirmar la
  transacción; las operaciones rechazadas y los cambios sin efecto no emiten. Eventos documentados en
  `docs/ARQUITECTURA.md` §4.
- Endpoint SSE `GET /api/v1/events` (RF-91, `src/realtime/sse.js`): solo usuarios autenticados, mensajes
  `id/event/data`, `retry: 3000`, heartbeat cada 25 s, filtro opcional `?projectId=` (sus eventos y los
  globales), limpieza al desconectar y cierre de todas las conexiones en el apagado (`SIGINT`/`SIGTERM`).
- Servicio de KPIs (`src/modules/dashboard/kpi.service.js`, PRD §6 y §6.1): K1 a K16 con filtros
  (periodo, tipo de cliente, cliente, proyecto y líder), agregación de portafolio sobre proyectos activos
  (K3 = Σ EV ÷ Σ PV, K4 = Σ EV ÷ Σ horas, K5 = Σ horas ÷ Σ presupuesto), capacidad por días hábiles menos
  ausencias (K6, K16), sobreasignación día por día (K7), velocidad y compromiso de los 3 últimos sprints
  (K8, K9), ciclo promedio (K12), horas facturables por tipo de cliente (K13), ingreso estimado por
  moneda (K14), tabla por proyecto y «Proyectos en riesgo» con su causa (RF-94). Semáforos con umbrales
  inyectables (`thresholds.js`) y divisiones entre cero como `null`; pruebas unitarias por fórmula.
- Endpoint `GET /api/v1/dashboard/kpis` (RF-92): filtros `from`, `to`, `clientType`, `clientId`,
  `projectId` y `managerId` validados con Zod (400 con fechas inválidas, rango invertido o mayor a 366
  días); lectura para cualquier usuario autenticado; el ingreso estimado (K14) solo se entrega a
  `admin` y `pm`.
- Vista del tablero `/dashboard` (RF-90, RF-94): tarjetas K1 a K16 con semáforo (color y texto
  «Verde/Ámbar/Rojo»), listado «Proyectos en riesgo» con su causa, tabla de proyectos activos y tres
  gráficas (Chart.js local: horas facturables, velocidad de sprints y avance frente a consumo) con filtros
  de periodo, tipo de cliente, cliente, proyecto y líder. Enlaces «Tablero» en la navegación y el inicio.
  Verificada en un navegador real con los datos de ejemplo.
- Cliente de tiempo real `public/js/lib/live.js` (RF-91, RF-95): `EventSource` a `/api/v1/events`,
  *debounce* de 500 ms que emite `devpm:refresh`, filtro por prefijos de evento y por proyecto,
  indicador «En vivo / Reconectando / Sin conexión» con la hora de la última actualización y refresco
  tras reconectar. El tablero lo usa: medido en un navegador real, un cambio de tarea actualiza los
  KPIs en ~0.5 s sin recargar.
- Burndown, Burnup, Kanban, Gantt del proyecto y Gantt de portafolio se refrescan solos al llegar
  eventos de dominio (`data-live`, prefijos de evento y proyecto): el Kanban vuelve a pedir la página y
  reemplaza las columnas (sin perder el arrastre), el Gantt ignora el eco de sus propios cambios y el
  Burndown refleja la instantánea recalculada. Medido en un navegador real: ~0.5 s.
- Umbrales de semáforo configurables (RF-93): `settings` clave `kpi.thresholds` (JSON validado con Zod:
  estructura estricta y orden coherente de cada umbral), API `GET/PUT/DELETE /api/v1/settings/kpi-thresholds`
  (lectura para cualquier usuario autenticado; escritura solo `admin`), página `/admin/settings/kpis` con
  formulario y «Restablecer valores del PRD», bitácora con el antes y el después y evento
  `settings.updated` que refresca los tableros abiertos. Un valor guardado inválido o corrupto no rompe el
  tablero: se usan los de fábrica.
- Pruebas de aceptación del MVP con el tablero (PRD §8.2 a §8.5): un cambio de tarea llega por SSE y
  actualiza KPIs y Burndown en ≤ 2 s; las horas registradas, enviadas, aprobadas y reclasificadas como no
  facturables mueven K4, K6, K13 y K14; 60 % + 60 % da la alerta de sobreasignación y K7 = 1; un
  proyecto con fecha fin vencida aparece en «Proyectos en riesgo» con su causa.

### Cambiado
- `CLAUDE.md`: regla de contexto limpio: tras cada tarea terminada se pide `/clear` al usuario y
  todo el estado se conserva en CHECKLIST, CHANGELOG y docs.
- Decisión (Etapa 3): el almacén de sesiones es propio sobre `better-sqlite3`, sin dependencia extra
  (ARQUITECTURA §7, DATA §3.16).
- `CLAUDE.md`: nueva regla para preguntar al usuario ante cualquier duda de definición y
  registrar la decisión en `docs/` antes de implementarla.
- `CLAUDE.md`: obligación de ejecutar la suite completa de pruebas y el lint al terminar cada
  tarea; si algo falla, corregir y volver a ejecutar antes de continuar o hacer commit.
